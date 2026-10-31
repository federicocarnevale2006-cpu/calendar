// Spostare e allungare gli eventi col dito, come nel calendario Samsung: pressione lunga sull'evento, poi trascinamento
// (cambia ora e giorno) o maniglie in alto/in basso (cambia inizio/fine). Sul PC basta cliccare e trascinare.
import { addDays, hm, localDateToUtcIso, ymd } from "../date";
import { uuid, type Ev, type Occ } from "../model";
import { evMap, isHoliday, saveEvent } from "../store";
import { isAndroid } from "../platform";
import { showToast } from "./state";

export const LONG_MS = 380;           // pressione lunga (dito)
export const SLOP = 9;                // movimento oltre il quale e' uno scorrimento, non una pressione lunga
export const STEP_MIN = 15;           // passo di trascinamento (minuti)

/** true durante un trascinamento: lo scorrimento laterale (cambio mese/settimana) non deve scattare. */
export const dragFlag = { on: false, until: 0 };
export function dragging(): boolean { return dragFlag.on || Date.now() < dragFlag.until; }

let lastTick = "";
export async function tick(sig: string) {        // piccola vibrazione a ogni scatto (solo se cambia)
  if (sig === lastTick) return;
  lastTick = sig;
  if (!isAndroid) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* nessuna vibrazione */ }
}
export async function thump() {
  lastTick = "";
  if (!isAndroid) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch { /* */ }
}

export function snap(d: Date, min = STEP_MIN): Date {
  const t = new Date(d);
  const m = t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60;
  const r = Math.round(m / min) * min;
  return new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, r);
}

export function editable(o: Occ): boolean {
  return !isHoliday(o.ev) && !!evMap.value.get(o.ev.id);
}

/** Salva i nuovi orari. Per un evento che si ripete cambia solo questa volta (come Samsung quando lo si trascina). */
export async function retime(o: Occ, s: Date, e: Date): Promise<string | null> {
  const master = evMap.value.get(o.ev.id);
  if (!master || isHoliday(master)) return null;
  const times = master.all_day
    ? { start_at: localDateToUtcIso(s), end_at: localDateToUtcIso(addDays(e, -1)) }
    : { start_at: s.toISOString(), end_at: e.toISOString() };
  const when = master.all_day ? `${s.getDate()}/${s.getMonth() + 1}` : `${s.getDate()}/${s.getMonth() + 1} alle ${hm(s)}`;
  if (master.rrule) {
    const before = master;
    const single: Ev = { ...master, id: uuid(), rrule: null, exdates: [], ...times };
    await saveEvent({ ...master, exdates: [...new Set([...(master.exdates || []), ymd(o.start)])] });
    await saveEvent(single);
    showToast(`Solo questa volta: ${when}`, { label: "Annulla", run: () => { void saveEvent(before); void saveEvent({ ...single, deleted: true }); } });
    return single.id;
  }
  await saveEvent({ ...master, ...times });
  showToast(`Spostato: ${when}`, { label: "Annulla", run: () => void saveEvent(master) });
  return master.id;
}

/** Sposta di n giorni (vista mese), stessi orari. */
export async function shiftDays(o: Occ, n: number) {
  if (!n || !evMap.value.get(o.ev.id)) return;
  await retime(o, addDays(o.start, n), addDays(o.end, n));       // «tutto il giorno»: o.end e' gia' il giorno dopo l'ultimo
}
