import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { tick } from "./drag";
import { addDays, cap, DAYS_SHORT, fmtLongDay, hm, localDateToUtcIso, MONTHS_SHORT, parseYmd, startOfDay, utcDateToLocal, ymd } from "../date";
import { describeRule, expand, parseRule, ruleToString, uuid, type Cal, type Ev, type Occ, type Rule } from "../model";
import { APK_URL, APP_VERSION, EXE_URL, PALETTE, SUPABASE_KEY, SUPABASE_URL } from "../config";
import {
  calById, cals, createDeviceKey, isHoliday, deleteEvent, evColor, events, evMap, lastSync, pendingCount, saveCal, saveEvent, session, setSettings,
  settings, signOut, syncError, syncState, scheduleSync, visibleCals,
} from "../store";
import { autostart, isAndroid, isTauri, openUrl, readTrofeoLink, update, writeTrofeoLink } from "../platform";
import { cursor, now, pop, push, replaceTop, selDay, showToast, closeAll } from "./state";
import { Icon } from "./icons";
import { MiniMonth } from "./views";

// ------------------------------------------------------------------------------------------------ elementi comuni
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} class={"switch" + (on ? " on" : "")} onClick={(e) => { e.stopPropagation(); onChange(!on); }} />;
}

function Page({ title, onClose, children, actions, dialog }: { title: string; onClose?: () => void; children: any; actions?: any; dialog?: boolean }) {
  return (
    <>
      {dialog && <div class="scrim desk-only" onClick={onClose ?? pop} />}
      <div class={"page" + (dialog ? " dialog" : "")}>
        <div class="ptop">
          <button class="iconbtn" aria-label="Indietro" onClick={onClose ?? pop}><Icon n="back" /></button>
          <h2>{title}</h2>
          {actions}
        </div>
        <div class="pbody">{children}</div>
      </div>
    </>
  );
}

/** Data o ora all'italiana («Sab 31 ott 2026», «20:00»): toccandola si apre sotto il selettore, come nel calendario Samsung. */
function DTChip({ type, value, on, bad, onClick }: { type: "date" | "time"; value: string; on: boolean; bad?: boolean; onClick: () => void }) {
  let label = value || "—";
  if (type === "date" && value) {
    const d = parseYmd(value);
    label = `${cap(DAYS_SHORT[d.getDay()])} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  }
  return <button type="button" class={"dtf " + type + (on ? " on" : "") + (bad ? " bad" : "")} onClick={onClick}>{label}</button>;
}

const IH = 40;                                         // altezza di una voce della rotella
/** Rotella che scorre col dito e si ferma sulla voce (come il selettore dell'ora Samsung), con vibrazione a ogni scatto. */
function Wheel({ n, value, onChange }: { n: number; value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const cb = useRef(onChange);
  cb.current = onChange;                                 // sempre la versione aggiornata (l'altra rotella puo' essere appena cambiata)
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !busy.current) { el.scrollTop = value * IH; setCur(value); }
  }, [value]);
  const onScroll = () => {
    const el = ref.current!;
    busy.current = true;
    const i = Math.max(0, Math.min(n - 1, Math.round(el.scrollTop / IH)));
    if (i !== cur) { setCur(i); void tick("w" + i); }
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => {
      busy.current = false;
      const j = Math.max(0, Math.min(n - 1, Math.round(el.scrollTop / IH)));
      cb.current(j);
    }, 110);
  };
  return (
    <div class="wheel" ref={ref} onScroll={onScroll}>
      <div style={{ height: `${IH * 2}px` }} />
      {Array.from({ length: n }, (_, i) => (
        <div class={"wi" + (i === cur ? " on" : "")} onClick={() => ref.current?.scrollTo({ top: i * IH, behavior: "smooth" })}>{String(i).padStart(2, "0")}</div>
      ))}
      <div style={{ height: `${IH * 2}px` }} />
    </div>
  );
}

function TimeWheel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const vr = useRef(value);
  vr.current = value;
  const [h, m] = (value || "09:00").split(":").map((x) => parseInt(x) || 0);
  const cur = () => (vr.current || "09:00").split(":").map((x) => parseInt(x) || 0);
  const out = (hh: number, mm: number) => {
    const v = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    if (v !== vr.current) { vr.current = v; onChange(v); }
  };
  return (
    <div class="twheel">
      <div class="band" />
      <Wheel n={24} value={h} onChange={(v) => out(v, cur()[1])} />
      <span class="sep">:</span>
      <Wheel n={60} value={m} onChange={(v) => out(cur()[0], v)} />
    </div>
  );
}

function DatePick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const d = parseYmd(value);
  const [m, setM] = useState(new Date(d.getFullYear(), d.getMonth(), 1));
  return (
    <div class="datepick minical">
      <header>
        <b>{cap(MONTHS_FULL[m.getMonth()])} {m.getFullYear()}</b>
        <button type="button" class="iconbtn" aria-label="Mese precedente" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))}><Icon n="left" s /></button>
        <button type="button" class="iconbtn" aria-label="Mese successivo" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))}><Icon n="right" s /></button>
      </header>
      <MiniMonth y={m.getFullYear()} m={m.getMonth()} compact sel={d} onPick={(x) => { void tick(ymd(x)); onChange(ymd(x)); }} />
    </div>
  );
}
const MONTHS_FULL = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export const REMINDERS: [number, string][] = [[0, "All'ora dell'evento"], [5, "5 minuti prima"], [10, "10 minuti prima"], [15, "15 minuti prima"],
  [30, "30 minuti prima"], [60, "1 ora prima"], [120, "2 ore prima"], [1440, "1 giorno prima"], [2880, "2 giorni prima"], [10080, "1 settimana prima"]];
const REM_ALLDAY: [number, string][] = [[0, "Il giorno stesso alle 9:00"], [1440, "Il giorno prima alle 9:00"], [2880, "2 giorni prima alle 9:00"], [10080, "1 settimana prima alle 9:00"]];
export function remLabel(m: number, allDay: boolean): string {
  const l = (allDay ? REM_ALLDAY : REMINDERS).find((x) => x[0] === m);
  if (l) return l[1];
  return m % 1440 === 0 ? `${m / 1440} giorni prima` : m % 60 === 0 ? `${m / 60} ore prima` : `${m} minuti prima`;
}

export function whenText(o: Occ): string {
  const s = o.start, e = o.end;
  if (o.allDay) {
    const last = addDays(e, -1);
    return startOfDay(s).getTime() === startOfDay(last).getTime() ? `${fmtLongDay(s)} · Tutto il giorno` : `${fmtLongDay(s)} – ${fmtLongDay(last)}`;
  }
  if (startOfDay(s).getTime() === startOfDay(new Date(e.getTime() - 1)).getTime() || e.getTime() === s.getTime()) return `${fmtLongDay(s)} · ${hm(s)} – ${hm(e)}`;
  return `${fmtLongDay(s)} ${hm(s)} – ${fmtLongDay(e)} ${hm(e)}`;
}

// ------------------------------------------------------------------------------------------------------ dettaglio
export function Detail({ occ }: { occ: Occ }) {
  const ev = evMap.value.get(occ.ev.id) ?? occ.ev;
  if (ev.deleted) { setTimeout(pop, 0); return null; }
  const o = { ...occ, ev, color: evColor(ev) };
  const cal = calById.value.get(ev.calendar_id || "");
  const doEdit = () => (ev.rrule ? replaceTop({ t: "scope", occ: o, action: "edit" }) : replaceTop({ t: "editor", ev, isNew: false }));
  const doDel = () => {
    if (ev.rrule) { replaceTop({ t: "scope", occ: o, action: "delete" }); return; }
    void deleteEvent(ev.id);
    pop();
    showToast("Evento eliminato", { label: "Annulla", run: () => void saveEvent({ ...ev, deleted: false }) });
  };
  const dup = () => replaceTop({ t: "editor", ev: { ...ev, id: uuid(), rrule: ev.rrule, exdates: [] }, isNew: true });
  return (
    <>
      <div class="scrim" onClick={pop} />
      <div class="sheet detail">
        <div class="acts">
          {!isHoliday(ev) && <>
            <button class="iconbtn" aria-label="Duplica" title="Duplica" onClick={dup}><Icon n="copy" /></button>
            <button class="iconbtn" aria-label="Elimina" title="Elimina" onClick={doDel}><Icon n="trash" /></button>
            <button class="iconbtn" aria-label="Modifica" title="Modifica" onClick={doEdit}><Icon n="edit" /></button>
          </>}
          <button class="iconbtn" aria-label="Chiudi" onClick={pop}><Icon n="close" /></button>
        </div>
        <div class="head">
          <div class="bar" style={{ background: o.color }} />
          <div>
            <h2>{ev.title || "(senza titolo)"}</h2>
            <div class="when">{whenText(o)}</div>
          </div>
        </div>
        <div style={{ overflow: "auto", paddingBottom: "10px" }}>
          {ev.rrule && <div class="row"><Icon n="repeat" /><div class="grow lab">{describeRule(ev.rrule, o.start)}</div></div>}
          {ev.reminders.length > 0 && <div class="row"><Icon n="bell" /><div class="grow lab">{ev.reminders.slice().sort((a, b) => a - b).map((m) => remLabel(m, ev.all_day)).join(", ")}</div></div>}
          {ev.location && <div class="row"><Icon n="place" /><div class="grow lab">{ev.location}</div></div>}
          {ev.notes && <div class="row" style={{ alignItems: "flex-start" }}><Icon n="notes" /><div class="grow lab" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{ev.notes}</div></div>}
          {cal && <div class="row"><Icon n="cal" /><div class="grow lab">{cal.name}</div><span class="cdot" style={{ background: cal.color }} /></div>}
          {isHoliday(ev) && <div class="row"><Icon n="cal" /><div class="grow lab">Festività nazionale</div><span class="cdot" style={{ background: o.color }} /></div>}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------- ripetizioni: quale parte
export function Scope({ occ, action }: { occ: Occ; action: "edit" | "delete" }) {
  const ev = evMap.value.get(occ.ev.id) ?? occ.ev;
  const first = expand(ev, utcOrLocalStart(ev), addDays(occ.start, 1), "")[0];
  const isFirst = !first || first.key === occ.key;
  const go = (scope: "one" | "after" | "all") => {
    if (action === "edit") {
      if (scope === "all") replaceTop({ t: "editor", ev, isNew: false, occ, scope });
      else {
        const s = occ.start, e = occ.end;
        const draft: Ev = {
          ...ev, id: uuid(), exdates: [],
          start_at: ev.all_day ? localDateToUtcIso(s) : s.toISOString(),
          end_at: ev.all_day ? localDateToUtcIso(addDays(e, -1)) : e.toISOString(),
          rrule: scope === "one" ? null : ev.rrule,
        };
        replaceTop({ t: "editor", ev: draft, isNew: false, occ, scope });
      }
      return;
    }
    if (scope === "all" || (scope === "after" && isFirst)) void deleteEvent(ev.id);
    else if (scope === "one") void saveEvent({ ...ev, exdates: [...new Set([...(ev.exdates || []), ymd(occ.start)])] });
    else void saveEvent({ ...ev, rrule: endRuleBefore(ev, occ.start) });
    pop();
    showToast("Eliminato", { label: "Annulla", run: () => void saveEvent({ ...ev }) });
  };
  return (
    <>
      <div class="scrim" onClick={pop} />
      <div class="sheet">
        <div style={{ padding: "22px 22px 6px", fontWeight: 700, fontSize: "18px" }}>{action === "edit" ? "Modifica evento ricorrente" : "Elimina evento ricorrente"}</div>
        <div class="card" style={{ margin: "8px 12px" }}>
          <button class="row click" onClick={() => go("one")}><div class="grow lab">Solo questo evento</div></button>
          {!isFirst && <button class="row click" onClick={() => go("after")}><div class="grow lab">Questo e i successivi</div></button>}
          <button class="row click" onClick={() => go("all")}><div class="grow lab">Tutti gli eventi</div></button>
        </div>
        <div style={{ textAlign: "right", padding: "0 14px 14px" }}><button class="btn text" onClick={pop}>Annulla</button></div>
      </div>
    </>
  );
}
function utcOrLocalStart(ev: Ev): Date {
  return ev.all_day ? utcDateToLocal(ev.start_at) : new Date(ev.start_at);
}
function endRuleBefore(ev: Ev, occStart: Date): string | null {
  const r = parseRule(ev.rrule);
  if (!r) return null;
  r.until = ymd(addDays(occStart, -1));
  r.count = null;
  return ruleToString(r);
}

// ------------------------------------------------------------------------------------------------------- editor
const toLocalInput = (d: Date) => ({ date: ymd(d), time: hm(d) });

export function Editor({ ev, isNew, occ, scope }: { ev: Ev; isNew: boolean; occ?: Occ; scope?: "one" | "after" | "all" }) {
  const s0 = ev.all_day ? utcDateToLocal(ev.start_at) : new Date(ev.start_at);
  const e0 = ev.all_day ? utcDateToLocal(ev.end_at) : new Date(ev.end_at);
  const [title, setTitle] = useState(ev.title);
  const [allDay, setAllDay] = useState(ev.all_day);
  const [sd, setSd] = useState(toLocalInput(s0));
  const [ed, setEd] = useState(toLocalInput(e0));
  const [calId, setCalId] = useState(ev.calendar_id);
  const [color, setColor] = useState<string | null>(ev.color);
  const [rule, setRule] = useState<Rule | null>(parseRule(ev.rrule));
  const [rem, setRem] = useState<number[]>(ev.reminders);
  const [loc, setLoc] = useState(ev.location);
  const [notes, setNotes] = useState(ev.notes);
  const [showColors, setShowColors] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  const [pick, setPick] = useState<null | "sd" | "st" | "ed" | "et">(null);   // selettore aperto (data/ora di inizio/fine)
  const tog = (k: "sd" | "st" | "ed" | "et") => setPick(pick === k ? null : k);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isNew) setTimeout(() => titleRef.current?.focus(), 250); }, []);
  const cal = calById.value.get(calId || "");
  const shown = color || cal?.color || "#3b82f6";
  const start = allDay ? parseYmd(sd.date) : new Date(`${sd.date}T${sd.time || "00:00"}`);
  const end = allDay ? parseYmd(ed.date) : new Date(`${ed.date}T${ed.time || "00:00"}`);
  const bad = !(end >= start) || isNaN(start.getTime()) || isNaN(end.getTime());

  const setStart = (v: { date: string; time: string }) => {           // l'inizio sposta anche la fine, mantenendo la durata
    const ns = allDay ? parseYmd(v.date) : new Date(`${v.date}T${v.time || "00:00"}`);
    if (!isNaN(ns.getTime()) && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
      const ne = allDay ? addDays(ns, Math.round((end.getTime() - start.getTime()) / 86400000)) : new Date(ns.getTime() + (end.getTime() - start.getTime()));
      setEd(toLocalInput(ne));
    }
    setSd(v);
  };
  const save = async () => {
    if (bad) return;
    const row: Ev = {
      ...ev, title: title.trim(), all_day: allDay, calendar_id: calId, color, location: loc.trim(), notes: notes.trim(),
      rrule: rule ? ruleToString(rule) : null, reminders: [...new Set(rem)].sort((a, b) => a - b),
      start_at: allDay ? localDateToUtcIso(start) : start.toISOString(),
      end_at: allDay ? localDateToUtcIso(end) : end.toISOString(),
    };
    if (occ && scope && scope !== "all") {
      const master = evMap.value.get(occ.ev.id) ?? occ.ev;
      if (scope === "one") await saveEvent({ ...master, exdates: [...new Set([...(master.exdates || []), ymd(occ.start)])] });
      else {
        const r = parseRule(master.rrule);
        if (r?.count && rule) {                                          // «dopo N volte»: alla nuova serie restano quelle mancanti
          const before = expand({ ...master, exdates: [] }, utcOrLocalStart(master), occ.start, "").length;
          rule.count = Math.max(1, r.count - before);
          row.rrule = ruleToString(rule);
        }
        await saveEvent({ ...master, rrule: endRuleBefore(master, occ.start) });
      }
    }
    await saveEvent(row);
    closeAll();
    if (!selDay.value || startOfDay(selDay.value).getTime() !== startOfDay(start).getTime()) {
      if (settings.value.view === "month") selDay.value = startOfDay(start);
    }
    cursor.value = startOfDay(start);
    showToast(isNew ? "Evento salvato" : "Modifiche salvate");
  };
  const repeatOpts: [string, Rule | null][] = [
    ["Non si ripete", null],
    ["Ogni giorno", { freq: "DAILY", interval: 1, byday: [], until: null, count: null }],
    [`Ogni settimana (${DAYS_SHORT[start.getDay() || 0]})`, { freq: "WEEKLY", interval: 1, byday: [], until: null, count: null }],
    ["Ogni giorno feriale (lun–ven)", { freq: "WEEKLY", interval: 1, byday: [1, 2, 3, 4, 5], until: null, count: null }],
    [`Ogni mese il giorno ${start.getDate() || 1}`, { freq: "MONTHLY", interval: 1, byday: [], until: null, count: null }],
    ["Ogni anno", { freq: "YEARLY", interval: 1, byday: [], until: null, count: null }],
  ];
  const remOpts = allDay ? REM_ALLDAY : REMINDERS;
  return (
    <Page title={isNew ? "Nuovo evento" : "Modifica evento"} dialog actions={<button class="btn primary" style={{ height: "40px", marginRight: "6px" }} disabled={bad} onClick={save}>Salva</button>}>
      <div class="card">
        <div class="row">
          <button class="cdot" aria-label="Colore" style={{ width: "22px", height: "22px", background: shown }} onClick={() => setShowColors(!showColors)} />
          <input ref={titleRef} class="inp bigtitle grow" placeholder="Titolo" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} maxLength={300} />
        </div>
        {showColors && (
          <div class="palette">
            <button aria-label="Colore del calendario" class={!color ? "on" : ""} style={{ background: cal?.color || "#3b82f6", color: cal?.color }} onClick={() => { setColor(null); setShowColors(false); }}>{!color && <Icon n="check" s />}</button>
            {PALETTE.map((p) => <button aria-label={p} class={color === p ? "on" : ""} style={{ background: p, color: p }} onClick={() => { setColor(p); setShowColors(false); }}>{color === p && <Icon n="check" s />}</button>)}
          </div>
        )}
      </div>
      <div class="card">
        <div class="row"><Icon n="clock" /><div class="grow lab">Tutto il giorno</div><Switch on={allDay} label="Tutto il giorno" onChange={setAllDay} /></div>
        <div class="row">
          <div style={{ width: "24px" }} />
          <div class="grow"><div class="val" style={{ marginBottom: "6px" }}>Inizio</div>
            <div class="dt">
              <DTChip type="date" value={sd.date} on={pick === "sd"} onClick={() => tog("sd")} />
              {!allDay && <DTChip type="time" value={sd.time} on={pick === "st"} onClick={() => tog("st")} />}
            </div>
          </div>
        </div>
        {pick === "sd" && <div class="picker"><DatePick value={sd.date} onChange={(v) => { setStart({ ...sd, date: v }); setPick(null); }} /></div>}
        {pick === "st" && !allDay && <div class="picker"><TimeWheel value={sd.time} onChange={(v) => setStart({ ...sd, time: v })} /></div>}
        <div class="row">
          <div style={{ width: "24px" }} />
          <div class="grow"><div class="val" style={{ marginBottom: "6px", color: bad ? "var(--danger)" : undefined }}>{bad ? "La fine deve venire dopo l'inizio" : "Fine"}</div>
            <div class="dt">
              <DTChip type="date" value={ed.date} on={pick === "ed"} bad={bad} onClick={() => tog("ed")} />
              {!allDay && <DTChip type="time" value={ed.time} on={pick === "et"} bad={bad} onClick={() => tog("et")} />}
            </div>
          </div>
        </div>
        {pick === "ed" && <div class="picker"><DatePick value={ed.date} onChange={(v) => { setEd({ ...ed, date: v }); setPick(null); }} /></div>}
        {pick === "et" && !allDay && <div class="picker"><TimeWheel value={ed.time} onChange={(v) => setEd({ ...ed, time: v })} /></div>}
      </div>
      <div class="card">
        {scope !== "one" && (
          <button class="row click" onClick={() => setShowRepeat(!showRepeat)}>
            <Icon n="repeat" /><div class="grow"><div class="lab">Ripeti</div><div class="val">{rule ? describeRule(ruleToString(rule), start) : "Non si ripete"}</div></div>
          </button>
        )}
        {showRepeat && <RepeatEditor rule={rule} setRule={setRule} start={start} opts={repeatOpts} />}
        <div class="row" style={{ alignItems: "flex-start" }}>
          <Icon n="bell" />
          <div class="grow">
            <div class="lab" style={{ marginBottom: "8px" }}>Promemoria</div>
            {rem.map((m) => <button class="pill on" onClick={() => setRem(rem.filter((x) => x !== m))}>{remLabel(m, allDay)} <span class="x">✕</span></button>)}
            <select class="pill" style={{ border: 0 }} value="" onChange={(e) => { const v = parseInt((e.target as HTMLSelectElement).value); if (!isNaN(v)) setRem([...new Set([...rem, v])]); }}>
              <option value="">+ Aggiungi</option>
              {remOpts.filter(([m]) => !rem.includes(m)).map(([m, l]) => <option value={m}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="row"><Icon n="cal" />
          <select class="inp grow" value={calId || ""} onChange={(e) => setCalId((e.target as HTMLSelectElement).value || null)}>
            {visibleCals.value.map((c) => <option value={c.id}>{c.name}</option>)}
          </select>
          <span class="cdot" style={{ background: cal?.color || "#999" }} />
        </div>
        <div class="row"><Icon n="place" /><input class="inp grow" placeholder="Luogo" value={loc} onInput={(e) => setLoc((e.target as HTMLInputElement).value)} maxLength={300} /></div>
        <div class="row" style={{ alignItems: "flex-start" }}><Icon n="notes" />
          <textarea class="inp grow" rows={3} placeholder="Note" value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} maxLength={5000} style={{ resize: "vertical" }} />
        </div>
      </div>
      {!isNew && !occ && (
        <div style={{ textAlign: "center" }}>
          <button class="btn danger" onClick={() => { void deleteEvent(ev.id); closeAll(); showToast("Evento eliminato", { label: "Annulla", run: () => void saveEvent({ ...ev, deleted: false }) }); }}>Elimina evento</button>
        </div>
      )}
    </Page>
  );
}

function RepeatEditor({ rule, setRule, start, opts }: { rule: Rule | null; setRule: (r: Rule | null) => void; start: Date; opts: [string, Rule | null][] }) {
  const key = (r: Rule | null) => (r ? ruleToString({ ...r, until: null, count: null }) : "");
  const cur = key(rule);
  const custom = rule && !opts.some(([, r]) => key(r) === cur);
  const [adv, setAdv] = useState(!!custom || !!rule?.until || !!rule?.count || (rule?.interval ?? 1) > 1);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div style={{ padding: "0 18px 12px 56px" }}>
      {opts.map(([l, r]) => <button class={"pill" + (key(r) === cur ? " on" : "")} onClick={() => setRule(r ? { ...r, until: rule?.until ?? null, count: rule?.count ?? null } : null)}>{l}</button>)}
      <button class={"pill" + (adv ? " on" : "")} onClick={() => { setAdv(!adv); if (!rule) setRule({ freq: "WEEKLY", interval: 1, byday: [], until: null, count: null }); }}>Personalizza…</button>
      {adv && rule && (
        <div style={{ marginTop: "8px", display: "grid", gap: "10px" }}>
          <div class="dt">Ogni
            <input type="number" min={1} max={99} value={rule.interval} style={{ width: "70px" }} onInput={(e) => setRule({ ...rule, interval: Math.max(1, Math.min(99, parseInt((e.target as HTMLInputElement).value) || 1)) })} />
            <select class="pill" style={{ border: 0, margin: 0 }} value={rule.freq} onChange={(e) => setRule({ ...rule, freq: (e.target as HTMLSelectElement).value as Rule["freq"], byday: [] })}>
              <option value="DAILY">{rule.interval > 1 ? "giorni" : "giorno"}</option>
              <option value="WEEKLY">{rule.interval > 1 ? "settimane" : "settimana"}</option>
              <option value="MONTHLY">{rule.interval > 1 ? "mesi" : "mese"}</option>
              <option value="YEARLY">{rule.interval > 1 ? "anni" : "anno"}</option>
            </select>
          </div>
          {rule.freq === "WEEKLY" && (
            <div>{order.map((d) => {
              const on = rule.byday.length ? rule.byday.includes(d) : d === start.getDay();
              return <button class={"pill" + (on ? " on" : "")} style={{ minWidth: "44px", justifyContent: "center" }} onClick={() => {
                const base = rule.byday.length ? rule.byday : [start.getDay()];
                const nb = on ? base.filter((x) => x !== d) : [...base, d];
                setRule({ ...rule, byday: nb.length ? nb : [start.getDay()] });
              }}>{cap(DAYS_SHORT[d])}</button>;
            })}</div>
          )}
          <div class="dt">Termina
            <select class="pill" style={{ border: 0, margin: 0 }} value={rule.until ? "u" : rule.count ? "c" : "n"} onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              setRule({ ...rule, until: v === "u" ? ymd(addDays(start, 30)) : null, count: v === "c" ? 10 : null });
            }}>
              <option value="n">mai</option><option value="u">il giorno…</option><option value="c">dopo un numero di volte</option>
            </select>
            {rule.until && <input type="date" value={rule.until} onInput={(e) => setRule({ ...rule, until: (e.target as HTMLInputElement).value || null })} />}
            {rule.count && <><input type="number" min={1} max={999} value={rule.count} style={{ width: "80px" }} onInput={(e) => setRule({ ...rule, count: Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1) })} /> volte</>}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- ricerca
function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
export function Search() {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 100); }, []);
  const res = useMemo(() => {
    const n = norm(q.trim());
    if (n.length < 2) return [];
    const t = now.value, far = addDays(t, 730);
    const out: Occ[] = [];
    for (const e of events.value) {
      if (!norm(`${e.title} ${e.location} ${e.notes}`).includes(n)) continue;
      const next = expand(e, startOfDay(t), far, evColor(e))[0];
      const o = next ?? expand(e, new Date(0), far, evColor(e)).slice(-1)[0];
      if (o) out.push(o);
    }
    return out.sort((a, b) => {
      const fa = a.end >= t, fb = b.end >= t;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? a.start.getTime() - b.start.getTime() : b.start.getTime() - a.start.getTime();
    }).slice(0, 80);
  }, [q, evMap.value]);
  return (
    <div class="page">
      <div class="search">
        <button class="iconbtn" aria-label="Indietro" onClick={pop}><Icon n="back" /></button>
        <input ref={ref} placeholder="Cerca eventi" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </div>
      <div class="pbody">
        {q.trim().length >= 2 && !res.length && <div class="empty">Nessun risultato</div>}
        {res.length > 0 && (
          <div class="card" style={{ padding: "6px" }}>
            {res.map((o) => (
              <button class={"evrow" + (o.end < now.value ? " past" : "")} onClick={() => push({ t: "detail", occ: o })}>
                <div class="time" style={{ width: "62px" }}><b>{o.start.getDate()} {["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"][o.start.getMonth()]}</b>{o.start.getFullYear() !== now.value.getFullYear() ? o.start.getFullYear() : o.allDay ? "giorno" : hm(o.start)}</div>
                <div class="bar" style={{ background: o.color }} />
                <div class="t"><div class="tt">{o.ev.title || "(senza titolo)"}</div>{o.ev.location && <div class="sub">{o.ev.location}</div>}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------ calendari
export function Calendars({ add: addNow }: { add?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);         // calendario appena creato: nome selezionato, pronto da scrivere
  const add = () => {
    const used = new Set(cals.value.filter((x) => !x.deleted).map((x) => x.color));
    const color = PALETTE.find((p) => !used.has(p)) ?? PALETTE[(cals.value.length * 3) % PALETTE.length];
    const sort = Math.max(-1, ...cals.value.filter((x) => !x.deleted).map((x) => x.sort)) + 1;
    const c: Cal = { id: uuid(), name: "Nuovo calendario", color, visible: true, sort, deleted: false };
    void saveCal(c);
    setEditing(c.id);
    setFresh(c.id);
  };
  useEffect(() => { if (addNow) add(); }, []);
  const move = (c: Cal, dir: number) => {
    const list = visibleCals.value;
    const i = list.findIndex((x) => x.id === c.id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const order = list.map((x) => x.id);
    [order[i], order[j]] = [order[j], order[i]];
    order.forEach((id, k) => { const x = list.find((y) => y.id === id)!; if (x.sort !== k) void saveCal({ ...x, sort: k }); });
  };
  return (
    <Page title="Calendari" dialog actions={<button class="iconbtn" aria-label="Aggiungi calendario" onClick={add}><Icon n="plus" /></button>}>
      <div class="card">
        {visibleCals.value.map((c) => (
          <div>
            <div class="row">
              <span class="cdot" style={{ background: c.color, width: "18px", height: "18px" }} />
              <input class="inp grow" value={c.name} maxLength={80} onFocus={() => setEditing(c.id)}
                ref={(el) => { if (el && fresh === c.id) { el.focus(); el.select(); setFresh(null); } }}
                onChange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) void saveCal({ ...c, name: v }); }} />
              <Switch on={c.visible} label="Visibile" onChange={(v) => void saveCal({ ...c, visible: v })} />
            </div>
            {editing === c.id && (
              <>
                <div class="palette">
                  {PALETTE.map((p) => <button aria-label={p} class={c.color === p ? "on" : ""} style={{ background: p, color: p }} onClick={() => void saveCal({ ...c, color: p })}>{c.color === p && <Icon n="check" s />}</button>)}
                  <label class={"custom" + (!PALETTE.includes(c.color) ? " on" : "")} title="Colore a scelta" style={{ color: c.color }}>
                    <input type="color" value={c.color} onChange={(e) => void saveCal({ ...c, color: (e.target as HTMLInputElement).value.toLowerCase() })} />
                    {!PALETTE.includes(c.color) ? <Icon n="check" s /> : <Icon n="palette" s />}
                  </label>
                </div>
                <div style={{ display: "flex", gap: "8px", padding: "0 14px 12px", justifyContent: "flex-end", alignItems: "center" }}>
                  <button class="iconbtn" aria-label="Sposta su" title="Sposta su" onClick={() => move(c, -1)}><Icon n="left" style={{ transform: "rotate(90deg)" }} /></button>
                  <button class="iconbtn" aria-label="Sposta giù" title="Sposta giù" onClick={() => move(c, 1)}><Icon n="right" style={{ transform: "rotate(90deg)" }} /></button>
                  <div style={{ flex: 1 }} />
                  {visibleCals.value.length > 1 && (
                    <button class="btn danger" onClick={() => {
                      const n = events.value.filter((e) => e.calendar_id === c.id).length;
                      if (n && !confirm(`Eliminare «${c.name}» e i suoi ${n} eventi?`)) return;
                      void saveCal({ ...c, deleted: true });
                      for (const e of events.value) if (e.calendar_id === c.id) void deleteEvent(e.id);
                      setEditing(null);
                    }}>Elimina</button>
                  )}
                  <button class="btn" onClick={() => setEditing(null)}>Fatto</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <button class="btn" style={{ width: "100%", marginBottom: "12px" }} onClick={add}>+ Nuovo calendario</button>
      <div class="note">Tocca il nome per cambiarlo, scegliere il colore (anche uno a piacere con la tavolozza) e l'ordine. Con l'interruttore nascondi un calendario senza cancellarne gli eventi.</div>
    </Page>
  );
}

// ------------------------------------------------------------------------------------------------- Trofeo LCD
export function TrofeoPage() {
  const [code, setCode] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { void readTrofeoLink().then(setLinked); }, []);
  const linkHere = async () => {
    setBusy(true); setErr("");
    try {
      const key = await createDeviceKey("Trofeo LCD (questo PC)");
      const path = await writeTrofeoLink(JSON.stringify({ url: SUPABASE_URL, anon: SUPABASE_KEY, key, email: session.value?.user.email ?? "", created: new Date().toISOString() }));
      setLinked(path);
      showToast("Trofeo LCD collegato");
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  const makeCode = async () => {
    setBusy(true); setErr("");
    try { setCode(await createDeviceKey("Trofeo LCD (codice)")); } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  return (
    <Page title="Trofeo LCD" dialog>
      <div class="card">
        <div class="row"><Icon n="monitor" /><div class="grow"><div class="lab">Widget Calendario sullo schermo</div><div class="val">Pallini sui giorni con eventi, evento in corso e prossimi eventi</div></div></div>
        <div class="note">Trofeo LCD legge gli eventi in sola lettura, con una chiave che vale solo per questo account. {isTauri ? "Sul PC dove c'e' Trofeo LCD il collegamento e' automatico." : "Sul PC basta installare anche l'app Calendario: si collega da sola. Altrimenti genera un codice e incollalo in Trofeo LCD (Impostazioni → Calendario)."}</div>
      </div>
      {isTauri && (
        <div class="card">
          <div class="row"><div class="grow"><div class="lab">{linked ? "Collegato su questo PC" : "Non ancora collegato"}</div>{linked && <div class="val">{linked}</div>}</div>
            <button class="btn primary" disabled={busy} onClick={linkHere}>{linked ? "Ricollega" : "Collega"}</button></div>
        </div>
      )}
      <div class="card">
        <div class="row"><div class="grow"><div class="lab">Codice per Trofeo LCD</div><div class="val">Da incollare a mano, se serve</div></div><button class="btn" disabled={busy} onClick={makeCode}>Genera</button></div>
        {code && <><div class="code">{code}</div><div style={{ textAlign: "right", padding: "0 14px 10px" }}><button class="btn text" onClick={() => { void navigator.clipboard?.writeText(code); showToast("Codice copiato"); }}>Copia</button></div></>}
      </div>
      {err && <div class="note" style={{ color: "var(--danger)" }}>{err}</div>}
    </Page>
  );
}

// -------------------------------------------------------------------------------------------------- impostazioni
export function SettingsPage() {
  const st = settings.value;
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => { if (isTauri) void autostart().then(setAuto); }, []);
  const ss = syncState.value;
  return (
    <Page title="Impostazioni" dialog>
      <div class="card">
        <div class="row"><Icon n="person" /><div class="grow"><div class="lab">{session.value?.user.email}</div>
          <div class="val"><span class={"status " + ss}><i />{ss === "ok" ? `Sincronizzato ${lastSync.value ? hm(new Date(lastSync.value)) : ""}` : ss === "sync" ? "Sincronizzazione…" : ss === "offline" ? "Senza rete: le modifiche partono appena torna" : `Errore: ${syncError.value}`}{pendingCount.value ? ` · ${pendingCount.value} da inviare` : ""}</span></div></div>
          <button class="iconbtn" aria-label="Sincronizza ora" onClick={() => scheduleSync(0)}><Icon n="sync" /></button>
        </div>
        <button class="row click" onClick={() => push({ t: "trofeo" })}><Icon n="monitor" /><div class="grow"><div class="lab">Trofeo LCD</div><div class="val">Eventi sul widget Calendario</div></div><Icon n="right" /></button>
        <button class="row click" onClick={() => push({ t: "calendars" })}><Icon n="folder" /><div class="grow"><div class="lab">Calendari</div><div class="val">{visibleCals.value.map((c) => c.name).join(", ")}</div></div><Icon n="right" /></button>
      </div>
      <div class="card">
        <div class="row"><Icon n="cal" /><div class="grow lab">La settimana inizia di</div>
          <div class="seg"><button class={st.weekStart === 1 ? "on" : ""} onClick={() => setSettings({ weekStart: 1 })}>Lunedì</button><button class={st.weekStart === 0 ? "on" : ""} onClick={() => setSettings({ weekStart: 0 })}>Domenica</button></div></div>
        <div class="row"><Icon n="list" /><div class="grow lab">Numeri delle settimane</div><Switch on={st.weekNumbers} onChange={(v) => setSettings({ weekNumbers: v })} /></div>
        <div class="row"><Icon n="cal" /><div class="grow"><div class="lab">Festività italiane</div><div class="val">Capodanno, Pasqua, 25 aprile, Natale… in rosso</div></div><Switch on={st.holidays} onChange={(v) => setSettings({ holidays: v })} /></div>
        <div class="row"><Icon n="sun" /><div class="grow lab">Tema</div>
          <div class="seg">{(["system", "light", "dark"] as const).map((t) => <button class={st.theme === t ? "on" : ""} onClick={() => setSettings({ theme: t })}>{t === "system" ? "Auto" : t === "light" ? "Chiaro" : "Scuro"}</button>)}</div></div>
      </div>
      <div class="card">
        <div class="row"><Icon n="folder" /><div class="grow lab">Calendario predefinito</div>
          <select class="inp" style={{ width: "auto", textAlign: "right" }} value={st.defaultCal || ""} onChange={(e) => setSettings({ defaultCal: (e.target as HTMLSelectElement).value || null })}>
            <option value="">Il primo</option>{visibleCals.value.map((c) => <option value={c.id}>{c.name}</option>)}
          </select></div>
        <div class="row"><Icon n="bell" /><div class="grow lab">Promemoria predefinito</div>
          <select class="inp" style={{ width: "auto", textAlign: "right" }} value={st.defaultReminder == null ? "" : String(st.defaultReminder)} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setSettings({ defaultReminder: v === "" ? null : parseInt(v) }); }}>
            <option value="">Nessuno</option>{REMINDERS.map(([m, l]) => <option value={m}>{l}</option>)}
          </select></div>
        <div class="row"><Icon n="clock" /><div class="grow lab">Durata predefinita</div>
          <select class="inp" style={{ width: "auto", textAlign: "right" }} value={String(st.defaultDuration)} onChange={(e) => setSettings({ defaultDuration: parseInt((e.target as HTMLSelectElement).value) })}>
            {[15, 30, 45, 60, 90, 120].map((m) => <option value={m}>{m < 60 ? `${m} minuti` : m === 60 ? "1 ora" : `${m / 60} ore`}</option>)}
          </select></div>
        {isTauri && auto !== null && <div class="row"><Icon n="monitor" /><div class="grow"><div class="lab">Avvia con Windows</div><div class="val">Nell'area di notifica, per i promemoria</div></div><Switch on={auto} onChange={(v) => void autostart(v).then(setAuto)} /></div>}
      </div>
      {update.value && (
        <div class="card">
          <button class="row click" onClick={() => void openUrl(update.value!.url)}><Icon n="sync" /><div class="grow"><div class="lab">Aggiornamento disponibile</div><div class="val">Versione {update.value.version}: tocca per scaricarla e installarla</div></div><Icon n="right" /></button>
        </div>
      )}
      {!isAndroid && !isTauri && (
        <div class="card">
          <button class="row click" onClick={() => void openUrl(APK_URL)}><Icon n="cal" /><div class="grow"><div class="lab">App per Android</div><div class="val">Scarica e installa l'APK sul telefono</div></div><Icon n="right" /></button>
          <button class="row click" onClick={() => void openUrl(EXE_URL)}><Icon n="monitor" /><div class="grow"><div class="lab">App per Windows</div><div class="val">Promemoria anche a finestra chiusa e collegamento automatico a Trofeo LCD</div></div><Icon n="right" /></button>
        </div>
      )}
      <div class="card">
        <button class="row click" onClick={() => { if (confirm("Uscire dall'account? Gli eventi restano salvati online.")) { closeAll(); void signOut(); } }}><Icon n="logout" /><div class="grow lab">Esci dall'account</div></button>
      </div>
      <div class="note" style={{ textAlign: "center" }}>Calendario {APP_VERSION}{isAndroid ? " · Android" : isTauri ? " · Windows" : ""}</div>
    </Page>
  );
}

// ------------------------------------------------------------------------------------------- menu laterale (tel.)
export function Drawer() {
  const st = settings.value;
  const views: [Settings_View, string, string][] = [["year", "Anno", "year"], ["month", "Mese", "month"], ["week", "Settimana", "week"], ["day", "Giorno", "day"], ["agenda", "Elenco", "list"]];
  return (
    <>
      <div class="scrim" onClick={pop} />
      <div class="drawer">
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 12px 16px" }}><div class="logo" style={{ width: "40px", height: "40px", fontSize: "17px", borderRadius: "13px" }}>{now.value.getDate()}</div><b style={{ fontSize: "19px" }}>Calendario</b></div>
        {views.map(([v, l, ic]) => <button class={"navitem" + (st.view === v ? " on" : "")} onClick={() => { setSettings({ view: v }); selDay.value = null; pop(); }}><Icon n={ic} />{l}</button>)}
        <div class="sect">Calendari</div>
        <CalToggles />
        <button class="calitem addcal" onClick={() => replaceTop({ t: "calendars", add: true })}><span class="box"><Icon n="plus" /></span><span>Nuovo calendario</span></button>
        <div style={{ flex: 1 }} />
        <button class="navitem" onClick={() => replaceTop({ t: "calendars" })}><Icon n="folder" />Gestisci calendari</button>
        <button class="navitem" onClick={() => replaceTop({ t: "settings" })}><Icon n="settings" />Impostazioni</button>
      </div>
    </>
  );
}
type Settings_View = "year" | "month" | "week" | "day" | "agenda";

export function CalToggles() {
  return (
    <>
      {visibleCals.value.map((c) => (
        <button class="calitem" onClick={() => void saveCal({ ...c, visible: !c.visible })}>
          <span class="box" style={{ borderColor: c.color, background: c.visible ? c.color : "transparent" }}>{c.visible && <Icon n="check" />}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
        </button>
      ))}
    </>
  );
}

export function SideMini() {
  const c = cursor.value;
  const [m, setM] = useState(new Date(c.getFullYear(), c.getMonth(), 1));
  useEffect(() => setM(new Date(c.getFullYear(), c.getMonth(), 1)), [c.getFullYear(), c.getMonth()]);
  return (
    <div class="minical">
      <header>
        <b>{cap(["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"][m.getMonth()])} {m.getFullYear()}</b>
        <button class="iconbtn" aria-label="Mese precedente" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))}><Icon n="left" s /></button>
        <button class="iconbtn" aria-label="Mese successivo" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))}><Icon n="right" s /></button>
      </header>
      <MiniMonth y={m.getFullYear()} m={m.getMonth()} compact sel={selDay.value ?? c} onPick={(d) => { cursor.value = d; selDay.value = d; }} />
    </div>
  );
}
