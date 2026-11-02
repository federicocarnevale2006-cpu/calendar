// Pezzi comuni dell'interfaccia: pagina, interruttore, rotelle, pannelli di scelta e conferma, promemoria.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { tick } from "./drag";
import { addDays, cap, DAYS_SHORT, fmtLongDay, hm, MONTHS_SHORT, parseYmd, startOfDay, ymd } from "../date";
import { type Occ } from "../model";
import { pop, push } from "./state";
import { Icon } from "./icons";
import { MiniMonth } from "./views";

// ------------------------------------------------------------------------------------------------ elementi comuni
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} class={"switch" + (on ? " on" : "")} onClick={(e) => { e.stopPropagation(); onChange(!on); }} />;
}

export function Page({ title, onClose, children, actions, dialog }: { title: string; onClose?: () => void; children: any; actions?: any; dialog?: boolean }) {
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
export function DTChip({ type, value, on, bad, onClick }: { type: "date" | "time"; value: string; on: boolean; bad?: boolean; onClick: () => void }) {
  let label = value || "—";
  if (type === "date" && value) {
    const d = parseYmd(value);
    label = `${cap(DAYS_SHORT[d.getDay()])} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  }
  return <button type="button" class={"dtf " + type + (on ? " on" : "") + (bad ? " bad" : "")} onClick={onClick}>{label}</button>;
}

export const IH = 40;                                         // altezza di una voce della rotella
/** Rotella che scorre col dito e si ferma sulla voce (come il selettore dell'ora Samsung), con vibrazione a ogni scatto. */
export function Wheel({ n, value, onChange, labels, w }: { n: number; value: number; onChange: (v: number) => void; labels?: string[]; w?: number }) {
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

export function TimeWheel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

export function DatePick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
export const MONTHS_FULL = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

// Promemoria = minuti prima dell'inizio (per «tutto il giorno»: prima delle 9:00 del giorno). Qualsiasi valore, scelto con le rotelle.
export const UNITS: [number, string, string][] = [[1, "minuto", "minuti"], [60, "ora", "ore"], [1440, "giorno", "giorni"], [10080, "settimana", "settimane"]];
export const MAXN = 120, MAXD = 60;
export function splitTimed(m: number): [number, number] {                     // [quanti, unita']
  if (m <= 0) return [0, 0];
  for (let u = 3; u >= 1; u--) if (m % UNITS[u][0] === 0 && m / UNITS[u][0] <= MAXN) return [m / UNITS[u][0], u];
  return [Math.min(MAXN, m), 0];
}
export function splitAllDay(m: number): [number, number] {                    // [giorni prima, minuti dalla mezzanotte]
  let t = 540 - m, d = 0;
  while (t < 0) { t += 1440; d++; }
  while (t >= 1440) { t -= 1440; d--; }
  return [Math.max(0, d), t];
}
export const hhmm = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
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
export function remAt(start: Date, allDay: boolean, m: number): Date {
  const base = allDay ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 0) : start;
  return new Date(base.getTime() - m * 60000);
}
export const NUM_LABELS = Array.from({ length: MAXN + 1 }, (_, i) => String(i));
export const DAY_LABELS = Array.from({ length: MAXD + 1 }, (_, i) => (i === 0 ? "Il giorno stesso" : i === 1 ? "1 giorno prima" : `${i} giorni prima`));

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
export function Choice({ cls, title, value, options, onPick }: { cls: string; title: string; value: string; options: [string, string][]; onPick: (v: string) => void }) {
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
