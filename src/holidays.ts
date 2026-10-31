// Festività nazionali italiane (come nel calendario Samsung: numeri in rosso e nome del giorno).
import { ymd } from "./date";

function easter(y: number): Date {                     // algoritmo di Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const cache = new Map<number, Map<string, string>>();
export function holidaysOfYear(y: number): Map<string, string> {
  let m = cache.get(y);
  if (m) return m;
  m = new Map();
  const fixed: [number, number, string][] = [[1, 1, "Capodanno"], [1, 6, "Epifania"], [4, 25, "Festa della Liberazione"], [5, 1, "Festa del Lavoro"],
    [6, 2, "Festa della Repubblica"], [8, 15, "Ferragosto"], [11, 1, "Tutti i Santi"], [12, 8, "Immacolata"], [12, 25, "Natale"], [12, 26, "Santo Stefano"]];
  if (y >= 2026) fixed.push([10, 4, "San Francesco d'Assisi"]);          // di nuovo festa nazionale dal 2026
  for (const [mo, d, n] of fixed) m.set(ymd(new Date(y, mo - 1, d)), n);
  const e = easter(y);
  m.set(ymd(e), "Pasqua");
  m.set(ymd(new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1)), "Lunedì dell'Angelo");
  cache.set(y, m);
  return m;
}

export function holidayName(d: Date): string | undefined {
  return holidaysOfYear(d.getFullYear()).get(ymd(d));
}

/** {'YYYY-MM-DD': nome} fra due anni (per i widget). */
export function holidaysRange(y0: number, y1: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let y = y0; y <= y1; y++) for (const [k, v] of holidaysOfYear(y)) out[k] = v;
  return out;
}
