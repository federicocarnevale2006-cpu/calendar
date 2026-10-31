export const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
  "settembre", "ottobre", "novembre", "dicembre"];
export const MONTHS_SHORT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
export const DAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
export const DAYS_SHORT = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
export const DAYS_LETTER = ["D", "L", "M", "M", "G", "V", "S"];
export const RR_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const p2 = (n: number) => String(n).padStart(2, "0");

/** 'YYYY-MM-DD' secondo l'ora locale. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function hm(d: Date): string {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
}
export function addMonths(d: Date, n: number): Date {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
}
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** Giorni di calendario fra due date (ignora l'ora legale). */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}
export function startOfWeek(d: Date, weekStart: number): Date {
  const diff = (d.getDay() - weekStart + 7) % 7;
  return addDays(startOfDay(d), -diff);
}
/** Settimane (righe) del mese, ognuna di 7 giorni; 4-6 righe come serve. */
export function monthWeeks(year: number, month: number, weekStart: number): Date[][] {
  const first = new Date(year, month, 1);
  let cur = startOfWeek(first, weekStart);
  const out: Date[][] = [];
  while (out.length < 6) {
    const w: Date[] = [];
    for (let i = 0; i < 7; i++) w.push(addDays(cur, i));
    out.push(w);
    cur = addDays(cur, 7);
    if (cur.getMonth() !== month && cur > first) break;
  }
  return out;
}
/** Numero della settimana ISO. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
}
/** Data «tutto il giorno» salvata come mezzanotte UTC -> data locale. */
export function utcDateToLocal(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
export function localDateToUtcIso(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
}
export function fmtLongDay(d: Date): string {
  return `${cap(DAYS[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function fmtShortDay(d: Date): string {
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
export function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const g = Math.floor(h / 24), hh = h % 24;
  return hh ? `${g} g ${hh} h` : `${g} ${g === 1 ? "giorno" : "giorni"}`;
}
