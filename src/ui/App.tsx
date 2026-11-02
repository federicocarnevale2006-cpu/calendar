import { useEffect } from "preact/hooks";
import { addDays, addMonths, cap, fmtLongDay, MONTHS, MONTHS_SHORT, startOfDay, startOfWeek } from "../date";
import { APP_VERSION, SUPABASE_KEY, SUPABASE_URL } from "../config";
import { calById, cals, createDeviceKey, enableDeviceWrite, evColor, evMap, occurrences, pendingCount, pushKeyBad, ready, scheduleSync, sentSignal, session, settings, setSettings, syncState } from "../store";
import { holidaysRange } from "../holidays";
import { autoUpdatePC, checkUpdate, confirmUpdate, isAndroid, isTauri, onBack, onDeepLink, onResume, pushWidgets, writeTrofeoEvents, openUrl, readTrofeoLink, remindersFor, scheduleAndroid, statusBar, pcUpdate, restartApp, tickTauri, update, writeTrofeoLink } from "../platform";
import { closeAll, cursor, overlays, pop, push, selDay, showToast, toast, width, now } from "./state";
import { Icon } from "./icons";
import { Login } from "./Login";
import { AgendaView, DayList, DaySheet, MonthView, openNew, QuickAdd, WeekView, YearView } from "./views";
import { CalEditSheet, Calendars, CalToggles, ChoiceSheet, ConfirmSheet, Detail, Drawer, Editor, MultiMarkSheet, QuickSheet, RemSheet, Scope, Search, SettingsPage, ShiftsPage, SideMini, TrofeoPage } from "./overlays";

function useTheme() {
  const t = settings.value.theme;
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = t === "dark" || (t === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      void statusBar(dark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [t]);
}

function useReminders() {
  const m = evMap.value;
  useEffect(() => {
    const t = setTimeout(() => {
      const n = new Date();
      void scheduleAndroid(remindersFor(occurrences(startOfDay(addDays(n, -1)), addDays(n, 15)), n)).catch((e) => console.warn("promemoria", e));
    }, 1500);
    return () => clearTimeout(t);
  }, [m]);
  useEffect(() => {
    if (!isTauri) return;
    const tick = () => {
      const n = new Date();
      void tickTauri(remindersFor(occurrences(startOfDay(addDays(n, -1)), addDays(n, 2)), new Date(n.getTime() - 120000)), n);
    };
    const id = setInterval(tick, 20000);
    tick();
    return () => clearInterval(id);
  }, []);
}

/** Sul PC: alla prima apertura collega da solo Trofeo LCD (scrive la chiave dove Trofeo la cerca). */
function useTrofeoAutoLink() {
  const s = session.value;
  useEffect(() => {
    if (!isTauri || !s) return;
    let flag = "";
    try { flag = localStorage.getItem("trofeo-auto-" + s.user.id) || ""; } catch { /* */ }
    if (flag) return;
    void (async () => {
      try {
        if (await readTrofeoLink()) return;
        const key = await createDeviceKey("Trofeo LCD (questo PC)");
        await writeTrofeoLink(JSON.stringify({ url: SUPABASE_URL, anon: SUPABASE_KEY, key, email: s.user.email ?? "", created: new Date().toISOString() }));
        try { localStorage.setItem("trofeo-auto-" + s.user.id, "1"); } catch { /* */ }
      } catch (e) { console.warn("collegamento Trofeo", e); }
    })();
  }, [s?.user.id]);
}

let widgetKeySent = "";
/** Android: i widget della schermata Home ricevono gli eventi a ogni modifica e una chiave per aggiornarsi ad app chiusa. */
function useWidgets() {
  const s = session.value, m = evMap.value, cs = cals.value, ws = settings.value.weekStart, hol = settings.value.holidays;
  const mm = settings.value.multiMark;
  // la stessa chiave serve anche a inviare le modifiche ad app chiusa: va abilitata alla scrittura (una volta). Se Android
  // la trova rifiutata (tolta dalle Impostazioni) se ne crea una nuova.
  const online = syncState.value === "ok", bad = pushKeyBad.value;
  useEffect(() => {
    if (!isAndroid || !s) return;
    void (async () => {
      const k = "widget-key-" + s.user.id, kw = "widget-write-" + s.user.id;
      const get = (n: string) => { try { return localStorage.getItem(n) || ""; } catch { return ""; } };
      const set = (n: string, v: string) => { try { if (v) localStorage.setItem(n, v); else localStorage.removeItem(n); } catch { /* */ } };
      let key = get(k), writable = get(kw) === key && !!key;
      if (bad && bad > Number(get("widget-bad-" + s.user.id) || 0)) {   // rifiutata anche se abilitata: chiave tolta
        set("widget-bad-" + s.user.id, String(bad));
        if (writable) { key = ""; writable = false; }
      }
      try {
        if (key && !writable) {
          if (await enableDeviceWrite(key)) { set(kw, key); writable = true; } else key = "";
        }
        if (!key) {
          key = await createDeviceKey("Telefono Android", true);
          set(k, key);
          set(kw, key);
        }
      } catch { if (!key) return; }                                     // senza rete: si riprova quando torna
      if (key === widgetKeySent) return;
      widgetKeySent = key;
      await pushWidgets({ key, url: SUPABASE_URL, anon: SUPABASE_KEY });
    })();
  }, [s?.user.id, online, bad]);
  useEffect(() => {
    if (!isAndroid || !s) return;
    const t = setTimeout(() => {
      const cut = Date.now() - 45 * 86400000;
      const rows = [];
      for (const e of m.values()) {
        if (e.deleted) continue;
        const c = calById.value.get(e.calendar_id || "");
        if (c && (c.deleted || !c.visible)) continue;
        if (!e.rrule && new Date(e.end_at).getTime() < cut) continue;
        rows.push({ id: e.id, title: e.title, all_day: e.all_day, start_at: e.start_at, end_at: e.end_at, color: evColor(e), rrule: e.rrule, exdates: e.exdates || [], location: e.location, reminders: e.reminders || [] });
      }
      const y = new Date().getFullYear();
      void pushWidgets({ events: JSON.stringify(rows), holidays: JSON.stringify(hol ? holidaysRange(y - 1, y + 2) : {}), weekStart: ws, multi: mm });
    }, 1200);
    return () => clearTimeout(t);
  }, [s?.user.id, m, cs, ws, hol, mm]);
}

/** PC: a ogni modifica (anche quelle fatte sul telefono, che arrivano qui in tempo reale) gli eventi vanno subito a
 * Trofeo LCD in un file accanto al collegamento; prima Trofeo li rileggeva da internet una volta al minuto. */
function useTrofeoEvents() {
  const s = session.value, m = evMap.value, cs = cals.value, mm = settings.value.multiMark;
  useEffect(() => {
    if (!isTauri || !s) return;
    const write = () => {
      const cut = Date.now() - 45 * 86400000;
      const rows = [];
      for (const e of evMap.value.values()) {
        if (e.deleted) continue;
        const c = calById.value.get(e.calendar_id || "");
        if (c && (c.deleted || !c.visible)) continue;
        if (!e.rrule && new Date(e.end_at).getTime() < cut) continue;
        rows.push({ id: e.id, title: e.title, all_day: e.all_day, start_at: e.start_at, end_at: e.end_at, tz: e.tz, location: e.location,
          color: evColor(e), rrule: e.rrule, exdates: e.exdates || [], reminders: e.reminders || [], updated_at: e.updated_at || null });
      }
      void writeTrofeoEvents(JSON.stringify({ user: s.user.id, email: s.user.email ?? "", written: new Date().toISOString(), events: rows,
        prefs: { multi_mark: settings.value.multiMark } }))
        .catch((err) => console.warn("eventi per Trofeo", err));
    };
    const t = setTimeout(write, 300);
    const iv = setInterval(write, 60000);         // anche senza modifiche, ogni minuto: Trofeo sa che l'app per PC e' aperta
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [s?.user.id, m, cs, mm]);
}

function step(dir: number) {
  const v = settings.value.view, c = cursor.value;
  if (v === "month") { cursor.value = addMonths(new Date(c.getFullYear(), c.getMonth(), 1), dir); selDay.value = null; }
  else if (v === "week") cursor.value = addDays(c, 7 * dir);
  else if (v === "day") cursor.value = addDays(c, dir);
  else if (v === "year") cursor.value = new Date(c.getFullYear() + dir, c.getMonth(), 1);
}
function goToday() {
  const t = startOfDay(new Date());
  cursor.value = t;
  if (settings.value.view === "month") selDay.value = t;
}

function Title({ desk }: { desk: boolean }) {
  const v = settings.value.view, c = cursor.value;
  const thisYear = now.value.getFullYear();
  let main = "", sub = "";
  if (v === "month") { main = cap(MONTHS[c.getMonth()]); sub = String(c.getFullYear()); }
  else if (v === "year") main = String(c.getFullYear());
  else if (v === "agenda") main = "Prossimi eventi";
  else if (v === "day") { main = desk ? fmtLongDay(c) : `${c.getDate()} ${MONTHS_SHORT[c.getMonth()]}`; sub = desk ? String(c.getFullYear()) : cap(["dom", "lun", "mar", "mer", "gio", "ven", "sab"][c.getDay()]); }
  else {
    const s = startOfWeek(c, settings.value.weekStart), e = addDays(s, 6);
    main = s.getMonth() === e.getMonth() ? cap(MONTHS[s.getMonth()]) : `${cap(MONTHS_SHORT[s.getMonth()])} – ${cap(MONTHS_SHORT[e.getMonth()])}`;
    sub = String(e.getFullYear());
  }
  if (!desk && sub === String(thisYear) && v === "month") sub = "";
  return (
    <button class="title" onClick={() => setSettings({ view: v === "year" ? "month" : "year" })}>
      <h1>{main}</h1>{sub && <span class="yr">{sub}</span>}
    </button>
  );
}

function Body({ desk }: { desk: boolean }) {
  const v = settings.value.view;
  if (v === "week") return <WeekView days={7} />;
  if (v === "day") return <WeekView days={1} />;
  if (v === "agenda") return <AgendaView />;
  if (v === "year") return <YearView />;
  return <MonthView desk={desk} />;
}

function Overlays() {
  return (
    <>
      {overlays.value.map((o) => {
        switch (o.t) {
          case "detail": return <Detail occ={o.occ} />;
          case "editor": return <Editor ev={o.ev} isNew={o.isNew} occ={o.occ} scope={o.scope} />;
          case "quick": return <QuickSheet ev={o.ev} />;
          case "scope": return <Scope occ={o.occ} action={o.action} />;
          case "search": return <Search />;
          case "settings": return <SettingsPage />;
          case "calendars": return <Calendars add={o.add} />;
          case "drawer": return <Drawer />;
          case "trofeo": return <TrofeoPage />;
          case "rem": return <RemSheet allDay={o.allDay} start={o.start} value={o.value} onPick={o.onPick} none={o.none} />;
          case "choice": return <ChoiceSheet title={o.title} options={o.options} value={o.value} onPick={o.onPick} danger={o.danger} />;
          case "multimark": return <MultiMarkSheet />;
          case "calEdit": return <CalEditSheet id={o.id} />;
          case "confirm": return <ConfirmSheet title={o.title} text={o.text} ok={o.ok} danger={o.danger} onOk={o.onOk} />;
          case "shifts": return <ShiftsPage />;
        }
      })}
      {toast.value && (
        <div class="toast" role="status">
          <span>{toast.value.text}</span>
          {toast.value.action && <button onClick={() => { toast.value!.action!.run(); toast.value = null; }}>{toast.value.action.label}</button>}
        </div>
      )}
    </>
  );
}

function Phone() {
  const v = settings.value.view;
  const todayNum = now.value.getDate();
  return (
    <div class="app">
      <div class="main">
        <div class="top">
          <button class="iconbtn" aria-label="Menu" onClick={() => push({ t: "drawer" })}><Icon n="menu" /></button>
          <Title desk={false} />
          {pendingCount.value > 0 && (
            <button class="pending" onClick={() => scheduleSync(0)} title="Modifiche non ancora inviate: tocca per riprovare">
              <Icon n="sync" s />{pendingCount.value}{syncState.value === "offline" ? " · senza rete" : ""}
            </button>
          )}
          <button class="iconbtn" aria-label="Cerca" onClick={() => push({ t: "search" })}><Icon n="search" /></button>
          <button class="iconbtn todaybtn" aria-label="Oggi" onClick={goToday}><Icon n="cal" /><span class="num">{todayNum}</span></button>
        </div>
        <div class="content">
          <Body desk={false} />
          {v === "month" && <DaySheet />}
        </div>
      </div>
      {!(v === "month" && selDay.value) && (
        <button class="fab" aria-label="Nuovo evento" onClick={() => openNew(v === "day" || v === "week" ? cursor.value : selDay.value ?? cursor.value)}><Icon n="plus" /></button>
      )}
      <Overlays />
    </div>
  );
}

function Desk() {
  const v = settings.value.view;
  const sd = selDay.value ?? cursor.value;
  const wide = width.value >= 1200;
  return (
    <div class="app desk">
      <aside class="side">
        <div class="brand"><div class="logo" style={{ width: "36px", height: "36px", fontSize: "15px", borderRadius: "12px" }}>{now.value.getDate()}</div>Calendario</div>
        <button class="new" onClick={() => openNew(v === "month" ? sd : cursor.value)}><Icon n="plus" />Nuovo evento</button>
        <SideMini />
        <div class="sect">Calendari</div>
        <CalToggles />
        <button class="calitem addcal" onClick={() => push({ t: "calendars", add: true })}><span class="box"><Icon n="plus" /></span><span>Nuovo calendario</span></button>
        <div style={{ flex: 1 }} />
        <button class="navitem" onClick={() => push({ t: "calendars" })}><Icon n="folder" />Gestisci calendari</button>
        <button class="navitem" onClick={() => push({ t: "settings" })}><Icon n="settings" />Impostazioni</button>
      </aside>
      <div class="main">
        <div class="top">
          <button class="btn" style={{ height: "38px", marginRight: "6px" }} onClick={goToday}>Oggi</button>
          {v !== "agenda" && <><button class="iconbtn" aria-label="Precedente" onClick={() => step(-1)}><Icon n="left" /></button>
            <button class="iconbtn" aria-label="Successivo" onClick={() => step(1)}><Icon n="right" /></button></>}
          <Title desk />
          <div class="seg" style={{ marginRight: "6px" }}>
            {([["day", "Giorno"], ["week", "Settimana"], ["month", "Mese"], ["year", "Anno"], ["agenda", "Elenco"]] as const).map(([k, l]) => (
              <button class={v === k ? "on" : ""} onClick={() => setSettings({ view: k })}>{l}</button>
            ))}
          </div>
          <button class="iconbtn" aria-label="Cerca" onClick={() => push({ t: "search" })}><Icon n="search" /></button>
        </div>
        <div class="mainrow">
          <div class="content"><Body desk /></div>
          {v === "month" && wide && (
            <div class="daypanel">
              <header><h3>{fmtLongDay(sd)}</h3></header>
              <div class="list"><DayList day={sd} /></div>
              <QuickAdd day={sd} />
            </div>
          )}
        </div>
      </div>
      {v === "month" && !wide && selDay.value && (
        <>
          <div class="scrim" style={{ background: "transparent" }} onClick={() => (selDay.value = null)} />
          <div class="sheet"><div class="daysheet" style={{ boxShadow: "none", margin: 0, maxHeight: "none" }}>
            <header><h3>{fmtLongDay(sd)}</h3><button class="iconbtn" aria-label="Nuovo" onClick={() => openNew(sd)}><Icon n="plus" /></button><button class="iconbtn" aria-label="Chiudi" onClick={() => (selDay.value = null)}><Icon n="close" /></button></header>
            <div class="list"><DayList day={sd} /></div></div></div>
        </>
      )}
      <Overlays />
    </div>
  );
}

export function App() {
  useTheme();
  useReminders();
  useTrofeoAutoLink();
  useWidgets();
  useTrofeoEvents();
  useEffect(() => {
    void onResume(() => scheduleSync(0));
  }, []);
  const sent = sentSignal.value;
  useEffect(() => { if (sent) showToast("Modifiche inviate: ora si vedono anche sugli altri dispositivi"); }, [sent]);
  useEffect(() => {
    void onDeepLink((url) => { if (url.startsWith("calendario://nuovo")) { closeAll(); openNew(new Date()); } });
  }, []);
  useEffect(() => {
    if (isTauri) return;                                       // il PC si aggiorna da solo (sotto)
    const t = setTimeout(() => {
      void checkUpdate().then((u) => {
        if (u && update.value) showToast(`Nuova versione ${update.value.version} disponibile`, { label: "Scarica", run: () => void openUrl(update.value!.url) });
      });
    }, 4000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!isTauri) return;
    // la versione nuova e' partita bene (il file vecchio si toglie); se e' appena cambiata lo si dice
    const c = setTimeout(() => {
      void confirmUpdate().then((prev) => { if (prev) showToast(`Calendario aggiornato alla versione ${APP_VERSION}`); });
    }, 5000);
    let next: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      void autoUpdatePC().then((st) => {
        if (st === "ready" && pcUpdate.value) showToast(`Versione ${pcUpdate.value.version} installata`, { label: "Riavvia", run: () => void restartApp() });
        else if (st === "manual" && update.value) showToast(`Nuova versione ${update.value.version} disponibile`, { label: "Scarica", run: () => void openUrl(update.value!.url) });
        next = setTimeout(run, 3 * 3600000);                   // controllo ogni 3 ore
      }).catch((e) => {
        console.warn("aggiornamento automatico", e);
        next = setTimeout(run, 15 * 60000);                    // non riuscito: si riprova fra 15 minuti
      });
    };
    next = setTimeout(run, 8000);
    return () => { clearTimeout(c); if (next) clearTimeout(next); };
  }, []);
  useEffect(() => {
    void onBack(() => {
      if (overlays.value.length) { pop(); return true; }
      if (selDay.value) { selDay.value = null; return true; }
      if (settings.value.view !== "month") { setSettings({ view: "month" }); return true; }
      return false;
    });
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "Escape") { if (overlays.value.length) pop(); else selDay.value = null; return; }
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || overlays.value.length) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "t" || e.key === "T") goToday();
      else if (e.key === "n" || e.key === "N") openNew(selDay.value ?? cursor.value);
      else if (e.key === "/") { e.preventDefault(); push({ t: "search" }); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!ready.value) return null;
  if (!session.value) return <Login />;
  return width.value >= 840 ? <Desk /> : <Phone />;
}
