import { signal, computed } from "@preact/signals";
import { createClient, type Session, type RealtimeChannel } from "@supabase/supabase-js";
import { openDB, type IDBPDatabase } from "idb";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";
import { expand, uuid, type Cal, type Ev, type Occ } from "./model";
import { addDays, localDateToUtcIso, startOfDay } from "./date";
import { holidayName } from "./holidays";
import { isAndroid, nativePending, nativeTakeSent } from "./platform";

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
export const pushKeyBad = signal(0);                    // Android ha trovato la chiave del telefono rifiutata: va rifatta

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
  void mirror();
}

// ---- modifiche ----------------------------------------------------------------------------------------------
let localSeq = Date.now();
async function queue(table: "events" | "cals", row: Ev | Cal) {
  const d = await getDb();
  const seq = ++localSeq;
  await d.put(table, row);
  await d.put("outbox", { table, id: row.id, seq }, `${table}:${row.id}`);
  pendingCount.value = (await d.getAllKeys("outbox")).length;
  void mirror();                                          // copia ad Android: parte anche se l'app viene chiusa
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
/** Errore d'accesso (token scaduto o non rinnovato per la rete debole): la modifica e' giusta, si riprova dopo. */
function isAuthErr(e: any, status?: number): boolean {
  const m = String(e?.message || "").toLowerCase();
  return status === 401 || status === 403 || ["42501", "PGRST301", "PGRST302", "PGRST303"].includes(String(e?.code || ""))
    || m.includes("jwt") || m.includes("row-level security") || m.includes("permission denied");
}
const MAX_FAILS = 5;                                     // una riga rifiutata dal server per i suoi dati: dopo 5 tentativi si scarta
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
  // prima di inviare serve un accesso valido: se il rinnovo non riesce (rete assente o debole) si riprova dopo, senza toccare
  // la coda. Prima la richiesta partiva senza accesso, il server la rifiutava e la modifica veniva scartata.
  const { data: sd } = await supabase.auth.getSession();
  if (!sd.session) throw new Error("accesso da rinnovare (rete assente o debole)");
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
      const failed = new Map<string, string>();
      if (rows.length) {
        const res = await supabase.from(TABLE[table]).upsert(rows, { onConflict: "id" });
        if (res.error) {
          if (isNetErr(res.error) || isAuthErr(res.error, res.status)) throw new Error(res.error.message);
          // il server ha rifiutato il gruppo per i dati: si riprova riga per riga, cosi' una sola riga sbagliata non blocca le altre
          for (const r of rows) {
            const one = await supabase.from(TABLE[table]).upsert([r], { onConflict: "id" });
            if (one.error) {
              if (isNetErr(one.error) || isAuthErr(one.error, one.status)) throw new Error(one.error.message);
              failed.set(String(r.id), one.error.message);
            }
          }
        }
      }
      for (const it of chunk) {                                 // tolto dalla coda solo se nel frattempo non e' cambiato di nuovo
        const cur = await d.get("outbox", it.k);
        if (!cur || cur.seq !== it.v.seq) continue;
        const err = failed.get(String(it.v.id));
        if (err) {
          const fails = (cur.fails || 0) + 1;
          if (fails < MAX_FAILS) { await d.put("outbox", { ...cur, fails }, it.k); continue; }   // si riprova al prossimo giro
          console.warn("riga rifiutata dal server, tolta dalla coda", table, it.v.id, err);
          rejected.value = [...rejected.value.slice(-9), err];
        }
        await d.delete("outbox", it.k);
      }
    }
  }
  pendingCount.value = (await d.getAllKeys("outbox")).length;
  void mirror();
}

/** Copia della coda ad Android (in ordine: una chiamata alla volta). */
let mirrorChain: Promise<void> = Promise.resolve();
function mirror(): Promise<void> {
  if (!isAndroid) return Promise.resolve();
  mirrorChain = mirrorChain.then(async () => {
    const d = await getDb();
    const keys = (await d.getAllKeys("outbox")) as string[];
    const ops = [];
    for (const k of keys) {
      const v = await d.get("outbox", k);
      if (!v || (v.table !== "events" && v.table !== "cals")) continue;
      const r = await d.get(v.table, v.id);
      if (!r) continue;
      const row: Record<string, unknown> = {};
      for (const c of COLS[v.table as "events" | "cals"]) if (c !== "user_id") row[c] = r[c] ?? null;
      ops.push({ k, t: v.table, seq: v.seq, row });
    }
    await nativePending(ops);
  }).catch((e) => console.warn("coda Android", e));
  return mirrorChain;
}

/** Quello che Android ha gia' inviato ad app chiusa esce dalla coda (se nel frattempo non e' stato modificato di nuovo). */
async function takeNativeSent() {
  const r = await nativeTakeSent();
  if (!r) return;
  if (r.keyBad) pushKeyBad.value = Date.now();
  const ks = Object.keys(r.sent);
  if (!ks.length) return;
  const d = await getDb();
  for (const k of ks) {
    const cur = await d.get("outbox", k);
    if (cur && Number(cur.seq) === Number(r.sent[k])) await d.delete("outbox", k);
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
    await takeNativeSent();
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

/** Accesso salvato sul dispositivo: l'app si apre subito anche senza rete (il token si rinnova dopo, appena possibile). */
function storedSession(): Session | null {
  try {
    const j = JSON.parse(localStorage.getItem("calendario-auth") || "null");
    return j && j.user && j.user.id && j.refresh_token ? (j as Session) : null;
  } catch {
    return null;
  }
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
  // prima, con il token scaduto e senza rete, l'app restava ferma (e poi sulla schermata d'accesso) finche' non tornava la
  // rete: ora si apre subito con l'accesso salvato e le modifiche finiscono in coda
  const cached = storedSession();
  if (cached) await onSession(cached);
  supabase.auth.onAuthStateChange((ev, s) => {
    if (s) void onSession(s);
    else if (ev === "SIGNED_OUT") void onSession(null);         // uscita vera (o accesso revocato), non la rete assente
  });
  ready.value = true;
  void supabase.auth.getSession().then(({ data }) => {
    if (data.session) void onSession(data.session);
    else if (!cached) void onSession(null);
  });
  void mirror();                                                 // Android riceve la coda attuale (anche dopo un aggiornamento)
  window.addEventListener("online", () => scheduleSync(0));
  window.addEventListener("offline", () => { syncState.value = "offline"; });
  // tornando all'app si sincronizza; uscendo, se ci sono modifiche in attesa si prova a inviarle subito (prima che il
  // telefono chiuda l'app; se non ci riesce, le invia Android da solo quando torna la rete)
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

export async function createDeviceKey(name: string, write = false): Promise<string> {
  const { data, error } = await supabase.rpc("create_device_key", write ? { p_name: name, p_write: true } : { p_name: name });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Chiave per lo script di Gmail: puo' SOLO importare i riposi (non legge e non modifica gli altri eventi). */
export async function createShiftKey(): Promise<string> {
  const { data, error } = await supabase.rpc("create_shift_key");
  if (error) throw new Error(error.message);
  return data as string;
}

/** Abilita alla scrittura la chiave del telefono (per l'invio ad app chiusa). false = chiave non piu' esistente. */
export async function enableDeviceWrite(key: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("enable_device_write", { p_key: key });
  if (error) throw new Error(error.message);
  return !!data;
}
