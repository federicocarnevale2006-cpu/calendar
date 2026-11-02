import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { tick } from "./drag";
import { addDays, cap, DAYS_SHORT, fmtLongDay, hm, localDateToUtcIso, MONTHS_SHORT, parseYmd, startOfDay, utcDateToLocal, ymd } from "../date";
import { describeRule, expand, parseRule, ruleToString, uuid, type Cal, type Ev, type Occ, type Rule } from "../model";
import { APK_URL, APP_VERSION, EXE_URL, PALETTE, SUPABASE_KEY, SUPABASE_URL } from "../config";
import {
  calById, cals, createDeviceKey, createShiftKey, isHoliday, deleteEvent, evColor, events, evMap, lastSync, pendingCount, saveCal, saveEvent, session, setSettings,
  settings, signOut, supabase, syncError, syncState, scheduleSync, visibleCals, setMultiMark, type MultiMark,
} from "../store";
import { autostart, autoUpdatePC, isAndroid, isTauri, nativePushStatus, openUrl, pcUpdate, readTrofeoLink, restartApp, update, writeTrofeoLink, type PushStatus } from "../platform";
import { cursor, now, pop, push, replaceTop, selDay, showToast, closeAll } from "./state";
import { Icon } from "./icons";
import { GMAIL_MANIFEST, gmailScript, SHIFT_SENDER } from "../gmailScript";
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
function Wheel({ n, value, onChange, labels, w }: { n: number; value: number; onChange: (v: number) => void; labels?: string[]; w?: number }) {
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
    <div class={"wheel" + (labels ? " txt" : "")} ref={ref} onScroll={onScroll} style={w ? { width: `${w}px` } : undefined}>
      <div style={{ height: `${IH * 2}px` }} />
      {Array.from({ length: n }, (_, i) => (
        <div class={"wi" + (i === cur ? " on" : "")} onClick={() => ref.current?.scrollTo({ top: i * IH, behavior: "smooth" })}>{labels ? labels[i] : String(i).padStart(2, "0")}</div>
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

// Promemoria = minuti prima dell'inizio (per «tutto il giorno»: prima delle 9:00 del giorno). Qualsiasi valore, scelto con le rotelle.
const UNITS: [number, string, string][] = [[1, "minuto", "minuti"], [60, "ora", "ore"], [1440, "giorno", "giorni"], [10080, "settimana", "settimane"]];
const MAXN = 120, MAXD = 60;
function splitTimed(m: number): [number, number] {                     // [quanti, unita']
  if (m <= 0) return [0, 0];
  for (let u = 3; u >= 1; u--) if (m % UNITS[u][0] === 0 && m / UNITS[u][0] <= MAXN) return [m / UNITS[u][0], u];
  return [Math.min(MAXN, m), 0];
}
function splitAllDay(m: number): [number, number] {                    // [giorni prima, minuti dalla mezzanotte]
  let t = 540 - m, d = 0;
  while (t < 0) { t += 1440; d++; }
  while (t >= 1440) { t -= 1440; d--; }
  return [Math.max(0, d), t];
}
const hhmm = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
export function remLabel(m: number, allDay: boolean): string {
  if (allDay) {
    const [d, t] = splitAllDay(m);
    return `${d === 0 ? "Il giorno stesso" : d === 1 ? "Il giorno prima" : `${d} giorni prima`} alle ${hhmm(t)}`;
  }
  if (m <= 0) return "All'ora dell'evento";
  const [n, u] = splitTimed(m);
  return `${n} ${n === 1 ? UNITS[u][1] : UNITS[u][2]} prima`;
}
/** Quando arriva l'avviso (per l'anteprima). */
function remAt(start: Date, allDay: boolean, m: number): Date {
  const base = allDay ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 0) : start;
  return new Date(base.getTime() - m * 60000);
}
const NUM_LABELS = Array.from({ length: MAXN + 1 }, (_, i) => String(i));
const DAY_LABELS = Array.from({ length: MAXD + 1 }, (_, i) => (i === 0 ? "Il giorno stesso" : i === 1 ? "1 giorno prima" : `${i} giorni prima`));

/** Scelta da un elenco nello stile dell'app (al posto del menu di sistema). */
export function ChoiceSheet({ title, options, value, onPick, danger }: { title: string; options: [string, string][]; value: string; onPick: (v: string) => void; danger?: string[] }) {
  return (
    <>
      <div class="scrim top" onClick={pop} />
      <div class="sheet choicesheet" role="dialog" aria-label={title}>
        <div class="grip" />
        <div class="chtitle">{title}</div>
        <div class="chlist">
          {options.map(([v, l]) => (
            <button type="button" class={"chopt" + (v === value ? " on" : "") + (danger?.includes(v) ? " danger" : "")} onClick={() => { pop(); if (v !== value) onPick(v); }}>
              <span class="grow">{l}</span>{v === value && <Icon n="check" />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
function Choice({ cls, title, value, options, onPick }: { cls: string; title: string; value: string; options: [string, string][]; onPick: (v: string) => void }) {
  const label = options.find((o) => o[0] === value)?.[1] ?? "";
  return <button type="button" class={cls + " choice"} onClick={() => push({ t: "choice", title, options, value, onPick })}>{label}<span class="chev">▾</span></button>;
}

/** Pannello per scegliere il promemoria: quanto prima, con le rotelle (nessuna lista fissa). */
export function RemSheet({ allDay, start, value, onPick, none }: { allDay: boolean; start?: Date; value: number | null; onPick: (m: number | null) => void; none?: boolean }) {
  const init = value ?? (allDay ? 1440 : 15);
  const [a, setA] = useState(() => (allDay ? splitAllDay(init)[0] : splitTimed(init)[0]));
  const [u, setU] = useState(() => splitTimed(init)[1]);
  const [h, setH] = useState(() => Math.floor(splitAllDay(init)[1] / 60));
  const [mi, setMi] = useState(() => splitAllDay(init)[1] % 60);
  const m = allDay ? a * 1440 + 540 - (h * 60 + mi) : a * UNITS[u][0];
  const at = start && !isNaN(start.getTime()) ? remAt(start, allDay, m) : null;
  const past = at ? at.getTime() < Date.now() : false;
  const done = (v: number | null) => { pop(); onPick(v); };
  return (
    <>
      <div class="scrim top" onClick={pop} />
      <div class="sheet remsheet" role="dialog" aria-label="Promemoria">
        <div class="grip" />
        <div class="remhead">
          <Icon n="bell" />
          <div class="grow">
            <div class="remval">{remLabel(m, allDay)}</div>
            {at && <div class={"remwhen" + (past ? " past" : "")}>{past ? "Già passato: " : "Avviso "}{DAYS_SHORT[at.getDay()]} {at.getDate()} {MONTHS_SHORT[at.getMonth()]} alle {hm(at)}</div>}
          </div>
        </div>
        {allDay ? (
          <div class="twheel rem">
            <div class="band" />
            <Wheel n={MAXD + 1} value={a} onChange={setA} labels={DAY_LABELS} w={170} />
            <span class="alle">alle</span>
            <Wheel n={24} value={h} onChange={setH} w={56} />
            <span class="sep">:</span>
            <Wheel n={60} value={mi} onChange={setMi} w={56} />
          </div>
        ) : (
          <div class="twheel rem">
            <div class="band" />
            <Wheel n={MAXN + 1} value={a} onChange={setA} labels={NUM_LABELS} w={70} />
            <Wheel n={4} value={u} onChange={setU} labels={UNITS.map((x) => (a === 1 ? x[1] : x[2]))} w={130} />
            <span class="alle">prima</span>
          </div>
        )}
        <div class="rembtns">
          {none && <button class="btn" onClick={() => done(null)}>Nessuno</button>}
          <span class="grow" />
          <button class="btn" onClick={pop}>Annulla</button>
          <button class="btn primary" onClick={() => done(m)}>{value == null ? "Aggiungi" : "Fatto"}</button>
        </div>
      </div>
    </>
  );
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
          <div class="row"><Icon n="clock" /><div class="grow lab">{dday(o.start)}</div></div>
        </div>
        {!isHoliday(ev) && (
          <div class="dbar">
            <button onClick={doEdit}><Icon n="edit" /><span>Modifica</span></button>
            <button onClick={() => share(o)}><Icon n="share" /><span>Condividi</span></button>
            <button onClick={dup}><Icon n="copy" /><span>Duplica</span></button>
            <button class="del" onClick={doDel}><Icon n="trash" /><span>Elimina</span></button>
          </div>
        )}
      </div>
    </>
  );
}

/** Conto alla rovescia come il «D-Day» del calendario Samsung. */
function dday(d: Date): string {
  const n = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000);
  if (n === 0) return "Oggi · D-Day";
  if (n === 1) return "Domani · D-1";
  if (n > 0) return `Fra ${n} giorni · D-${n}`;
  if (n === -1) return "Ieri · D+1";
  return `${-n} giorni fa · D+${-n}`;
}

async function share(o: Occ) {
  const text = [o.ev.title || "(senza titolo)", whenText(o), o.ev.location, o.ev.notes].filter(Boolean).join("\n");
  try {
    if ((navigator as any).share) { await (navigator as any).share({ title: o.ev.title, text }); return; }
  } catch { return; }                                    // annullato dall'utente
  try { await navigator.clipboard.writeText(text); showToast("Evento copiato: incollalo dove vuoi"); } catch { showToast("Condivisione non disponibile"); }
}

// ------------------------------------------------------------------------------------- inserimento rapido
/** Come il «+» del calendario Samsung: un pannello in basso con titolo, orari e calendario; «Dettagli» apre tutto. */
export function QuickSheet({ ev }: { ev: Ev }) {
  const s0 = ev.all_day ? utcDateToLocal(ev.start_at) : new Date(ev.start_at);
  const e0 = ev.all_day ? utcDateToLocal(ev.end_at) : new Date(ev.end_at);
  const [title, setTitle] = useState(ev.title);
  const [allDay, setAllDay] = useState(ev.all_day);
  const [sd, setSd] = useState(toLocalInput(s0));
  const [ed, setEd] = useState(toLocalInput(e0));
  const [calId, setCalId] = useState(ev.calendar_id);
  const [pick, setPick] = useState<null | "sd" | "st" | "ed" | "et" | "cal">(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 200); }, []);
  const start = allDay ? parseYmd(sd.date) : new Date(`${sd.date}T${sd.time || "00:00"}`);
  const end = allDay ? parseYmd(ed.date) : new Date(`${ed.date}T${ed.time || "00:00"}`);
  const bad = !(end >= start) || isNaN(start.getTime()) || isNaN(end.getTime());
  const cal = calById.value.get(calId || "");
  const setStart = (v: { date: string; time: string }) => {
    const ns = allDay ? parseYmd(v.date) : new Date(`${v.date}T${v.time || "00:00"}`);
    if (!isNaN(ns.getTime()) && !bad) setEd(toLocalInput(new Date(ns.getTime() + (end.getTime() - start.getTime()))));
    setSd(v);
  };
  const row = (): Ev => ({
    ...ev, title: title.trim(), all_day: allDay, calendar_id: calId,
    start_at: allDay ? localDateToUtcIso(start) : start.toISOString(), end_at: allDay ? localDateToUtcIso(end) : end.toISOString(),
  });
  const save = async () => {
    if (bad) return;
    await saveEvent(row());
    closeAll();
    if (settings.value.view === "month") selDay.value = startOfDay(start);
    cursor.value = startOfDay(start);
    showToast("Evento salvato");
  };
  const tog = (k: NonNullable<typeof pick>) => setPick(pick === k ? null : k);
  return (
    <>
      <div class="scrim" onClick={pop} />
      <div class="sheet quick">
        <div class="grip" />
        <div class="qtitle">
          <input ref={ref} class="inp" placeholder="Titolo" value={title} maxLength={300} onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
          <button type="button" class="qcal" onClick={() => tog("cal")}><span class="cdot" style={{ background: cal?.color || "#3b82f6" }} />{cal?.name || "Calendario"}</button>
        </div>
        {pick === "cal" && (
          <div class="qcals">{visibleCals.value.map((c) => (
            <button type="button" class={c.id === calId ? "on" : ""} onClick={() => { setCalId(c.id); setPick(null); }}><span class="cdot" style={{ background: c.color }} />{c.name}</button>
          ))}</div>
        )}
        <div class="qrow">
          <span class="lab">Tutto il giorno</span>
          <Switch on={allDay} label="Tutto il giorno" onChange={setAllDay} />
        </div>
        <div class="qrow">
          <span class="lab">Inizio</span>
          <div class="dt"><DTChip type="date" value={sd.date} on={pick === "sd"} onClick={() => tog("sd")} />
            {!allDay && <DTChip type="time" value={sd.time} on={pick === "st"} onClick={() => tog("st")} />}</div>
        </div>
        {pick === "sd" && <div class="picker q"><DatePick value={sd.date} onChange={(v) => { setStart({ ...sd, date: v }); setPick(null); }} /></div>}
        {pick === "st" && !allDay && <div class="picker q"><TimeWheel value={sd.time} onChange={(v) => setStart({ ...sd, time: v })} /></div>}
        <div class="qrow">
          <span class="lab" style={{ color: bad ? "var(--danger)" : undefined }}>Fine</span>
          <div class="dt"><DTChip type="date" value={ed.date} on={pick === "ed"} bad={bad} onClick={() => tog("ed")} />
            {!allDay && <DTChip type="time" value={ed.time} on={pick === "et"} bad={bad} onClick={() => tog("et")} />}</div>
        </div>
        {pick === "ed" && <div class="picker q"><DatePick value={ed.date} onChange={(v) => { setEd({ ...ed, date: v }); setPick(null); }} /></div>}
        {pick === "et" && !allDay && <div class="picker q"><TimeWheel value={ed.time} onChange={(v) => setEd({ ...ed, time: v })} /></div>}
        <div class="qbtns">
          <button type="button" class="btn text" onClick={() => replaceTop({ t: "editor", ev: row(), isNew: true })}>Dettagli</button>
          <div style={{ flex: 1 }} />
          <button type="button" class="btn" onClick={pop}>Annulla</button>
          <button type="button" class="btn primary" disabled={bad} onClick={save}>Salva</button>
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
  const [showCals, setShowCals] = useState(false);
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
            {rem.slice().sort((a, b) => a - b).map((m) => (
              <span class="pill on rempill">
                <button type="button" class="remedit" onClick={() => push({ t: "rem", allDay, start, value: m, onPick: (v) => { if (v != null) setRem((r) => [...new Set(r.map((x) => (x === m ? v : x)))]); } })}>{remLabel(m, allDay)}</button>
                <button type="button" class="x" aria-label="Togli promemoria" onClick={() => setRem((r) => r.filter((x) => x !== m))}>✕</button>
              </span>
            ))}
            <button type="button" class="pill addrem" onClick={() => push({ t: "rem", allDay, start, value: null, onPick: (v) => { if (v != null) setRem((r) => [...new Set([...r, v])]); } })}><Icon n="plus" s /> Aggiungi</button>
          </div>
        </div>
      </div>
      <div class="card">
        <button type="button" class="row click" onClick={() => setShowCals(!showCals)}><Icon n="cal" />
          <div class="grow lab">{cal?.name || "Calendario"}</div>
          <span class="cdot" style={{ background: cal?.color || "#999" }} />
        </button>
        {showCals && (
          <div class="qcals ed">{visibleCals.value.map((c) => (
            <button type="button" class={c.id === calId ? "on" : ""} onClick={() => { setCalId(c.id); setShowCals(false); }}><span class="cdot" style={{ background: c.color }} />{c.name}</button>
          ))}</div>
        )}
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
            <Choice cls="pill" title="Ripeti ogni" value={rule.freq} onPick={(v) => setRule({ ...rule, freq: v as Rule["freq"], byday: [] })}
              options={[["DAILY", rule.interval > 1 ? "giorni" : "giorno"], ["WEEKLY", rule.interval > 1 ? "settimane" : "settimana"], ["MONTHLY", rule.interval > 1 ? "mesi" : "mese"], ["YEARLY", rule.interval > 1 ? "anni" : "anno"]]} />
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
            <Choice cls="pill" title="Termina" value={rule.until ? "u" : rule.count ? "c" : "n"}
              onPick={(v) => setRule({ ...rule, until: v === "u" ? ymd(addDays(start, 30)) : null, count: v === "c" ? 10 : null })}
              options={[["n", "mai"], ["u", "il giorno…"], ["c", "dopo un numero di volte"]]} />
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
  useEffect(() => { if (addNow) push({ t: "calEdit", id: null }); }, []);
  const menu = (c: Cal) => {
    void tick("cal" + c.id);
    push({ t: "choice", title: c.name, value: "", danger: ["delete"], options: [["edit", "Modifica"], ["delete", "Elimina"]],
      onPick: (v) => { if (v === "edit") push({ t: "calEdit", id: c.id }); else askDeleteCal(c); } });
  };
  return (
    <Page title="Calendari" dialog actions={<button class="iconbtn" aria-label="Aggiungi calendario" onClick={() => push({ t: "calEdit", id: null })}><Icon n="plus" /></button>}>
      <div class="card">
        {visibleCals.value.map((c) => <CalRow key={c.id} c={c} onMenu={() => menu(c)} />)}
      </div>
      <button class="btn" style={{ width: "100%", marginBottom: "12px" }} onClick={() => push({ t: "calEdit", id: null })}>+ Nuovo calendario</button>
      <div class="note">Tieni premuto un calendario (sul PC: tasto destro) per modificarlo o eliminarlo. Con l'interruttore nascondi un calendario senza cancellarne gli eventi.</div>
    </Page>
  );
}

/** Riga di un calendario: tenendo premuto (o col tasto destro) si apre il menu Modifica / Elimina; un tocco apre la modifica. */
function CalRow({ c, onMenu }: { c: Cal; onMenu: () => void }) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(0);
  const clear = () => { if (t.current) { clearTimeout(t.current); t.current = null; } start.current = null; };
  const open = () => { if (Date.now() - fired.current < 700) return; fired.current = Date.now(); clear(); onMenu(); };
  return (
    <div class="row calrow" onContextMenu={(e) => { e.preventDefault(); open(); }}
      onPointerDown={(e) => { if (e.button !== 0) return; start.current = { x: e.clientX, y: e.clientY }; t.current = setTimeout(open, 450); }}
      onPointerMove={(e) => { const s0 = start.current; if (s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 10) clear(); }}
      onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear}>
      <span class="cdot" style={{ background: c.color, width: "18px", height: "18px" }} />
      <button type="button" class="grow lab calname" onClick={() => { if (Date.now() - fired.current > 700) push({ t: "calEdit", id: c.id }); }}>{c.name}</button>
      <Switch on={c.visible} label="Visibile" onChange={(v) => void saveCal({ ...c, visible: v })} />
    </div>
  );
}

function askDeleteCal(c: Cal) {
  if (visibleCals.value.length <= 1) { showToast("Serve almeno un calendario: creane un altro prima di eliminare questo"); return; }
  const n = events.value.filter((e) => e.calendar_id === c.id).length;
  push({ t: "confirm", title: `Eliminare «${c.name}»?`, ok: "Elimina", danger: true,
    text: n ? `Verranno eliminati anche i suoi ${n === 1 ? "1 evento" : `${n} eventi`}, su tutti i dispositivi.` : "Il calendario è vuoto.",
    onOk: () => {
      void saveCal({ ...c, deleted: true });
      for (const e of events.value) if (e.calendar_id === c.id) void deleteEvent(e.id);
      if (settings.value.defaultCal === c.id) setSettings({ defaultCal: null });
      showToast(`«${c.name}» eliminato`);
    } });
}

/** Modifica (o creazione) di un calendario: nome, colore, posizione nell'elenco. */
export function CalEditSheet({ id }: { id: string | null }) {
  const orig = id ? cals.value.find((x) => x.id === id) : undefined;
  const used = new Set(cals.value.filter((x) => !x.deleted).map((x) => x.color));
  const [name, setName] = useState(orig?.name ?? "");
  const [color, setColor] = useState(orig?.color ?? (PALETTE.find((p) => !used.has(p)) ?? PALETTE[(cals.value.length * 3) % PALETTE.length]));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!orig) setTimeout(() => ref.current?.focus(), 200); }, []);
  const list = visibleCals.value;
  const idx = orig ? list.findIndex((x) => x.id === orig.id) : -1;
  const move = (dir: number) => {
    if (!orig) return;
    const i = list.findIndex((x) => x.id === orig.id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const order = list.map((x) => x.id);
    [order[i], order[j]] = [order[j], order[i]];
    order.forEach((cid, k) => { const x = list.find((y) => y.id === cid)!; if (x.sort !== k) void saveCal({ ...x, sort: k }); });
  };
  const save = () => {
    const nm = name.trim();
    if (!nm) { ref.current?.focus(); return; }
    if (orig) void saveCal({ ...(cals.value.find((x) => x.id === orig.id) ?? orig), name: nm, color });
    else {
      const sort = Math.max(-1, ...cals.value.filter((x) => !x.deleted).map((x) => x.sort)) + 1;
      void saveCal({ id: uuid(), name: nm, color, visible: true, sort, deleted: false });
      showToast(`Calendario «${nm}» creato`);
    }
    pop();
  };
  if (id && !orig) { setTimeout(pop, 0); return null; }
  return (
    <>
      <div class="scrim top" onClick={pop} />
      <div class="sheet calsheet" role="dialog" aria-label={orig ? "Modifica calendario" : "Nuovo calendario"}>
        <div class="grip" />
        <div class="chtitle">{orig ? "Modifica calendario" : "Nuovo calendario"}</div>
        <div class="row"><span class="cdot" style={{ background: color, width: "22px", height: "22px" }} />
          <input ref={ref} class="inp bigtitle grow" placeholder="Nome del calendario" value={name} maxLength={80}
            onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} /></div>
        <div class="palette">
          {PALETTE.map((p) => <button aria-label={p} class={color === p ? "on" : ""} style={{ background: p, color: p }} onClick={() => setColor(p)}>{color === p && <Icon n="check" s />}</button>)}
          <label class={"custom" + (!PALETTE.includes(color) ? " on" : "")} title="Colore a scelta" style={{ color }}>
            <input type="color" value={color} onInput={(e) => setColor((e.target as HTMLInputElement).value.toLowerCase())} />
            {!PALETTE.includes(color) ? <Icon n="check" s /> : <Icon n="palette" s />}
          </label>
        </div>
        {orig && list.length > 1 && (
          <div class="row"><div class="grow lab">Posizione nell'elenco</div>
            <button class="iconbtn" aria-label="Sposta su" disabled={idx <= 0} onClick={() => move(-1)}><Icon n="left" style={{ transform: "rotate(90deg)" }} /></button>
            <button class="iconbtn" aria-label="Sposta giù" disabled={idx >= list.length - 1} onClick={() => move(1)}><Icon n="right" style={{ transform: "rotate(90deg)" }} /></button>
          </div>
        )}
        <div class="rembtns">
          {orig && <button class="btn danger" onClick={() => { pop(); askDeleteCal(orig); }}>Elimina</button>}
          <span class="grow" />
          <button class="btn" onClick={pop}>Annulla</button>
          <button class="btn primary" disabled={!name.trim()} onClick={save}>{orig ? "Salva" : "Crea"}</button>
        </div>
      </div>
    </>
  );
}

/** Conferma nello stile dell'app (al posto della finestra di sistema). */
export function ConfirmSheet({ title, text, ok, danger, onOk }: { title: string; text: string; ok: string; danger?: boolean; onOk: () => void }) {
  return (
    <>
      <div class="scrim top" onClick={pop} />
      <div class="sheet confirmsheet" role="alertdialog" aria-label={title}>
        <div class="grip" />
        <div class="chtitle">{title}</div>
        {text && <div class="note" style={{ fontSize: "14.5px", padding: "0 20px 6px" }}>{text}</div>}
        <div class="rembtns">
          <span class="grow" />
          <button class="btn" onClick={pop}>Annulla</button>
          <button class={"btn " + (danger ? "dangerfill" : "primary")} onClick={() => { pop(); onOk(); }}>{ok}</button>
        </div>
      </div>
    </>
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

// --------------------------------------------------------------------------------------------- turni dalla mail
interface ShiftImport { at: string; rest: number; days: number; added: number; removed: number; range_from: string | null; range_to: string | null }
export function ShiftsPage() {
  const [rem, setRemV] = useState<number | null>(() => {
    try { const v = localStorage.getItem("shift-rem"); return v === null ? 1440 : v === "" ? null : Number(v); } catch { return 1440; }
  });
  const setRem = (v: number | null) => { setRemV(v); try { localStorage.setItem("shift-rem", v == null ? "" : String(v)); } catch { /* */ } };
  const [script, setScript] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [log, setLog] = useState<ShiftImport[] | null>(null);
  const loadLog = async () => {
    const { data, error } = await supabase.from("shift_imports").select("at,rest,days,added,removed,range_from,range_to").order("at", { ascending: false }).limit(3);
    setLog(error ? [] : (data as ShiftImport[]));
  };
  useEffect(() => { void loadLog(); const iv = setInterval(() => void loadLog(), 20000); return () => clearInterval(iv); }, []);
  const prepare = async () => {
    setBusy(true); setErr("");
    try {
      const key = await createShiftKey();
      const txt = gmailScript(key, rem == null ? -99999 : rem);
      setScript(txt);
      await copyText(txt);
      showToast("Script copiato: incollalo in Google Apps Script");
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  const copyManifest = async () => { await copyText(GMAIL_MANIFEST); showToast("Impostazioni copiate: incollale in appsscript.json"); };
  const fmt = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} alle ${hm(d)}`; };
  const day = (s: string | null) => { if (!s) return ""; const d = parseYmd(s); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
  return (
    <Page title="Turni dalla mail" dialog>
      <div class="card">
        <div class="row"><Icon n="notes" /><div class="grow"><div class="lab">Giorni di riposo automatici</div>
          <div class="val">Quando arriva la mail dei turni da {SHIFT_SENDER}, i riposi finiscono da soli nel calendario «Turni». A fine mese si cancellano da soli.</div></div></div>
        <button type="button" class="row click" onClick={() => push({ t: "rem", allDay: true, value: rem, none: true, onPick: (v) => { setRem(v); setScript(null); } })}>
          <Icon n="bell" /><div class="grow"><div class="lab">Promemoria per i riposi</div><div class="val">{rem == null ? "Nessuno" : remLabel(rem, true)}</div></div><Icon n="right" />
        </button>
      </div>
      <div class="card">
        <div class="row"><div class="grow"><div class="lab">Ultime importazioni</div>
          {log === null ? <div class="val">…</div> : !log.length ? <div class="val">Nessuna finora</div> : log.map((l) => (
            <div class="val">{fmt(l.at)} · {l.rest === 1 ? "1 riposo" : `${l.rest} riposi`}{l.range_from ? ` (${day(l.range_from)} – ${day(l.range_to)})` : ""}{l.added || l.removed ? ` · ${l.added} aggiunti, ${l.removed} tolti` : ""}</div>
          ))}</div></div>
      </div>
      <div class="card privacy">
        <div class="row"><Icon n="person" /><div class="grow"><div class="lab">Privacy</div></div></div>
        <ul>
          <li>Lo script gira <b>solo nel tuo account Google</b>: nessun altro legge la tua posta.</li>
          <li>Ha il permesso di Gmail in <b>sola lettura</b> e cerca solo le mail del mittente dei turni: non può scrivere, inviare o cancellare mail.</li>
          <li>Al calendario arrivano <b>solo le date dei riposi</b>: niente testo, oggetto, nomi o orari della mail.</li>
          <li>La chiave dello script può <b>solo aggiungere riposi</b>: non legge e non modifica gli altri eventi.</li>
          <li>Il calendario sta sul tuo spazio Supabase in Europa (Francoforte), con connessione cifrata, visibile solo dal tuo account.</li>
        </ul>
      </div>
      <div class="card steps">
        <div class="lab" style={{ padding: "12px 14px 4px" }}>Da fare una volta sola (meglio dal PC)</div>
        <ol>
          <li><b>Hai già lo script della versione prima?</b> Toglili il permesso completo su Gmail: apri la pagina dei collegamenti di Google, scegli «Progetto senza titolo» (o il nome che gli hai dato) e rimuovi l'accesso. Poi continua nello stesso progetto.
            <div><button class="btn" onClick={() => void openUrl("https://myaccount.google.com/connections")}>Apri collegamenti Google</button></div></li>
          <li><b>Copia lo script</b> e incollalo in Google Apps Script al posto di tutto il testo (file «Codice.gs»), poi salva.
            <div class="btnrow"><button class="btn primary" disabled={busy} onClick={prepare}>{script ? "Copia di nuovo" : "Copia lo script"}</button>
              <button class="btn" onClick={() => void openUrl("https://script.google.com/home")}>Apri script.google.com</button></div></li>
          <li><b>Gmail in sola lettura</b>: in Apps Script apri «Impostazioni progetto» (ingranaggio a sinistra) e spunta «Mostra il file manifest "appsscript.json" nell'editor». Torna all'editor, apri <b>appsscript.json</b>, cancella tutto, incolla le impostazioni e salva.
            <div><button class="btn" onClick={copyManifest}>Copia le impostazioni</button></div></li>
          <li><b>Attiva</b>: in alto scegli la funzione <b>installa</b> e premi <b>Esegui</b>. Google chiede il permesso («Avanzate» → «Vai al progetto» → «Consenti»): deve dire <b>«Visualizzare i tuoi messaggi email»</b>. Se chiede di leggere, inviare ed eliminare le mail, le impostazioni del punto 3 non sono state salvate.</li>
          <li>Nel registro compare «Fatto»: da ora le mail dei turni vengono controllate <b>ogni 10 minuti</b>.</li>
        </ol>
        {script && <textarea class="inp code" readOnly rows={5} value={script} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />}
        <div class="note">Se cambi il promemoria, copia di nuovo lo script e sostituiscilo nel progetto.</div>
      </div>
      {err && <div class="note" style={{ color: "var(--danger)" }}>{err}</div>}
    </Page>
  );
}

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return; } catch { /* sotto: metodo vecchio */ }
  const ta = document.createElement("textarea");
  ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } finally { ta.remove(); }
}

// -------------------------------------------------------------------------------------------------- impostazioni
/** Android: stato dell'invio delle modifiche ad app chiusa (per capire subito se qualcosa non va). */
function PushStatusRow() {
  const [st, setSt] = useState<PushStatus | null>(null);
  const load = () => void nativePushStatus().then(setSt);
  useEffect(() => { load(); const iv = setInterval(load, 3000); return () => clearInterval(iv); }, []);
  if (!st) return null;
  const at = (t?: number) => (t ? new Date(t).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const n = st.pending || 0;
  let txt: string;
  if (!st.hasKey) txt = "Non ancora attivo: apri l'app con la rete una volta";
  else if (st.sched && st.sched !== "ok" && st.sched2 !== "ok") txt = `Problema: ${st.sched}`;
  else if (n) txt = `${n === 1 ? "1 modifica" : `${n} modifiche`} in attesa: partono da sole appena c'è rete${st.run ? ` · ultimo tentativo ${at(st.run_t)}: ${st.run}` : ""}`;
  else if (st.ok_t) txt = `Attivo · ultimo invio ad app chiusa: ${at(st.ok_t)}`;
  else txt = "Attivo: le modifiche fatte senza rete partono da sole quando torna, anche ad app chiusa";
  return (
    <div class="card">
      <div class="row"><Icon n="sync" /><div class="grow"><div class="lab">Invio ad app chiusa</div><div class="val">{txt}</div></div></div>
    </div>
  );
}

/** PC: stato dell'aggiornamento automatico (tocca per controllare subito o per riavviare con la versione nuova). */
function PcUpdateRow() {
  const u = pcUpdate.value;
  const txt = !u ? `Versione ${APP_VERSION} · si aggiorna da sola (tocca per controllare ora)`
    : u.state === "download" ? `Scaricamento della versione ${u.version}…`
    : u.state === "ready" ? `Versione ${u.version} installata: tocca per riavviare`
    : `Versione ${u.version}: non riuscito, si riprova fra poco (tocca per riprovare)`;
  const go = () => {
    if (u?.state === "ready") { void restartApp(); return; }
    if (u?.state === "download") return;
    void autoUpdatePC().then((st) => {
      if (st === "none") showToast(`Hai già l'ultima versione (${APP_VERSION})`);
      else if (st === "ready" && pcUpdate.value) showToast(`Versione ${pcUpdate.value.version} installata`, { label: "Riavvia", run: () => void restartApp() });
    }).catch((e) => showToast(`Aggiornamento non riuscito: ${String(e?.message || e)}`));
  };
  return (
    <div class="card">
      <button class="row click" onClick={go}><Icon n="sync" /><div class="grow"><div class="lab">Aggiornamenti automatici</div><div class="val">{txt}</div></div>{u?.state === "ready" && <Icon n="right" />}</button>
    </div>
  );
}

// ---- widget: piu' eventi nello stesso giorno (scelta uguale su telefono e PC) ----------------------------------
export const MULTI_LABEL: Record<MultiMark, [string, string]> = {
  split: ["Cerchio diviso", "Il cerchio si divide nei colori degli eventi (fino a 3)"],
  badge: ["Pallino in alto", "Pallino del secondo evento; con 3 o più eventi diventa «+2», «+3»"],
  dots: ["Puntini sotto", "Un puntino per ogni altro evento sotto il cerchio"],
};
const MR = "#ef4444", MB = "#3b82f6", MG = "#22c55e";
function slicePath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos((a - 90) * Math.PI / 180), cy + r * Math.sin((a - 90) * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${cx} ${cy}L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`;
}
/** Disegnino di come appare il widget: un giorno con 2 eventi e uno con 3. */
export function MultiPreview({ mode }: { mode: MultiMark }) {
  const day = (cx: number, n: number, cols: string[]) => {
    const cy = 20, r = 13;
    const parts: any[] = [];
    if (mode === "split") {
      const k = Math.min(3, cols.length), step = 360 / k, off = k === 2 ? 45 : 0;
      for (let i = 0; i < k; i++) parts.push(<path d={slicePath(cx, cy, r, off + i * step, off + (i + 1) * step)} fill={cols[i]} />);
      for (let i = 0; i < k; i++) {
        const a = (off + i * step - 90) * Math.PI / 180;
        parts.push(<line x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="var(--surface)" stroke-width="1.4" />);
      }
    } else {
      parts.push(<circle cx={cx} cy={cy} r={r} fill={cols[0]} />);
      if (mode === "badge" && cols.length === 2) {
        parts.push(<circle cx={cx + r * 0.72} cy={cy - r * 0.72} r={6.4} fill="var(--surface)" />, <circle cx={cx + r * 0.72} cy={cy - r * 0.72} r={4.6} fill={cols[1]} />);
      } else if (mode === "badge") {
        const bx = cx + r * 0.8, by = cy - r * 0.78;
        parts.push(<rect x={bx - 9.5} y={by - 6.6} width={19} height={13.2} rx={6.6} fill="var(--surface)" />,
          <rect x={bx - 8} y={by - 5.2} width={16} height={10.4} rx={5.2} fill="#f5f5f7" />,
          <text x={bx} y={by + 3.3} text-anchor="middle" font-size="8.5" font-weight="800" fill="#18181b">+{cols.length - 1}</text>);
      } else {
        const ex = cols.slice(1);
        ex.forEach((c, i) => parts.push(<circle cx={cx + (i - (ex.length - 1) / 2) * 7} cy={cy + r + 5.5} r={2.6} fill={c} />));
      }
    }
    parts.push(<text x={cx} y={cy + 4.6} text-anchor="middle" font-size="13" font-weight="800" fill="#fff">{n}</text>);
    return parts;
  };
  return (
    <svg class="mmprev" viewBox="0 0 96 44" width="96" height="44" aria-hidden="true">
      {day(24, 4, [MR, MB])}{day(70, 5, [MR, MB, MG])}
    </svg>
  );
}
export function MultiMarkSheet() {
  const cur = settings.value.multiMark;
  return (
    <>
      <div class="scrim top" onClick={pop} />
      <div class="sheet choicesheet mmsheet" role="dialog" aria-label="Più eventi nello stesso giorno">
        <div class="grip" />
        <div class="chtitle">Più eventi nello stesso giorno</div>
        <div class="mmnote">Nei widget del telefono e di Trofeo LCD, quando i giorni sono cerchi colorati. Vale per tutti i tuoi dispositivi.</div>
        <div class="chlist">
          {(["badge", "split", "dots"] as const).map((m) => (
            <button type="button" class={"chopt mmopt" + (m === cur ? " on" : "")} onClick={() => { pop(); if (m !== cur) setMultiMark(m); }}>
              <MultiPreview mode={m} />
              <span class="grow"><span class="mmlab">{MULTI_LABEL[m][0]}</span><span class="mmdesc">{MULTI_LABEL[m][1]}</span></span>
              {m === cur && <Icon n="check" />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

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
        <button class="row click" onClick={() => push({ t: "shifts" })}><Icon n="notes" /><div class="grow"><div class="lab">Turni dalla mail</div><div class="val">Giorni di riposo inseriti da soli dalla mail dei turni</div></div><Icon n="right" /></button>
        <button class="row click" onClick={() => push({ t: "calendars" })}><Icon n="folder" /><div class="grow"><div class="lab">Calendari</div><div class="val">{visibleCals.value.map((c) => c.name).join(", ")}</div></div><Icon n="right" /></button>
      </div>
      <div class="card">
        <div class="row"><Icon n="cal" /><div class="grow lab">La settimana inizia di</div>
          <div class="seg"><button class={st.weekStart === 1 ? "on" : ""} onClick={() => setSettings({ weekStart: 1 })}>Lunedì</button><button class={st.weekStart === 0 ? "on" : ""} onClick={() => setSettings({ weekStart: 0 })}>Domenica</button></div></div>
        <div class="row"><Icon n="list" /><div class="grow lab">Numeri delle settimane</div><Switch on={st.weekNumbers} onChange={(v) => setSettings({ weekNumbers: v })} /></div>
        <div class="row"><Icon n="cal" /><div class="grow"><div class="lab">Festività italiane</div><div class="val">Capodanno, Pasqua, 25 aprile, Natale… in rosso</div></div><Switch on={st.holidays} onChange={(v) => setSettings({ holidays: v })} /></div>
        <button class="row click" onClick={() => push({ t: "multimark" })}><Icon n="cal" /><div class="grow"><div class="lab">Widget: più eventi in un giorno</div>
          <div class="val">{MULTI_LABEL[st.multiMark][0]} · telefono e Trofeo LCD</div></div><Icon n="right" /></button>
        <div class="row"><Icon n="sun" /><div class="grow lab">Tema</div>
          <div class="seg">{(["system", "light", "dark"] as const).map((t) => <button class={st.theme === t ? "on" : ""} onClick={() => setSettings({ theme: t })}>{t === "system" ? "Auto" : t === "light" ? "Chiaro" : "Scuro"}</button>)}</div></div>
      </div>
      <div class="card">
        <div class="row"><Icon n="folder" /><div class="grow lab">Calendario predefinito</div>
          <Choice cls="setval" title="Calendario predefinito" value={st.defaultCal || ""} onPick={(v) => setSettings({ defaultCal: v || null })}
            options={[["", "Il primo"], ...visibleCals.value.map((c): [string, string] => [c.id, c.name])]} /></div>
        <div class="row"><Icon n="bell" /><div class="grow lab">Promemoria predefinito</div>
          <button type="button" class="setval choice" onClick={() => push({ t: "rem", allDay: false, value: st.defaultReminder, none: true, onPick: (v) => setSettings({ defaultReminder: v }) })}>
            {st.defaultReminder == null ? "Nessuno" : remLabel(st.defaultReminder, false)}<span class="chev">▾</span></button></div>
        <div class="row"><Icon n="clock" /><div class="grow lab">Durata predefinita</div>
          <Choice cls="setval" title="Durata predefinita" value={String(st.defaultDuration)} onPick={(v) => setSettings({ defaultDuration: parseInt(v) })}
            options={[15, 30, 45, 60, 90, 120, 180, 240].map((m): [string, string] => [String(m), m < 60 ? `${m} minuti` : m === 60 ? "1 ora" : m % 60 ? `${Math.floor(m / 60)} ${m < 120 ? "ora" : "ore"} e ${m % 60} min` : `${m / 60} ore`])} /></div>
        {isTauri && auto !== null && <div class="row"><Icon n="monitor" /><div class="grow"><div class="lab">Avvia con Windows</div><div class="val">Nell'area di notifica, per i promemoria</div></div><Switch on={auto} onChange={(v) => void autostart(v).then(setAuto)} /></div>}
      </div>
      {isTauri && <PcUpdateRow />}
      {isAndroid && <PushStatusRow />}
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
        <button class="row click" onClick={() => push({ t: "confirm", title: "Uscire dall'account?", text: "Gli eventi restano salvati online: rientrando li ritrovi.", ok: "Esci", danger: true, onOk: () => { closeAll(); void signOut(); } })}><Icon n="logout" /><div class="grow lab">Esci dall'account</div></button>
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
