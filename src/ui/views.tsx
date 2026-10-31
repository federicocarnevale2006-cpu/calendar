import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { addDays, addMonths, cap, dayDiff, DAYS_LETTER, DAYS_SHORT, fmtLongDay, hm, isoWeek, MONTHS, monthWeeks, sameDay, startOfDay, startOfWeek } from "../date";
import type { Occ } from "../model";
import { dayOccurrences, newEvent, occurrences, settings, setSettings } from "../store";
import { haptic } from "../platform";
import { cursor, now, push, selDay } from "./state";
import { Icon } from "./icons";

const dayCls = (d: Date) => (d.getDay() === 0 ? "sun" : d.getDay() === 6 ? "sat" : "");

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
    if (dbl || (!desk && sd && sameDay(sd, d))) { openNew(d); return; }
    selDay.value = d;
    if (d.getMonth() !== c.getMonth()) cursor.value = new Date(d.getFullYear(), d.getMonth(), 1);
  };
  return (
    <div class="month" {...swipe}>
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
                const cls = ["mcell", dayCls(d), d.getMonth() !== c.getMonth() ? "out" : "", sameDay(d, today) ? "today" : "", sd && sameDay(sd, d) ? "sel" : ""].join(" ");
                if (dotsMode) {
                  const cols = [...new Set([...spans.filter((s) => s.c0 <= i && s.c1 >= i).map((s) => s.o.color), ...(slots.filter((x) => x && x !== "span") as Occ[]).map((o) => o.color)])].slice(0, 4);
                  return (
                    <button class={cls} onClick={() => tapDay(d)} onDblClick={() => tapDay(d, true)} aria-label={fmtLongDay(d)}>
                      <span class="dn">{d.getDate()}</span>
                      <span class="dots">{cols.map((cl) => <i style={{ background: cl }} />)}</span>
                    </button>
                  );
                }
                const shown = slots.slice(0, limits[i]);
                const hidden = slots.slice(shown.length).filter(Boolean).length;
                return (
                  <button class={cls} onClick={() => tapDay(d)} onDblClick={() => tapDay(d, true)} aria-label={fmtLongDay(d)}>
                    <span class="dn">{d.getDate()}</span>
                    {shown.map((s) => {
                      if (s === "span" || s === null) return <div class="chip" style={{ visibility: "hidden" }} />;
                      return (
                        <div class="chip timed" title={s.ev.title} style={{ "--c": s.color } as any}>
                          <i style={{ background: s.color }} />
                          {s.ev.title || "(senza titolo)"}
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
                  <div class="mspan" style={{
                    top: `${top + s.lane * lineH}px`, background: s.o.color,
                    left: `calc(${off}px + (100% - ${off}px) * ${s.c0 / 7} + 2px)`, width: `calc((100% - ${off}px) * ${(s.c1 - s.c0 + 1) / 7} - 4px)`,
                  }}>{s.o.ev.title || "(senza titolo)"}</div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DayList({ day }: { day: Date }) {
  const list = dayOccurrences(day);
  if (!list.length) return <div class="empty">Nessun evento</div>;
  return <>{list.map((o) => <EvRow o={o} day={day} />)}</>;
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

export function WeekView({ days }: { days: 1 | 7 }) {
  const st = settings.value, c = cursor.value, today = now.value;
  const start = days === 7 ? startOfWeek(c, st.weekStart) : startOfDay(c);
  const list = Array.from({ length: days }, (_, i) => addDays(start, i));
  const occs = occurrences(start, addDays(start, days));
  const scroller = useRef<HTMLDivElement>(null);
  const cols = `52px repeat(${days}, minmax(0, 1fr))`;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const inRange = list.some((d) => sameDay(d, today));
    el.scrollTop = Math.max(0, (inRange ? today.getHours() - 1.5 : 7) * HOUR);
  }, [start.getTime()]);
  const swipe = useSwipe((d) => (cursor.value = addDays(c, d * days)));
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
      <div class="wscroll" ref={scroller}>
        <div class="wbody" style={{ gridTemplateColumns: cols, height: `${24 * HOUR}px` }}>
          <div class="hours">{Array.from({ length: 24 }, (_, h) => <div>{h ? `${String(h).padStart(2, "0")}:00` : ""}</div>)}</div>
          {list.map((d) => {
            const blocks = layoutDay(d, occs.filter((o) => !allDay.includes(o)));
            const isToday = sameDay(d, today);
            return (
              <div class={"wcol" + (isToday ? " today" : "")} onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const y = (e as MouseEvent).offsetY;
                openNew(d, Math.floor((y / HOUR) * 2) / 2);
              }}>
                {blocks.map((b) => (
                  <button class="blk" style={{ top: `${b.top}px`, height: `${Math.max(20, b.h - 2)}px`, left: `calc(${(b.col / b.cols) * 100}% + 1px)`, width: `calc(${100 / b.cols}% - 3px)`, background: b.o.color }}
                    onClick={() => push({ t: "detail", occ: b.o })}>
                    {b.o.ev.title || "(senza titolo)"}
                    {b.h > 34 && <small>{hm(b.o.start)} – {hm(b.o.end)}{b.o.ev.location ? ` · ${b.o.ev.location}` : ""}</small>}
                  </button>
                ))}
                {isToday && <div class="nowline" style={{ top: `${(today.getHours() + today.getMinutes() / 60) * HOUR}px` }} />}
              </div>
            );
          })}
        </div>
      </div>
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
