import { addDays, dayDiff, parseYmd, RR_DAYS, utcDateToLocal, ymd } from "./date";

export interface Cal {
  id: string;
  user_id?: string;
  name: string;
  color: string;
  visible: boolean;
  sort: number;
  deleted: boolean;
  updated_at?: string;
}

export interface Ev {
  id: string;
  user_id?: string;
  calendar_id: string | null;
  title: string;
  all_day: boolean;
  start_at: string;          // ISO; per «tutto il giorno» mezzanotte UTC del primo giorno
  end_at: string;            // ISO; per «tutto il giorno» mezzanotte UTC dell'ULTIMO giorno (incluso)
  tz: string;
  location: string;
  notes: string;
  color: string | null;
  rrule: string | null;
  exdates: string[];         // date locali 'YYYY-MM-DD' delle ripetizioni tolte
  reminders: number[];       // minuti prima dell'inizio
  deleted: boolean;
  updated_at?: string;
}

export interface Occ {
  ev: Ev;
  key: string;
  start: Date;
  end: Date;                 // esclusa (per «tutto il giorno»: mezzanotte del giorno dopo l'ultimo)
  allDay: boolean;
  color: string;
}

export interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byday: number[];           // 0 = domenica
  until: string | null;      // 'YYYY-MM-DD' incluso
  count: number | null;
}

export function parseRule(s: string | null): Rule | null {
  if (!s) return null;
  const r: Rule = { freq: "DAILY", interval: 1, byday: [], until: null, count: null };
  for (const part of s.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = part.split("=");
    if (!v) continue;
    const K = k.toUpperCase();
    if (K === "FREQ" && ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(v.toUpperCase())) r.freq = v.toUpperCase() as Rule["freq"];
    else if (K === "INTERVAL") r.interval = Math.max(1, parseInt(v) || 1);
    else if (K === "BYDAY") r.byday = v.toUpperCase().split(",").map((x) => RR_DAYS.indexOf(x.slice(-2))).filter((x) => x >= 0);
    else if (K === "UNTIL") r.until = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    else if (K === "COUNT") r.count = Math.max(1, parseInt(v) || 1);
  }
  return r;
}

export function ruleToString(r: Rule): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY" && r.byday.length) parts.push(`BYDAY=${[...r.byday].sort().map((d) => RR_DAYS[d]).join(",")}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, "")}`);
  else if (r.count) parts.push(`COUNT=${r.count}`);
  return parts.join(";");
}

/** Inizio "da parete" (data e ora locali) e durata di un evento. */
function base(ev: Ev): { start: Date; durMs: number; days: number } {
  if (ev.all_day) {
    const s = utcDateToLocal(ev.start_at), e = utcDateToLocal(ev.end_at);
    return { start: s, durMs: 0, days: Math.max(0, dayDiff(s, e)) + 1 };
  }
  const s = new Date(ev.start_at), e = new Date(ev.end_at);
  return { start: s, durMs: Math.max(0, e.getTime() - s.getTime()), days: 0 };
}

function mk(ev: Ev, start: Date, b: { durMs: number; days: number }, color: string): Occ {
  const end = ev.all_day ? addDays(start, b.days) : new Date(start.getTime() + b.durMs);
  return { ev, key: `${ev.id}_${ymd(start)}`, start, end, allDay: ev.all_day, color };
}

function at(y: number, m: number, d: number, src: Date): Date | null {
  const t = new Date(y, m, d, src.getHours(), src.getMinutes(), src.getSeconds());
  return t.getDate() === d && t.getMonth() === ((m % 12) + 12) % 12 ? t : null;   // 31 aprile o 29 febbraio non validi: saltati
}

/** Tutte le volte in cui l'evento cade fra from (incluso) e to (escluso). Stesso algoritmo nel modulo Python di Trofeo LCD. */
export function expand(ev: Ev, from: Date, to: Date, color: string): Occ[] {
  const b = base(ev);
  const out: Occ[] = [];
  const overlaps = (s: Date) => {
    const e = ev.all_day ? addDays(s, b.days) : new Date(s.getTime() + b.durMs);
    return s < to && (e > from || (e.getTime() === s.getTime() && s >= from));
  };
  const r = parseRule(ev.rrule);
  if (!r) {
    if (overlaps(b.start)) out.push(mk(ev, b.start, b, color));
    return out;
  }
  const ex = new Set(ev.exdates || []);
  const until = r.until ? addDays(parseYmd(r.until), 1) : null;     // primo istante NON incluso
  const s0 = b.start;
  const lookback = ev.all_day ? b.days + 1 : Math.ceil(b.durMs / 86400000) + 1;   // ripetizioni iniziate prima di from ma ancora in corso
  let k = 0;
  if (!r.count) {
    const ref = addDays(from, -lookback);
    if (ref > s0) {
      const span = r.freq === "DAILY" ? dayDiff(s0, ref)
        : r.freq === "WEEKLY" ? Math.floor(dayDiff(s0, ref) / 7)
        : r.freq === "MONTHLY" ? (ref.getFullYear() - s0.getFullYear()) * 12 + ref.getMonth() - s0.getMonth()
        : ref.getFullYear() - s0.getFullYear();
      k = Math.max(0, Math.floor(span / r.interval) - 1);
    }
  }
  let n = 0;
  const weekStart0 = addDays(new Date(s0.getFullYear(), s0.getMonth(), s0.getDate(), s0.getHours(), s0.getMinutes(), s0.getSeconds()), -((s0.getDay() + 6) % 7));
  for (let guard = 0; guard < 20000; guard++, k++) {
    let cands: (Date | null)[];
    if (r.freq === "DAILY") cands = [addDays(s0, k * r.interval)];
    else if (r.freq === "WEEKLY") {
      if (r.byday.length) {
        const ws = addDays(weekStart0, k * 7 * r.interval);
        cands = [...r.byday].map((d) => (d + 6) % 7).sort((a, c) => a - c).map((off) => addDays(ws, off));
      } else cands = [addDays(s0, k * 7 * r.interval)];
    } else if (r.freq === "MONTHLY") cands = [at(s0.getFullYear(), s0.getMonth() + k * r.interval, s0.getDate(), s0)];
    else cands = [at(s0.getFullYear() + k * r.interval, s0.getMonth(), s0.getDate(), s0)];
    let stop = false;
    for (const c of cands) {
      if (!c || c < s0) continue;
      if (until && c >= until) { stop = true; break; }
      if (c >= to) { stop = true; break; }
      n++;
      if (!ex.has(ymd(c)) && overlaps(c)) out.push(mk(ev, c, b, color));
      if (r.count && n >= r.count) { stop = true; break; }
    }
    if (stop) break;
  }
  return out;
}

export function describeRule(s: string | null, start: Date): string {
  const r = parseRule(s);
  if (!r) return "Non si ripete";
  const every = (one: string, many: string) => (r.interval === 1 ? one : `Ogni ${r.interval} ${many}`);
  let t = "";
  if (r.freq === "DAILY") t = every("Ogni giorno", "giorni");
  else if (r.freq === "WEEKLY") {
    const names = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
    const days = (r.byday.length ? r.byday : [start.getDay()]).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    t = `${every("Ogni settimana", "settimane")} (${days.map((d) => names[d]).join(", ")})`;
  } else if (r.freq === "MONTHLY") t = `${every("Ogni mese", "mesi")} il giorno ${start.getDate()}`;
  else t = every("Ogni anno", "anni");
  if (r.until) {
    const u = parseYmd(r.until);
    t += ` fino al ${u.getDate()}/${u.getMonth() + 1}/${u.getFullYear()}`;
  } else if (r.count) t += `, ${r.count} volte`;
  return t;
}

export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  (c ?? { getRandomValues: (a: Uint8Array) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
