import { signal, computed } from "@preact/signals";
import { createClient, type Session, type RealtimeChannel } from "@supabase/supabase-js";
import { openDB, type IDBPDatabase } from "idb";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";
import { expand, uuid, type Cal, type Ev, type Occ } from "./model";
import { addDays, localDateToUtcIso, startOfDay } from "./date";
import { holidayName } from "./holidays";

export const HOLIDAY_COLOR = "#e5484d";
/** Evento finto (non salvato, non modificabile) per una festivita'. */
export function isHoliday(e: Ev): boolean { return e.id.startsWith("hol-"); }
function holidayOccs(from: Date, to: Date): Occ[] {
  const out: Occ[] = [];
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
    const n = holidayName(d);
    if (!n) continue;
    const iso = localDateToUtcIso(d);
    const ev: Ev = { id: "hol-" + iso.slice(0, 10), calendar_id: null, title: n, all_day: true, start_at: iso, end_at: iso, tz: "", location: "", notes: "",
      color: HOLIDAY_COLOR, rrule: null, exdates: [], reminders: [], deleted: false };
    out.push({ ev, key: ev.id, start: d, end: addDays(d, 1), allDay: true, color: HOLIDAY_COLOR });
  }
  return out;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "calendario-auth" },
  realtime: { params: { eventsPerSecond: 20 } },
});

// ---- stato --------------------------------------------------------------------------------------------------
export const session = signal<Session | null>(null);
export const ready = signal(false);
export const cals = signal<Cal[]>([]);
export const evMap = signal<Map<string, Ev>>(new Map());
export const syncState = signal<"offline" | "sync" | "ok" | "error">("offline");
export const syncError = signal("");
export const lastSync = signal<number>(0);
export const pendingCount = signal(0);
export const sentSignal = signal(0);                    // ultima volta che le modifiche in attesa sono partite

export interface Settings {
  weekStart: number;            // 1 = lunedi', 0 = domenica
  theme: "system" | "light" | "dark";
  weekNumbers: boolean;
  defaultCal: string | null;
  defaultReminder: number | null;
  defaultDuration: number;      // minuti
  view: "month" | "week" | "day" | "agenda" | "year";
  holidays: boolean;            // festivita' italiane
}
const SETTINGS_DEFAULT: Settings = { weekStart: 1, theme: "system", weekNumbers: false, defaultCal: null, defaultReminder: 15, defaultDuration: 60, view: "month", holidays: true };
function loadSettings(): Settings {
  try {
    return { ...SETTINGS_DEFAULT, ...JSON.parse(localStorage.getItem("calendario-settings") || "{}") };
  } catch {
    return { ...SETTINGS_DEFAULT };
  }
}
export const settings = signal<Settings>(loadSettings());
export function setSettings(p: Partial<Settings>) {
  settings.value = { ...settings.value, ...p };
  try {
    localStorage.setItem("calendario-settings", JSON.stringify(settings.value));
  } catch { /* archiviazione non disponibile: resta in memoria */ }
}

export const calById = computed(() => new Map(cals.value.map((c) => [c.id, c])));
export const visibleCals = computed(() => cals.value.filter((c) => !c.deleted).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
export const events = computed(() => [...evMap.value.values()].filter((e) => !e.deleted));

export function evColor(e: Ev): string {
  return e.color || calById.value.get(e.calendar_id || "")?.color || "#3b82f6";
}

/** Occorrenze visibili fra due date (cache per intervallo, si azzera quando cambiano i dati). */
let occCache = new Map<string, Occ[]>();
let occEv: unknown = null, occCals: unknown = null;
export function occurrences(from: Date, to: Date): Occ[] {
  if (occEv !== evMap.value || occCals !== cals.value) {      // dati cambiati: si ricalcola
    occCache = new Map();
    occEv = evMap.value;
    occCals = cals.value;
  }
  const withHol = settings.value.holidays;
  const k = `${from.getTime()}_${to.getTime()}_${withHol ? 1 : 0}`;
  const hit = occCache.get(k);
  if (hit) return hit;
  const hidden = new Set(cals.value.filter((c) => !c.visible || c.deleted).map((c) => c.id));
  const out: Occ[] = [];
  for (const e of evMap.value.values()) {
    if (e.deleted || (e.calendar_id && hidden.has(e.calendar_id))) continue;
    out.push(...expand(e, from, to, evColor(e)));
  }
  if (withHol) out.push(...holidayOccs(from, to));
  out.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime() || (b.end.getTime() - b.start.getTime()) - (a.end.getTime() - a.start.getTime()) || a.ev.title.localeCompare(b.ev.title));
  if (occCache.size > 60) occCache.clear();
  occCache.set(k, out);
  return out;
}
export function dayOccurrences(d: Date): Occ[] {
  const s = startOfDay(d);
  return occurrences(s, addDays(s, 1));
}

// ---- archivio locale (funziona anche senza rete) ------------------------------------------------------------
let db: IDBPDatabase | null = null;
async function getDb() {
  if (!db) {
    db = await openDB("calendario", 1, {
      upgrade(d) {
        d.createObjectStore("events", { keyPath: "id" });
        d.createObjectStore("cals", { keyPath: "id" });
        d.createObjectStore("outbox");
        d.createObjectStore("meta");
      },
    });
  }
  return db;
}
async function meta<T>(k: string): Promise<T | undefined> {
  return (await getDb()).get("meta", k);
}
async function setMeta(k: string, v: unknown) {
  await (await getDb()).put("meta", v, k);
}

async function loadLocal() {
  const d = await getDb();
  const [es, cs, ob] = await Promise.all([d.getAll("events"), d.getAll("cals"), d.getAllKeys("outbox")]);
  evMap.value = new Map(es.map((e: Ev) => [e.id, e]));
  cals.value = cs;
  pendingCount.value = ob.length;
}

async function clearLocal() {
  const d = await getDb();
  const tx = d.transaction(["events", "cals", "outbox", "meta"], "readwrite");
  await Promise.all([tx.objectStore("events").clear(), tx.objectStore("cals").clear(), tx.objectStore("outbox").clear(), tx.objectStore("meta").clear(), tx.done]);
  evMap.value = new Map();
  cals.value = [];
  pendingCount.value = 0;
}

// ---- modifiche ----------------------------------------------------------------------------------------------
let localSeq = Date.now();
async function queue(table: "events" | "cals", row: Ev | Cal) {
  const d = await getDb();
  const seq = ++localSeq;
  await d.put(table, row);
  await d.put("outbox", { table, id: row.id, seq }, `${table}:${row.id}`);
  pendingCount.value = (await d.getAllKeys("outbox")).length;
  scheduleSync(300);
}

export async function saveEvent(ev: Ev) {
  const row = { ...ev, updated_at: new Date().toISOString() };
  const m = new Map(evMap.value);
  m.set(row.id, row);
  evMap.value = m;
  await queue("events", row);
}
export async function deleteEvent(id: string) {
  const e = evMap.value.get(id);
  if (e) await saveEvent({ ...e, deleted: true });
}
export async function saveCal(c: Cal) {
  const row = { ...c, updated_at: new Date().toISOString() };
  cals.value = [...cals.value.filter((x) => x.id !== c.id), row];
  await queue("cals", row);
}
export function newEvent(start: Date, allDay = false): Ev {
  const st = settings.value;
  const cal = (st.defaultCal && calById.value.get(st.defaultCal) && !calById.value.get(st.defaultCal)!.deleted ? st.defaultCal : visibleCals.value[0]?.id) ?? null;
  const end = new Date(start.getTime() + st.defaultDuration * 60000);
  return {
    id: uuid(), calendar_id: cal, title: "", all_day: allDay, start_at: start.toISOString(), end_at: end.toISOString(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome", location: "", notes: "", color: null, rrule: null,
    exdates: [], reminders: st.defaultReminder != null ? [st.defaultReminder] : [], deleted: false,
  };
}

// ---- sincronizzazione ---------------------------------------------------------------------------------------
const TABLE = { events: "events", cals: "calendars" } as const;
const COLS = {
  events: ["id", "user_id", "calendar_id", "title", "all_day", "start_at", "end_at", "tz", "location", "notes", "color", "rrule", "exdates", "reminders", "deleted"],
  cals: ["id", "user_id", "name", "color", "visible", "sort", "deleted"],
};
let syncing = false, again = false, timer: ReturnType<typeof setTimeout> | null = null;
export const rejected = signal<string[]>([]);           // modifiche che il server non ha accettato (per le Impostazioni)
function isNetErr(e: any): boolean {
  const m = String(e?.message || e || "").toLowerCase();
  return !e?.code || m.includes("fetch") || m.includes("network") || m.includes("failed") || m.includes("timeout") || m.includes("load");
}
let retryMs = 3000;                                      // nuovo tentativo dopo un errore: 3 s, poi sempre piu' tardi (max 60 s)
let channel: RealtimeChannel | null = null;

export function scheduleSync(ms = 0) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void sync(); }, ms);
}

async function push(uid: string) {
  const d = await getDb();
  const keys = (await d.getAllKeys("outbox")) as string[];
  if (!keys.length) return;
  const items = await Promise.all(keys.map(async (k) => ({ k, v: await d.get("outbox", k) })));
  for (const table of ["cals", "events"] as const) {           // prima i calendari: gli eventi li citano
    const mine = items.filter((i) => i.v?.table === table);
    for (let i = 0; i < mine.length; i += 200) {
      const chunk = mine.slice(i, i + 200);
      const rows = [];
      for (const it of chunk) {
        const r = await d.get(table, it.v.id);
        if (!r) continue;
        const o: Record<string, unknown> = {};
        for (const c of COLS[table]) o[c] = c === "user_id" ? uid : r[c];
        rows.push(o);
      }
      if (rows.length) {
        const { error } = await supabase.from(TABLE[table]).upsert(rows, { onConflict: "id" });
        if (error) {
          if (isNetErr(error)) throw new Error(error.message);
          // il server ha rifiutato il gruppo: si riprova riga per riga, cosi' una sola riga sbagliata non blocca le altre
          for (const r of rows) {
            const one = await supabase.from(TABLE[table]).upsert([r], { onConflict: "id" });
            if (one.error) {
              if (isNetErr(one.error)) throw new Error(one.error.message);
              console.warn("riga rifiutata dal server, tolta dalla coda", table, r.id, one.error.message);
              rejected.value = [...rejected.value.slice(-9), `${one.error.message}`];
            }
          }
        }
      }
      for (const it of chunk) {                                 // tolto dalla coda solo se nel frattempo non e' cambiato di nuovo
        const cur = await d.get("outbox", it.k);
        if (cur && cur.seq === it.v.seq) await d.delete("outbox", it.k);
      }
    }
  }
  pendingCount.value = (await d.getAllKeys("outbox")).length;
}

async function mergeRows(table: "events" | "cals", rows: any[]) {
  if (!rows.length) return;
  const d = await getDb();
  const pend = new Set(((await d.getAllKeys("outbox")) as string[]).filter((k) => k.startsWith(table + ":")).map((k) => k.slice(table.length + 1)));
  const tx = d.transaction(table, "readwrite");
  const keep = rows.filter((r) => !pend.has(r.id));              // modifiche locali non ancora inviate: vincono loro
  for (const r of keep) {
    if (table === "events") r.exdates = Array.isArray(r.exdates) ? r.exdates : [];
    void tx.store.put(r);
  }
  await tx.done;
  if (table === "events") {
    const m = new Map(evMap.value);
    for (const r of keep) m.set(r.id, r);
    evMap.value = m;
  } else {
    const m = new Map(cals.value.map((c) => [c.id, c]));
    for (const r of keep) m.set(r.id, r);
    cals.value = [...m.values()];
  }
}

async function pull() {
  for (const table of ["cals", "events"] as const) {
    let since = (await meta<string>("since_" + table)) || "1970-01-01T00:00:00Z";
    for (let page = 0; page < 50; page++) {
      const q = supabase.from(TABLE[table]).select("*").gt("updated_at", new Date(new Date(since).getTime() - 2000).toISOString())
        .order("updated_at", { ascending: true }).limit(1000);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      await mergeRows(table, data || []);
      if (!data || !data.length) break;
      const last = data[data.length - 1].updated_at as string;
      if (last === since) break;
      since = last;
      await setMeta("since_" + table, since);
      if (data.length < 1000) break;
    }
  }
}

// prova senza rete (solo per i test: indirizzo con ?demo=1)
export const DEMO = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

export async function sync() {
  const s = session.value;
  if (!s || DEMO) return;
  if (syncing) { again = true; return; }
  syncing = true;
  syncState.value = "sync";
  const hadPending = pendingCount.value;
  try {
    await push(s.user.id);
    await pull();
    syncState.value = "ok";
    syncError.value = "";
    lastSync.value = Date.now();
    retryMs = 3000;
    if (hadPending && !pendingCount.value) sentSignal.value = Date.now();   // «modifiche inviate» (l'interfaccia lo dice)
  } catch (e: any) {
    const off = typeof navigator !== "undefined" && navigator.onLine === false;
    syncState.value = off || isNetErr(e) ? "offline" : "error";
    syncError.value = String(e?.message || e);
    scheduleSync(retryMs);
    retryMs = Math.min(60000, retryMs * 2);
  } finally {
    syncing = false;
    if (again) { again = false; scheduleSync(200); }
  }
}

function subscribe(uid: string) {
  if (channel) void supabase.removeChannel(channel);
  channel = supabase.channel("cal-" + uid);
  for (const table of ["events", "cals"] as const) {
    channel.on("postgres_changes" as any, { event: "*", schema: "public", table: TABLE[table], filter: `user_id=eq.${uid}` }, (p: any) => {
      if (p.eventType === "DELETE") return;
      void mergeRows(table, [p.new]);
    });
  }
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") scheduleSync(0);              // dopo una riconnessione si recupera quello che si e' perso
  });
}

async function onSession(s: Session | null) {
  const prev = session.value?.user.id;
  session.value = s;
  if (!s) {
    if (channel) { void supabase.removeChannel(channel); channel = null; }
    return;
  }
  if (prev !== s.user.id) {
    const owner = await meta<string>("uid");
    if (owner && owner !== s.user.id) await clearLocal();       // un altro account: i dati locali del precedente si cancellano
    await setMeta("uid", s.user.id);
    subscribe(s.user.id);
  }
  scheduleSync(0);
}

export async function init() {
  try {
    await loadLocal();
  } catch (e) {
    console.warn("archivio locale non disponibile", e);
  }
  if (DEMO) {
    const { seedDemo } = await import("./demo");
    seedDemo();
    ready.value = true;
    return;
  }
  const { data } = await supabase.auth.getSession();
  await onSession(data.session);
  supabase.auth.onAuthStateChange((_ev, s) => { void onSession(s); });
  ready.value = true;
  window.addEventListener("online", () => scheduleSync(0));
  window.addEventListener("offline", () => { syncState.value = "offline"; });
  // tornando all'app si sincronizza; uscendo, se ci sono modifiche in attesa si prova a inviarle subito (prima che il
  // telefono chiuda l'app)
  document.addEventListener("visibilitychange", () => { if (!document.hidden || pendingCount.value) scheduleSync(0); });
  // ogni minuto si controlla comunque il server: se il collegamento in tempo reale si e' perso (PC in sospensione, rete
  // cambiata) le modifiche fatte sul telefono arrivano lo stesso. Sul PC anche a finestra chiusa (aggiorna Trofeo LCD).
  const isPC = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  setInterval(() => { if (isPC || !document.hidden || pendingCount.value) scheduleSync(0); }, 60000);
}

export async function signOut() {
  await supabase.auth.signOut();
  await clearLocal();
}

export async function createDeviceKey(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_device_key", { p_name: name });
  if (error) throw new Error(error.message);
  return data as string;
}
