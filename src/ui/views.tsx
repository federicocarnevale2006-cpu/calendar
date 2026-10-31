import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { addDays, addMonths, cap, dayDiff, DAYS_LETTER, DAYS_SHORT, fmtLongDay, hm, isoWeek, MONTHS, monthWeeks, sameDay, startOfDay, startOfWeek, ymd } from "../date";
import type { Occ } from "../model";
import { calById, dayOccurrences, newEvent, occurrences, saveEvent, settings, setSettings } from "../store";
import { holidayName } from "../holidays";
import { haptic } from "../platform";
import { cursor, now, push, selDay } from "./state";
import { dragFlag, dragging, editable, LONG_MS, retime, shiftDays, SLOP, snap, STEP_MIN, thump, tick } from "./drag";
import { Icon } from "./icons";

const dayCls = (d: Date) => (d.getDay() === 0 || (settings.value.holidays && holidayName(d)) ? "sun" : d.getDay() === 6 ? "sat" : "");

export function openNew(day: Date, hour?: number) {
  const n = new Date();
  let start: Date;
  if (hour != null) start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(hour), Math.round((hour % 1) * 60));
  else if (sameDay(day, n)) start = new Date(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours() + 1, 0);
  else start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
  push({ t: "editor", ev: newEvent(start), isNew: true });
}

/** Scorrimento orizzontale col dito: mese/settimana precedente o successivo. */
export function useSwipe(onSwipe: (dir: number) => void) {
  const st = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => { const t = e.touches[0]; st.current = { x: t.clientX, y: t.clientY, t: Date.now() }; },
    onTouchEnd: (e: TouchEvent) => {
      const s = st.current; st.current = null;
      if (!s) return;
      const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (dragging()) return;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - s.t < 700) { void haptic(); onSwipe(dx < 0 ? 1 : -1); }
    },
  };
}

export function timeLabel(o: Occ, day?: Date): { a: string; b: string } {
  if (o.allDay) return { a: "Tutto il", b: "giorno" };
  if (day) {
    const ds = startOfDay(day), de = addDays(ds, 1);
    if (o.start < ds && o.end > de) return { a: "Tutto il", b: "giorno" };
    if (o.start < ds) return { a: "fino a", b: hm(o.end) };
    if (o.end > de) return { a: hm(o.start), b: "→" };
  }
  return { a: hm(o.start), b: hm(o.end) };
}

export function EvRow({ o, day }: { o: Occ; day?: Date }) {
  const t = timeLabel(o, day);
  const past = o.end < now.value;
  return (
    <button class={"evrow" + (past ? " past" : "")} onClick={() => push({ t: "detail", occ: o })}>
      <div class="time"><b>{t.a}</b>{t.b}</div>
      <div class="bar" style={{ background: o.color }} />
      <div class="t">
        <div class="tt">{o.ev.title || "(senza titolo)"}</div>
        {(o.ev.location || o.ev.rrule) && <div class="sub">{[o.ev.location, o.ev.rrule ? "si ripete" : ""].filter(Boolean).join(" · ")}</div>}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------- mese
interface Seg { o: Occ; c0: number; c1: number; lane: number }

function layoutWeek(week: Date[], occs: Occ[]) {
  const ws = week[0], we = addDays(ws, 7);
  const spans: Seg[] = [];
  const singles: Occ[][] = week.map(() => []);
  const taken: boolean[][] = [];                                // taken[lane][day]
  const free = (l: number, a: number, b: number) => { for (let d = a; d <= b; d++) if (taken[l]?.[d]) return false; return true; };
  const take = (l: number, a: number, b: number) => { taken[l] = taken[l] || Array(7).fill(false); for (let d = a; d <= b; d++) taken[l][d] = true; };
  for (const o of occs) {
    if (!(o.start < we && o.end > ws) && !(o.start.getTime() === o.end.getTime() && o.start >= ws && o.start < we)) continue;
    const lastDay = startOfDay(new Date(Math.max(o.start.getTime(), o.end.getTime() - 1)));
    const multi = o.allDay || !sameDay(o.start, lastDay);
    const c0 = Math.max(0, dayDiff(ws, o.start < ws ? ws : o.start));
    if (multi) spans.push({ o, c0, c1: Math.min(6, dayDiff(ws, lastDay)), lane: 0 });
    else singles[c0].push(o);
  }
  spans.sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0));
  for (const s of spans) { let l = 0; while (!free(l, s.c0, s.c1)) l++; s.lane = l; take(l, s.c0, s.c1); }
  const cells = singles.map((list, d) => {
    const slots: (Occ | "span" | null)[] = [];
    for (let l = 0; l < taken.length; l++) slots[l] = taken[l]?.[d] ? "span" : null;
    for (const o of list) { let l = 0; while (slots[l]) l++; slots[l] = o; }
    return slots;
  });
  return { spans, cells };
}

export function MonthView({ desk }: { desk: boolean }) {
  const st = settings.value, c = cursor.value, sd = selDay.value, today = now.value;
  const weeks = monthWeeks(c.getFullYear(), c.getMonth(), st.weekStart);
  const occs = occurrences(weeks[0][0], addDays(weeks[weeks.length - 1][6], 1));
  const grid = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(90);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRowH(el.clientHeight / weeks.length));
    ro.observe(el);
    setRowH(el.clientHeight / weeks.length);
    return () => ro.disconnect();
  }, [weeks.length]);
  const lineH = desk ? 20 : 18, top = desk ? 34 : 32;
  const maxL = Math.max(0, Math.floor((rowH - top - 2) / lineH));
  const dotsMode = maxL < 2;
  const swipe = useSwipe((d) => { cursor.value = addMonths(new Date(c.getFullYear(), c.getMonth(), 1), d); selDay.value = null; });
  const wn = st.weekNumbers;
  const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (i + st.weekStart) % 7);
  const tapDay = (d: Date, dbl = false) => {
    if (dragging()) return;
    if (msel) { setMsel(null); return; }                     // prima si «lascia» l'evento preso
    if (dbl || (!desk && sd && sameDay(sd, d))) { openNew(d); return; }
    selDay.value = d;
    if (d.getMonth() !== c.getMonth()) cursor.value = new Date(d.getFullYear(), d.getMonth(), 1);
  };
  // ---- mese: pressione lunga su un evento e trascinamento = altro giorno; pressione lunga e rilascio = evento
  // «preso» con due maniglie ai lati per allungarlo/accorciarlo di giorni (col mouse: trascinare / doppio clic)
  type MD = { o: Occ; key: string; mode: "move" | "rs" | "re"; x0: number; y0: number; from: Date; active: boolean; pid: number; mouse: boolean; moved: boolean };
  const md = useRef<MD | null>(null);
  const mtimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mdrag, setMdrag] = useState<{ key: string; mode: MD["mode"]; title: string; color: string; x: number; y: number; to: string | null; r0: string; r1: string } | null>(null);
  const [msel, setMsel] = useState<string | null>(null);
  const monthEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = monthEl.current;
    if (!el) return;
    const stop = (e: TouchEvent) => { if (md.current?.active) e.preventDefault(); };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);
  useEffect(() => setMsel(null), [c.getFullYear(), c.getMonth()]);
  const byKey = new Map(occs.map((o) => [o.key, o]));
  const lastDay = (o: Occ) => startOfDay(new Date(Math.max(o.start.getTime(), o.end.getTime() - 1)));
  const dayAt = (x: number, y: number): Date | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const v = (el as HTMLElement).dataset?.day;
      if (v) return parseDay(v);
    }
    return null;
  };
  /** giorni coperti dall'evento mentre lo si sposta o lo si allunga (per evidenziarli) */
  const range = (d: MD, t: Date | null): [string, string] => {
    let a = startOfDay(d.o.start), b = lastDay(d.o);
    if (t) {
      if (d.mode === "move") { const n = dayDiff(d.from, t); a = addDays(a, n); b = addDays(b, n); }
      else if (d.mode === "re") b = t < a ? a : t;
      else a = t > b ? b : t;
    }
    return [ymd(a), ymd(b)];
  };
  const mActivate = (x: number, y: number) => {
    const d = md.current;
    if (!d || d.active) return;
    d.active = true;
    dragFlag.on = true;
    void thump();
    const [r0, r1] = range(d, null);
    setMdrag({ key: d.key, mode: d.mode, title: d.o.ev.title || "(senza titolo)", color: d.o.color, x, y, to: ymd(d.from), r0, r1 });
  };
  const mDown = (e: PointerEvent, key: string, mode: MD["mode"] = "move") => {
    const o = byKey.get(key);
    if (!o || !editable(o)) return;
    const mouse = e.pointerType === "mouse";
    if (mouse && e.button !== 0) return;
    if (mode !== "move") e.stopPropagation();
    const from = dayAt(e.clientX, e.clientY) ?? startOfDay(o.start);
    md.current = { o, key, mode, x0: e.clientX, y0: e.clientY, from, active: false, pid: e.pointerId, mouse, moved: false };
    if (mtimer.current) clearTimeout(mtimer.current);
    const x = e.clientX, y = e.clientY;
    if (mode !== "move" || msel === key) { if (!mouse) mActivate(x, y); }   // maniglie (o evento gia' preso): subito
    else if (!mouse) mtimer.current = setTimeout(() => mActivate(x, y), LONG_MS);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* */ }
  };
  const mMove = (e: PointerEvent) => {
    const d = md.current;
    if (!d || e.pointerId !== d.pid) return;
    const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > (d.mouse ? 4 : SLOP);
    if (!d.active) {
      if (far && d.mouse) mActivate(e.clientX, e.clientY);
      else if (far) { if (mtimer.current) clearTimeout(mtimer.current); md.current = null; return; }
      else return;
    }
    if (far) d.moved = true;
    e.preventDefault();
    const t = dayAt(e.clientX, e.clientY);
    const to = t ? ymd(t) : null;
    const [r0, r1] = range(d, t);
    void tick(`${r0}_${r1}`);
    setMdrag((m) => (m ? { ...m, x: e.clientX, y: e.clientY, to, r0, r1 } : m));
  };
  const mUp = (e: PointerEvent, cancel = false) => {
    const d = md.current;
    if (!d || e.pointerId !== d.pid) return;
    if (mtimer.current) clearTimeout(mtimer.current);
    md.current = null;
    dragFlag.on = false;
    if (!d.active) return;
    dragFlag.until = Date.now() + 350;
    const t = cancel ? null : dayAt(e.clientX, e.clientY);
    setMdrag(null);
    if (!t) return;
    const o = d.o;
    if (d.mode === "move") {
      const n = dayDiff(d.from, t);
      if (n) { void shiftDays(o, n); selDay.value = t; setMsel(null); }
      else if (!d.mouse) setMsel(d.key);                             // dito: tenuto premuto e lasciato li' = compaiono le maniglie
      return;
    }
    if (d.mode === "re") {
      const n = dayDiff(lastDay(o), t < startOfDay(o.start) ? startOfDay(o.start) : t);
      if (n) void retime(o, o.start, addDays(o.end, n)).then(() => setMsel(null));
    } else {
      const n = dayDiff(startOfDay(o.start), t > lastDay(o) ? lastDay(o) : t);
      if (n) void retime(o, addDays(o.start, n), o.end).then(() => setMsel(null));
    }
  };
  const mh = (key: string) => ({
    "data-key": key,
    onPointerDown: (e: PointerEvent) => mDown(e, key),
    onPointerMove: mMove,
    onPointerUp: (e: PointerEvent) => mUp(e),
    onPointerCancel: (e: PointerEvent) => mUp(e, true),
    onContextMenu: (e: Event) => e.preventDefault(),
    onDblClick: (e: Event) => { e.stopPropagation(); setMsel(key); },          // PC: doppio clic = maniglie
  });
  const handle = (key: string, side: "rs" | "re") => (
    <span class={"mhdl " + (side === "rs" ? "l" : "r")}
      onPointerDown={(e) => mDown(e as unknown as PointerEvent, key, side)} onPointerMove={mMove}
      onPointerUp={(e) => mUp(e as unknown as PointerEvent)} onPointerCancel={(e) => mUp(e as unknown as PointerEvent, true)}
      onClick={(e) => e.stopPropagation()} />
  );
  const inRange = (d: Date) => !!mdrag && ymd(d) >= mdrag.r0 && ymd(d) <= mdrag.r1;

  return (
    <div class="month" {...swipe} ref={monthEl}>
      <div class={"wdays" + (wn ? " wn" : "")}>
        {wn && <div />}
        {order.map((d) => <div class={d === 0 ? "sun" : d === 6 ? "sat" : ""}>{desk ? cap(DAYS_SHORT[d]) : DAYS_LETTER[d]}</div>)}
      </div>
      <div class="mgrid" ref={grid}>
        {weeks.map((w) => {
          const { spans, cells } = layoutWeek(w, occs);
          const limits = cells.map((sl) => (sl.filter(Boolean).length > maxL ? maxL - 1 : maxL));
          return (
            <div class={"mrow" + (wn ? " wn" : "")}>
              {wn && <div class="wkn">{isoWeek(w[3])}</div>}
              {w.map((d, i) => {
                const slots = cells[i];
                const cls = ["mcell", dayCls(d), d.getMonth() !== c.getMonth() ? "out" : "", sameDay(d, today) ? "today" : "", sd && sameDay(sd, d) ? "sel" : "",
                  inRange(d) ? "droptarget" : ""].join(" ");
                if (dotsMode) {
                  const cols = [...new Set([...spans.filter((s) => s.c0 <= i && s.c1 >= i).map((s) => s.o.color), ...(slots.filter((x) => x && x !== "span") as Occ[]).map((o) => o.color)])].slice(0, 4);
                  return (
                    <button class={cls} data-day={ymd(d)} onClick={() => tapDay(d)} onDblClick={() => tapDay(d, true)} aria-label={fmtLongDay(d)}>
                      <span class="dn">{d.getDate()}</span>
                      <span class="dots">{cols.map((cl) => <i style={{ background: cl }} />)}</span>
                    </button>
                  );
                }
                const shown = slots.slice(0, limits[i]);
                const hidden = slots.slice(shown.length).filter(Boolean).length;
                return (
                  <button class={cls} data-day={ymd(d)} onClick={() => tapDay(d)} onDblClick={() => tapDay(d, true)} aria-label={fmtLongDay(d)}>
                    <span class="dn">{d.getDate()}</span>
                    {shown.map((s) => {
                      if (s === "span" || s === null) return <div class="chip" style={{ visibility: "hidden" }} />;
                      return (
                        <div class={"chip solid" + (mdrag?.key === s.key ? " picked" : "") + (msel === s.key ? " msel" : "")} title={s.ev.title} style={{ background: s.color, "--c": s.color } as any} {...mh(s.key)}>
                          <span class="ct">{s.ev.title || "(senza titolo)"}</span>
                          {msel === s.key && !mdrag && <>{handle(s.key, "rs")}{handle(s.key, "re")}</>}
                        </div>
                      );
                    })}
                    {hidden > 0 && <div class="more">+{hidden}</div>}
                  </button>
                );
              })}
              {!dotsMode && spans.filter((s) => s.lane < Math.min(...limits.slice(s.c0, s.c1 + 1))).map((s) => {
                const off = wn ? 22 : 0;
                return (
                  <div class={"mspan" + (mdrag?.key === s.o.key ? " picked" : "") + (msel === s.o.key ? " msel" : "")} {...mh(s.o.key)}
                    onClick={(e) => { const t = dayAt((e as MouseEvent).clientX, (e as MouseEvent).clientY); if (t) tapDay(t); }}
                    style={{
                    top: `${top + s.lane * lineH}px`, background: s.o.color, "--c": s.o.color,
                    left: `calc(${off}px + (100% - ${off}px) * ${s.c0 / 7} + 2px)`, width: `calc((100% - ${off}px) * ${(s.c1 - s.c0 + 1) / 7} - 4px)`,
                  }}><span class="ct">{s.o.ev.title || "(senza titolo)"}</span>
                    {msel === s.o.key && !mdrag && <>
                      {sameDay(w[s.c0], startOfDay(s.o.start)) && handle(s.o.key, "rs")}
                      {sameDay(w[s.c1], lastDay(s.o)) && handle(s.o.key, "re")}
                    </>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {mdrag && <div class="dragghost" style={{ left: `${mdrag.x}px`, top: `${mdrag.y}px`, background: mdrag.color }}>
        {mdrag.mode === "move" ? mdrag.title : `${mdrag.title} · ${rangeLabel(mdrag.r0, mdrag.r1)}`}
      </div>}
      {msel && !mdrag && <div class="draghint">Tieni premuto e trascina per spostare, i pallini ai lati per allungare · tocca fuori per finire</div>}
    </div>
  );
}

function rangeLabel(a: string, b: string): string {
  const x = parseDay(a), y = parseDay(b);
  const f = (d: Date) => `${DAYS_SHORT[d.getDay()]} ${d.getDate()}`;
  return a === b ? f(x) : `${f(x)} → ${f(y)}`;
}

function parseDay(v: string): Date {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function DayList({ day }: { day: Date }) {
  const list = dayOccurrences(day);
  if (!list.length) return <div class="empty">Nessun evento</div>;
  return <>{list.map((o) => <EvRow o={o} day={day} />)}</>;
}

/** Come nel calendario Samsung: in fondo al giorno si scrive il titolo e l'evento e' fatto (ora predefinita, calendario predefinito). */
export function QuickAdd({ day }: { day: Date }) {
  const [t, setT] = useState("");
  const go = () => {
    const title = t.trim();
    if (!title) { openNew(day); return; }
    const n = new Date();
    const start = sameDay(day, n) ? new Date(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours() + 1, 0) : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
    const ev = newEvent(start);
    void saveEvent({ ...ev, title });
    setT("");
    void haptic();
  };
  const cal = calById.value.get(newEvent(day).calendar_id || "");
  return (
    <form class="quickadd" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <span class="cdot" style={{ background: cal?.color || "var(--accent)" }} />
      <input class="inp" placeholder={`Aggiungi evento il ${day.getDate()} ${MONTHS[day.getMonth()].slice(0, 3)}`} value={t} onInput={(e) => setT((e.target as HTMLInputElement).value)} enterKeyHint="done" maxLength={300} />
      <button type="submit" class="iconbtn" aria-label="Aggiungi"><Icon n={t.trim() ? "check" : "plus"} /></button>
    </form>
  );
}

export function DaySheet() {
  const d = selDay.value;
  const sw = useRef<number | null>(null);
  if (!d) return null;
  return (
    <div class="daysheet"
      onTouchStart={(e) => (sw.current = e.touches[0].clientY)}
      onTouchEnd={(e) => { if (sw.current != null && e.changedTouches[0].clientY - sw.current > 70 && (e.currentTarget as HTMLElement).querySelector(".list")!.scrollTop === 0) selDay.value = null; sw.current = null; }}>
      <div class="grip" />
      <header>
        <h3>{fmtLongDay(d)}</h3>
        <button class="iconbtn" aria-label="Nuovo evento" onClick={() => openNew(d)}><Icon n="plus" /></button>
        <button class="iconbtn" aria-label="Chiudi" onClick={() => (selDay.value = null)}><Icon n="close" /></button>
      </header>
      <div class="list"><DayList day={d} /></div>
      <QuickAdd day={d} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- settimana / giorno
const HOUR = 56;
interface Blk { o: Occ; top: number; h: number; col: number; cols: number }

function layoutDay(day: Date, occs: Occ[]): Blk[] {
  const ds = startOfDay(day), de = addDays(ds, 1);
  const items = occs.filter((o) => !o.allDay && o.start < de && (o.end > ds || (o.end.getTime() === o.start.getTime() && o.start >= ds)))
    .filter((o) => !(o.start <= ds && o.end >= de))           // copre tutto il giorno: va nella riga in alto
    .map((o) => {
      const s = Math.max(0, (o.start.getTime() - ds.getTime()) / 3600000), e = Math.min(24, (o.end.getTime() - ds.getTime()) / 3600000);
      return { o, s, e: Math.max(e, s + 0.42) };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Blk[] = [];
  let group: { o: Occ; s: number; e: number; col: number }[] = [], gEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    for (const g of group) out.push({ o: g.o, top: g.s * HOUR, h: (g.e - g.s) * HOUR, col: g.col, cols });
    group = [];
  };
  for (const it of items) {
    if (it.s >= gEnd && group.length) flush();
    const used = new Set(group.filter((g) => g.e > it.s).map((g) => g.col));
    let col = 0;
    while (used.has(col)) col++;
    group.push({ ...it, col });
    gEnd = Math.max(gEnd, it.e);
  }
  if (group.length) flush();
  return out;
}

/** PC (mouse): le maniglie compaiono passando sopra l'evento, senza pressione lunga. */
const HOVER = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

interface Drag {
  mode: "move" | "start" | "end" | "new";
  occ: Occ | null;                       // null per un evento nuovo disegnato col dito
  key: string;
  x0: number; y0: number; sc0: number;   // punto di partenza (e scorrimento) del dito
  s0: Date; e0: Date;                    // orari di partenza
  s: Date; e: Date;                      // orari mostrati mentre si trascina
  active: boolean;
  pid: number;
  mouse: boolean;
}

export function WeekView({ days }: { days: 1 | 7 }) {
  const st = settings.value, c = cursor.value, today = now.value;
  const start = days === 7 ? startOfWeek(c, st.weekStart) : startOfDay(c);
  const list = Array.from({ length: days }, (_, i) => addDays(start, i));
  const occs = occurrences(start, addDays(start, days));
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dr = useRef<Drag | null>(null);                 // stesso stato, letto dai gestori del dito senza aspettare il ridisegno
  const [sel, setSel] = useState<string | null>(null);  // evento «preso» (dopo la pressione lunga): mostra le maniglie
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const auto = useRef<{ v: number; raf: number } | null>(null);
  const lastPt = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const cols = `52px repeat(${days}, minmax(0, 1fr))`;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const inRange = list.some((d) => sameDay(d, today));
    el.scrollTop = Math.max(0, (inRange ? today.getHours() - 1.5 : 7) * HOUR);
    setSel(null);
  }, [start.getTime()]);
  // mentre si trascina col dito la pagina non deve scorrere (serve un gestore «non passivo»)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const stop = (e: TouchEvent) => { if (dr.current?.active) e.preventDefault(); };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);
  const swipe = useSwipe((d) => { if (!dr.current?.active && !sel) cursor.value = addDays(c, d * days); });
  const allDay = occs.filter((o) => o.allDay || (o.end.getTime() - o.start.getTime() >= 86400000 - 1) || !sameDay(o.start, new Date(o.end.getTime() - 1)));
  const lanes: { o: Occ; c0: number; c1: number; lane: number }[] = [];
  for (const o of allDay) {
    const c0 = Math.max(0, dayDiff(start, o.start)), c1 = Math.min(days - 1, dayDiff(start, new Date(o.end.getTime() - 1)));
    if (c1 < 0 || c0 > days - 1) continue;
    let l = 0;
    while (lanes.some((x) => x.lane === l && !(x.c1 < c0 || x.c0 > c1))) l++;
    lanes.push({ o, c0, c1, lane: l });
  }
  const nl = Math.max(0, ...lanes.map((x) => x.lane + 1));

  // ---- trascinamento ---------------------------------------------------------------------------------------
  const set = (d: Drag | null) => { dr.current = d; setDrag(d ? { ...d } : null); };
  const colW = () => { const b = body.current; return b ? (b.clientWidth - 52) / days : 1; };
  const timeAt = (clientY: number, day: Date) => {      // ora sotto il dito
    const b = body.current!.getBoundingClientRect();
    const h = Math.max(0, Math.min(24, (clientY - b.top) / HOUR));
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, Math.round(h * 60));
  };
  const update = (x: number, y: number) => {
    const d = dr.current;
    if (!d || !d.active) return;
    lastPt.current = { x, y };
    const sc = scroller.current!.scrollTop;
    const dMin = ((y - d.y0) + (sc - d.sc0)) / HOUR * 60;
    let s = d.s, e = d.e;
    if (d.mode === "move") {
      const dDay = days === 7 ? Math.round((x - d.x0) / colW()) : 0;
      const dur = d.e0.getTime() - d.s0.getTime();
      s = snap(addDays(new Date(d.s0.getTime() + dMin * 60000), dDay));
      const first = list[0], lastEnd = addDays(list[days - 1], 1);
      if (s < first) s = new Date(first);
      if (s.getTime() + 15 * 60000 > lastEnd.getTime()) s = new Date(lastEnd.getTime() - 15 * 60000);
      e = new Date(s.getTime() + dur);
    } else if (d.mode === "start") {
      s = snap(new Date(d.s0.getTime() + dMin * 60000));
      if (s.getTime() > d.e0.getTime() - STEP_MIN * 60000) s = new Date(d.e0.getTime() - STEP_MIN * 60000);
      e = d.e0;
    } else {                                             // "end" e "new": si allunga verso il basso (o si accorcia)
      e = d.mode === "new" ? snap(timeAt(y, startOfDay(d.s0))) : snap(new Date(d.e0.getTime() + dMin * 60000));
      if (d.mode === "new" && e.getTime() < d.s0.getTime() + 30 * 60000) e = new Date(d.s0.getTime() + 30 * 60000);
      if (e.getTime() < d.s0.getTime() + STEP_MIN * 60000) e = new Date(d.s0.getTime() + STEP_MIN * 60000);
      s = d.s0;
    }
    const dayEnd = addDays(startOfDay(s), 1);              // come Samsung: trascinando non si passa la mezzanotte
    if (e > dayEnd) {
      if (d.mode === "move") { const dur = e.getTime() - s.getTime(); e = dayEnd; s = new Date(dayEnd.getTime() - dur); }
      else e = dayEnd;
    }
    if (s.getTime() !== d.s.getTime() || e.getTime() !== d.e.getTime()) {
      void tick(`${s.getTime()}_${e.getTime()}`);
      set({ ...d, s, e });
    }
    // vicino al bordo: la griglia scorre da sola
    const r = scroller.current!.getBoundingClientRect();
    const v = y < r.top + 48 ? -10 : y > r.bottom - 48 ? 10 : 0;
    if (v && !auto.current) {
      const loop = () => {
        if (!auto.current || !dr.current?.active) { auto.current = null; return; }
        scroller.current!.scrollTop += auto.current.v;
        update(lastPt.current.x, lastPt.current.y);
        auto.current.raf = requestAnimationFrame(loop);
      };
      auto.current = { v, raf: requestAnimationFrame(loop) };
    } else if (auto.current) {
      if (v) auto.current.v = v; else { cancelAnimationFrame(auto.current.raf); auto.current = null; }
    }
  };
  const activate = () => {
    const d = dr.current;
    if (!d || d.active) return;
    d.active = true;
    dragFlag.on = true;
    void thump();
    if (d.occ) setSel(d.key);
    set({ ...d });
  };
  const begin = (e: PointerEvent, mode: Drag["mode"], occ: Occ | null, s0: Date, e0: Date, key: string) => {
    const mouse = e.pointerType === "mouse";
    if (mouse && e.button !== 0) return;
    const d: Drag = { mode, occ, key, x0: e.clientX, y0: e.clientY, sc0: scroller.current!.scrollTop, s0, e0, s: s0, e: e0, active: false, pid: e.pointerId, mouse };
    dr.current = d;
    if (timer.current) clearTimeout(timer.current);
    // dito: pressione lunga (o subito, se l'evento e' gia' preso / si tocca una maniglia); mouse: parte muovendo
    if (!mouse) {
      if ((occ && sel === key) || mode === "start" || mode === "end") activate();
      else timer.current = setTimeout(activate, LONG_MS);
    }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* */ }
  };
  const onMove = (e: PointerEvent) => {
    const d = dr.current;
    if (!d || e.pointerId !== d.pid) return;
    const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > (d.mouse ? 4 : SLOP);
    if (!d.active) {
      if (far && d.mouse) activate();
      else if (far) { if (timer.current) clearTimeout(timer.current); dr.current = null; return; }   // era uno scorrimento
      else return;
    }
    e.preventDefault();
    update(e.clientX, e.clientY);
  };
  const finish = (e: PointerEvent, cancel = false) => {
    const d = dr.current;
    if (!d || e.pointerId !== d.pid) return;
    if (timer.current) clearTimeout(timer.current);
    if (auto.current) { cancelAnimationFrame(auto.current.raf); auto.current = null; }
    dr.current = null;
    dragFlag.on = false;
    if (!d.active) { setDrag(null); return; }            // era un tocco: ci pensa il click
    dragFlag.until = Date.now() + 350;                   // niente click «fantasma» subito dopo
    setDrag(null);
    if (cancel) return;
    if (d.mode === "new") {
      push({ t: "editor", ev: { ...newEvent(d.s), end_at: d.e.toISOString() }, isNew: true });
      return;
    }
    if (d.occ && (d.s.getTime() !== d.s0.getTime() || d.e.getTime() !== d.e0.getTime())) {
      const o = d.occ;
      void retime(o, d.s, d.e).then((id) => { if (id) setSel(`${id}_${ymd(d.s)}`); });
    }
  };
  const handlers = {
    onPointerMove: onMove,
    onPointerUp: (e: PointerEvent) => finish(e),
    onPointerCancel: (e: PointerEvent) => finish(e, true),
    onContextMenu: (e: Event) => e.preventDefault(),
  };
  const preview = drag?.active ? drag : null;
  const dayIdx = preview ? dayDiff(start, preview.s) : -1;

  return (
    <div class="week" {...swipe}>
      <div class="whead" style={{ gridTemplateColumns: cols }}>
        <div class="wd" style={{ fontSize: "10px" }}>{days === 7 && st.weekNumbers ? `S${isoWeek(addDays(start, 3))}` : ""}</div>
        {list.map((d) => (
          <button class={"wd " + dayCls(d) + (sameDay(d, today) ? " today" : "")} onClick={() => { cursor.value = d; if (days === 7) setSettings({ view: "day" }); }}>
            {cap(DAYS_SHORT[d.getDay()])}<b>{d.getDate()}</b>
          </button>
        ))}
      </div>
      {nl > 0 && (
        <div class="alld" style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(${nl}, auto)` }}>
          <div class="lab" style={{ gridRow: `1 / span ${nl}` }}>tutto il giorno</div>
          {lanes.map((x) => (
            <button class="ae" style={{ gridColumn: `${x.c0 + 2} / ${x.c1 + 3}`, gridRow: x.lane + 1, background: x.o.color }} onClick={() => push({ t: "detail", occ: x.o })}>
              {x.o.ev.title || "(senza titolo)"}
            </button>
          ))}
        </div>
      )}
      <div class={"wscroll" + (preview ? " dragging" : "")} ref={scroller}>
        <div class="wbody" ref={body} style={{ gridTemplateColumns: cols, height: `${24 * HOUR}px` }}>
          <div class="hours">{Array.from({ length: 24 }, (_, h) => <div>{h ? `${String(h).padStart(2, "0")}:00` : ""}</div>)}</div>
          {list.map((d, di) => {
            const blocks = layoutDay(d, occs.filter((o) => !allDay.includes(o)));
            const isToday = sameDay(d, today);
            return (
              <div class={"wcol" + (isToday ? " today" : "")}
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const t = snap(timeAt(e.clientY, d), 30);
                  begin(e, "new", null, t, new Date(t.getTime() + st.defaultDuration * 60000), "new");
                }}
                {...handlers}
                onClick={(e) => {
                  if (e.target !== e.currentTarget || dragging()) return;
                  if (sel) { setSel(null); return; }           // prima si «lascia» l'evento preso
                  const y = (e as MouseEvent).offsetY;
                  openNew(d, Math.floor((y / HOUR) * 2) / 2);
                }}>
                {blocks.map((b) => {
                  const ok = editable(b.o);
                  const isSel = sel === b.o.key;
                  const hidden = preview && preview.occ && preview.key === b.o.key;
                  return (
                    <div class={"blk" + (isSel ? " sel" : "") + (hidden ? " ghost" : "")} role="button" tabIndex={0}
                      style={{ top: `${b.top}px`, height: `${Math.max(20, b.h - 2)}px`, left: `calc(${(b.col / b.cols) * 100}% + 1px)`, width: `calc(${100 / b.cols}% - 3px)`, background: b.o.color }}
                      onPointerDown={(e) => {
                        if (!ok) return;
                        let mode: Drag["mode"] = "move";
                        if (isSel) {                             // evento gia' preso: anche i bordi (non solo i pallini) cambiano inizio/fine
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const y = e.clientY - r.top, zone = Math.min(24, r.height / 3);
                          if (y < zone) mode = "start"; else if (y > r.height - zone) mode = "end";
                        }
                        begin(e, mode, b.o, b.o.start, b.o.end, b.o.key);
                      }}
                      {...handlers}
                      onClick={() => { if (!dragging()) push({ t: "detail", occ: b.o }); }}>
                      <div class="bin">
                        {b.o.ev.title || "(senza titolo)"}
                        {b.h > 34 && <small>{hm(b.o.start)} – {hm(b.o.end)}{b.o.ev.location ? ` · ${b.o.ev.location}` : ""}</small>}
                      </div>
                      {(isSel || HOVER) && ok && <>
                        <span class="hdl hdl-t" onPointerDown={(e) => { e.stopPropagation(); begin(e, "start", b.o, b.o.start, b.o.end, b.o.key); }} {...handlers} />
                        <span class="hdl hdl-b" onPointerDown={(e) => { e.stopPropagation(); begin(e, "end", b.o, b.o.start, b.o.end, b.o.key); }} {...handlers} />
                      </>}
                    </div>
                  );
                })}
                {preview && dayIdx === di && (() => {
                  const ds = startOfDay(d);
                  const top = Math.max(0, (preview.s.getTime() - ds.getTime()) / 3600000) * HOUR;
                  const h = Math.max(18, ((Math.min(preview.e.getTime(), addDays(ds, 1).getTime()) - preview.s.getTime()) / 3600000) * HOUR - 2);
                  const col = preview.occ ? preview.occ.color : "var(--accent)";
                  return (
                    <div class={"blk lifted" + (preview.occ ? "" : " newblk")} style={{ top: `${top}px`, height: `${h}px`, left: "1px", width: "calc(100% - 3px)", background: col }}>
                      {preview.occ ? (preview.occ.ev.title || "(senza titolo)") : "Nuovo evento"}
                      <small>{hm(preview.s)} – {hm(preview.e)}</small>
                      <span class="hdl hdl-t" /><span class="hdl hdl-b" />
                    </div>
                  );
                })()}
                {preview && <div class="snapline" style={{ display: dayIdx === di ? "block" : "none", top: `${(preview.mode === "end" || preview.mode === "new" ? (preview.e.getTime() - startOfDay(d).getTime()) : (preview.s.getTime() - startOfDay(d).getTime())) / 3600000 * HOUR}px` }}>
                  <b>{hm(preview.mode === "end" || preview.mode === "new" ? preview.e : preview.s)}</b>
                </div>}
                {isToday && <div class="nowline" style={{ top: `${(today.getHours() + today.getMinutes() / 60) * HOUR}px` }} />}
              </div>
            );
          })}
        </div>
      </div>
      {sel && !preview && <div class="draghint">Trascina per spostare · trascina i pallini (o i bordi) per cambiare inizio e fine · tocca fuori per finire</div>}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------- elenco
export function AgendaView() {
  const [n, setN] = useState(60);
  const from = startOfDay(now.value);
  const occs = occurrences(from, addDays(from, n));
  const byDay = new Map<string, { d: Date; list: Occ[] }>();
  for (const o of occs) {
    let d = o.start < from ? from : startOfDay(o.start);
    const k = d.toDateString();
    if (!byDay.has(k)) byDay.set(k, { d, list: [] });
    byDay.get(k)!.list.push(o);
  }
  const groups = [...byDay.values()].sort((a, b) => a.d.getTime() - b.d.getTime());
  const today = now.value;
  return (
    <div class="agenda">
      {!groups.length && <div class="empty">Nessun evento nei prossimi {n} giorni.<br />Tocca + per aggiungerne uno.</div>}
      {groups.map((g) => (
        <div class="aday">
          <h4 class={sameDay(g.d, today) ? "today" : ""}>{sameDay(g.d, today) ? "Oggi · " : sameDay(g.d, addDays(today, 1)) ? "Domani · " : ""}{fmtLongDay(g.d)}</h4>
          {g.list.map((o) => <EvRow o={o} day={g.d} />)}
        </div>
      ))}
      <div style={{ textAlign: "center", padding: "8px 0 20px" }}><button class="btn" onClick={() => setN(n + 90)}>Mostra altri giorni</button></div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------- anno
export function MiniMonth({ y, m, onPick, sel, compact }: { y: number; m: number; onPick: (d: Date) => void; sel?: Date | null; compact?: boolean }) {
  const st = settings.value, today = now.value;
  const weeks = monthWeeks(y, m, st.weekStart);
  const occ = occurrences(weeks[0][0], addDays(weeks[weeks.length - 1][6], 1));
  const has = new Set<string>();
  for (const o of occ) {
    let d = startOfDay(o.start);
    const last = new Date(Math.max(o.start.getTime(), o.end.getTime() - 1));
    for (let i = 0; i < 40 && d <= last; i++, d = addDays(d, 1)) has.add(d.toDateString());
  }
  const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (i + st.weekStart) % 7);
  return (
    <div class="mini">
      {order.map((d) => <span class="h" style={{ color: d === 0 ? "var(--sun)" : d === 6 ? "var(--sat)" : undefined }}>{DAYS_LETTER[d]}</span>)}
      {weeks.flat().map((d) => {
        const cls = [d.getMonth() !== m ? "o" : "", sameDay(d, today) ? "t" : "", has.has(d.toDateString()) && d.getMonth() === m ? "e" : "", sel && sameDay(sel, d) && d.getMonth() === m ? "s" : ""].join(" ");
        return compact
          ? <button class={cls} onClick={() => onPick(d)}>{d.getDate()}</button>
          : <span class={cls}>{d.getDate()}</span>;
      })}
    </div>
  );
}

export function YearView() {
  const y = cursor.value.getFullYear(), today = now.value;
  const swipe = useSwipe((d) => (cursor.value = new Date(y + d, cursor.value.getMonth(), 1)));
  return (
    <div class="year" {...swipe}>
      {MONTHS.map((name, m) => (
        <button class={"ymon" + (today.getFullYear() === y && today.getMonth() === m ? " cur" : "")} onClick={() => { cursor.value = new Date(y, m, 1); setSettings({ view: "month" }); }}>
          <h5>{cap(name)}</h5>
          <MiniMonth y={y} m={m} onPick={() => {}} />
        </button>
      ))}
    </div>
  );
}
