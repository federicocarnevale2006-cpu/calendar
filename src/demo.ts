import { addDays, localDateToUtcIso, startOfDay } from "./date";
import type { Cal, Ev } from "./model";
import { cals, evMap, session, syncState } from "./store";

export function seedDemo() {
  session.value = { user: { id: "demo", email: "prova@esempio.it" } } as any;
  syncState.value = "ok";
  const c: Cal[] = [
    { id: "c1", name: "Personale", color: "#3b82f6", visible: true, sort: 0, deleted: false },
    { id: "c2", name: "Lavoro", color: "#f59e0b", visible: true, sort: 1, deleted: false },
    { id: "c3", name: "Compleanni", color: "#ec4899", visible: true, sort: 2, deleted: false },
  ];
  const t = startOfDay(new Date());
  const at = (d: number, h: number, m = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + d, h, m).toISOString();
  const base = { tz: "Europe/Rome", location: "", notes: "", color: null, rrule: null, exdates: [], reminders: [15], deleted: false, all_day: false };
  const e: Ev[] = [
    { ...base, id: "e1", calendar_id: "c2", title: "Riunione di progetto", start_at: at(0, 10), end_at: at(0, 11), location: "Sala 2" },
    { ...base, id: "e2", calendar_id: "c1", title: "Palestra", start_at: at(-20, 18, 30), end_at: at(-20, 19, 30), rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" },
    { ...base, id: "e3", calendar_id: "c3", title: "Compleanno Marco", all_day: true, start_at: localDateToUtcIso(addDays(t, 3)), end_at: localDateToUtcIso(addDays(t, 3)), rrule: "FREQ=YEARLY" },
    { ...base, id: "e4", calendar_id: "c1", title: "Vacanza in montagna", all_day: true, start_at: localDateToUtcIso(addDays(t, 8)), end_at: localDateToUtcIso(addDays(t, 12)) },
    { ...base, id: "e5", calendar_id: "c2", title: "Call con il cliente", start_at: at(1, 15), end_at: at(1, 15, 45) },
    { ...base, id: "e6", calendar_id: "c1", title: "Dentista", start_at: at(2, 9), end_at: at(2, 10), location: "Via Roma 12" },
    { ...base, id: "e7", calendar_id: "c2", title: "Pranzo di lavoro", start_at: at(0, 13), end_at: at(0, 14) },
    { ...base, id: "e8", calendar_id: "c1", title: "Cena con amici", start_at: at(0, 20), end_at: at(0, 22, 30) },
    { ...base, id: "e9", calendar_id: "c2", title: "Revisione codice", start_at: at(0, 10, 30), end_at: at(0, 12) },
    { ...base, id: "e10", calendar_id: "c1", title: "Spesa", start_at: at(-2, 17), end_at: at(-2, 18) },
    { ...base, id: "e11", calendar_id: "c1", title: "giorno libero", color: "#ef4444", start_at: at(1, 0), end_at: at(1, 23, 59) },
  ];
  cals.value = c;
  evMap.value = new Map(e.map((x) => [x.id, x]));
}
