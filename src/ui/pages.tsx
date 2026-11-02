// Pagine aperte di rado (impostazioni, calendari, Trofeo LCD, turni dalla mail): caricate solo quando servono.
import { useEffect, useRef, useState } from "preact/hooks";
import { tick } from "./drag";
import { hm, MONTHS_SHORT, parseYmd } from "../date";
import { uuid, type Cal } from "../model";
import { APK_URL, APP_VERSION, EXE_URL, PALETTE, SUPABASE_KEY, SUPABASE_URL } from "../config";
import {
  cals, createDeviceKey, createShiftKey, deleteEvent, events, lastSync, pendingCount, saveCal, session, setSettings,
  settings, signOut, supabase, syncError, syncState, scheduleSync, visibleCals, setMultiMark, type MultiMark,
} from "../store";
import { autostart, autoUpdatePC, isAndroid, isTauri, nativePushStatus, openUrl, pcUpdate, readTrofeoLink, restartApp, update, writeTrofeoLink, type PushStatus } from "../platform";
import { pop, push, showToast, closeAll } from "./state";
import { Icon } from "./icons";
import { GMAIL_MANIFEST, gmailScript, SENDER_RE } from "../gmailScript";
import { accountName } from "../account";

import { Choice, Page, Switch, remLabel } from "./common";

// ------------------------------------------------------------------------------------------------------ calendari
export function Calendars({ add: addNow }: { add?: boolean }) {
  useEffect(() => { if (addNow) push({ t: "calEdit", id: null }); }, []);
  const menu = (c: Cal) => {
    void tick("cal" + c.id);
    push({ t: "choice", title: c.name, value: "", danger: ["delete"], options: [["edit", "Modifica"], ["delete", "Elimina"]],
      onPick: (v) => { if (v === "edit") push({ t: "calEdit", id: c.id }); else askDeleteCal(c); } });
  };
  return (
    <Page title="Calendari" dialog actions={<button class="iconbtn" aria-label="Aggiungi calendario" onClick={() => push({ t: "calEdit", id: null })}><Icon n="plus" /></button>}>
      <div class="card">
        {visibleCals.value.map((c) => <CalRow key={c.id} c={c} onMenu={() => menu(c)} />)}
      </div>
      <button class="btn" style={{ width: "100%", marginBottom: "12px" }} onClick={() => push({ t: "calEdit", id: null })}>+ Nuovo calendario</button>
      <div class="note">Tieni premuto un calendario (sul PC: tasto destro) per modificarlo o eliminarlo. Con l'interruttore nascondi un calendario senza cancellarne gli eventi.</div>
    </Page>
  );
}

/** Riga di un calendario: tenendo premuto (o col tasto destro) si apre il menu Modifica / Elimina; un tocco apre la modifica. */
function CalRow({ c, onMenu }: { c: Cal; onMenu: () => void }) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(0);
  const clear = () => { if (t.current) { clearTimeout(t.current); t.current = null; } start.current = null; };
  const open = () => { if (Date.now() - fired.current < 700) return; fired.current = Date.now(); clear(); onMenu(); };
  return (
    <div class="row calrow" onContextMenu={(e) => { e.preventDefault(); open(); }}
      onPointerDown={(e) => { if (e.button !== 0) return; start.current = { x: e.clientX, y: e.clientY }; t.current = setTimeout(open, 450); }}
      onPointerMove={(e) => { const s0 = start.current; if (s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 10) clear(); }}
      onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear}>
      <span class="cdot" style={{ background: c.color, width: "18px", height: "18px" }} />
      <button type="button" class="grow lab calname" onClick={() => { if (Date.now() - fired.current > 700) push({ t: "calEdit", id: c.id }); }}>{c.name}</button>
      <Switch on={c.visible} label="Visibile" onChange={(v) => void saveCal({ ...c, visible: v })} />
    </div>
  );
}

function askDeleteCal(c: Cal) {
  if (visibleCals.value.length <= 1) { showToast("Serve almeno un calendario: creane un altro prima di eliminare questo"); return; }
  const n = events.value.filter((e) => e.calendar_id === c.id).length;
  push({ t: "confirm", title: `Eliminare «${c.name}»?`, ok: "Elimina", danger: true,
    text: n ? `Verranno eliminati anche i suoi ${n === 1 ? "1 evento" : `${n} eventi`}, su tutti i dispositivi.` : "Il calendario è vuoto.",
    onOk: () => {
      void saveCal({ ...c, deleted: true });
      for (const e of events.value) if (e.calendar_id === c.id) void deleteEvent(e.id);
      if (settings.value.defaultCal === c.id) setSettings({ defaultCal: null });
      showToast(`«${c.name}» eliminato`);
    } });
}

/** Modifica (o creazione) di un calendario: nome, colore, posizione nell'elenco. */
export function CalEditSheet({ id }: { id: string | null }) {
  const orig = id ? cals.value.find((x) => x.id === id) : undefined;
  const used = new Set(cals.value.filter((x) => !x.deleted).map((x) => x.color));
  const [name, setName] = useState(orig?.name ?? "");
  const [color, setColor] = useState(orig?.color ?? (PALETTE.find((p) => !used.has(p)) ?? PALETTE[(cals.value.length * 3) % PALETTE.length]));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!orig) setTimeout(() => ref.current?.focus(), 200); }, []);
  const list = visibleCals.value;
  const idx = orig ? list.findIndex((x) => x.id === orig.id) : -1;
  const move = (dir: number) => {
    if (!orig) return;
    const i = list.findIndex((x) => x.id === orig.id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const order = list.map((x) => x.id);
    [order[i], order[j]] = [order[j], order[i]];
    order.forEach((cid, k) => { const x = list.find((y) => y.id === cid)!; if (x.sort !== k) void saveCal({ ...x, sort: k }); });
  };
  const save = () => {
    const nm = name.trim();
    if (!nm) { ref.current?.focus(); return; }
    if (orig) void saveCal({ ...(cals.value.find((x) => x.id === orig.id) ?? orig), name: nm, color });
    else {
      const sort = Math.max(-1, ...cals.value.filter((x) => !x.deleted).map((x) => x.sort)) + 1;
      void saveCal({ id: uuid(), name: nm, color, visible: true, sort, deleted: false });
      showToast(`Calendario «${nm}» creato`);
    }
    pop();
  };
  if (id && !orig) { setTimeout(pop, 0); return null; }
  return (
    <>
      <div class="scrim top" onClick={pop} />
      <div class="sheet calsheet" role="dialog" aria-label={orig ? "Modifica calendario" : "Nuovo calendario"}>
        <div class="grip" />
        <div class="chtitle">{orig ? "Modifica calendario" : "Nuovo calendario"}</div>
        <div class="row"><span class="cdot" style={{ background: color, width: "22px", height: "22px" }} />
          <input ref={ref} class="inp bigtitle grow" placeholder="Nome del calendario" value={name} maxLength={80}
            onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} /></div>
        <div class="palette">
          {PALETTE.map((p) => <button aria-label={p} class={color === p ? "on" : ""} style={{ background: p, color: p }} onClick={() => setColor(p)}>{color === p && <Icon n="check" s />}</button>)}
          <label class={"custom" + (!PALETTE.includes(color) ? " on" : "")} title="Colore a scelta" style={{ color }}>
            <input type="color" value={color} onInput={(e) => setColor((e.target as HTMLInputElement).value.toLowerCase())} />
            {!PALETTE.includes(color) ? <Icon n="check" s /> : <Icon n="palette" s />}
          </label>
        </div>
        {orig && list.length > 1 && (
          <div class="row"><div class="grow lab">Posizione nell'elenco</div>
            <button class="iconbtn" aria-label="Sposta su" disabled={idx <= 0} onClick={() => move(-1)}><Icon n="left" style={{ transform: "rotate(90deg)" }} /></button>
            <button class="iconbtn" aria-label="Sposta giù" disabled={idx >= list.length - 1} onClick={() => move(1)}><Icon n="right" style={{ transform: "rotate(90deg)" }} /></button>
          </div>
        )}
        <div class="rembtns">
          {orig && <button class="btn danger" onClick={() => { pop(); askDeleteCal(orig); }}>Elimina</button>}
          <span class="grow" />
          <button class="btn" onClick={pop}>Annulla</button>
          <button class="btn primary" disabled={!name.trim()} onClick={save}>{orig ? "Salva" : "Crea"}</button>
        </div>
      </div>
    </>
  );
}

/** Conferma nello stile dell'app (al posto della finestra di sistema). */
// ------------------------------------------------------------------------------------------------- Trofeo LCD
export function TrofeoPage() {
  const [code, setCode] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { void readTrofeoLink().then(setLinked); }, []);
  const linkHere = async () => {
    setBusy(true); setErr("");
    try {
      const key = await createDeviceKey("Trofeo LCD (questo PC)");
      const path = await writeTrofeoLink(JSON.stringify({ url: SUPABASE_URL, anon: SUPABASE_KEY, key, email: session.value?.user.email ?? "", created: new Date().toISOString() }));
      setLinked(path);
      showToast("Trofeo LCD collegato");
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  const makeCode = async () => {
    setBusy(true); setErr("");
    try { setCode(await createDeviceKey("Trofeo LCD (codice)")); } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  return (
    <Page title="Trofeo LCD" dialog>
      <div class="card">
        <div class="row"><Icon n="monitor" /><div class="grow"><div class="lab">Widget Calendario sullo schermo</div><div class="val">Pallini sui giorni con eventi, evento in corso e prossimi eventi</div></div></div>
        <div class="note">Trofeo LCD legge gli eventi in sola lettura, con una chiave che vale solo per questo account. {isTauri ? "Sul PC dove c'e' Trofeo LCD il collegamento e' automatico." : "Sul PC basta installare anche l'app Calendario: si collega da sola. Altrimenti genera un codice e incollalo in Trofeo LCD (Impostazioni → Calendario)."}</div>
      </div>
      {isTauri && (
        <div class="card">
          <div class="row"><div class="grow"><div class="lab">{linked ? "Collegato su questo PC" : "Non ancora collegato"}</div>{linked && <div class="val">{linked}</div>}</div>
            <button class="btn primary" disabled={busy} onClick={linkHere}>{linked ? "Ricollega" : "Collega"}</button></div>
        </div>
      )}
      <div class="card">
        <div class="row"><div class="grow"><div class="lab">Codice per Trofeo LCD</div><div class="val">Da incollare a mano, se serve</div></div><button class="btn" disabled={busy} onClick={makeCode}>Genera</button></div>
        {code && <><div class="code">{code}</div><div style={{ textAlign: "right", padding: "0 14px 10px" }}><button class="btn text" onClick={() => { void navigator.clipboard?.writeText(code); showToast("Codice copiato"); }}>Copia</button></div></>}
      </div>
      {err && <div class="note" style={{ color: "var(--danger)" }}>{err}</div>}
    </Page>
  );
}

// --------------------------------------------------------------------------------------------- turni dalla mail
interface ShiftImport { at: string; rest: number; days: number; added: number; removed: number; range_from: string | null; range_to: string | null }
export function ShiftsPage() {
  const [rem, setRemV] = useState<number | null>(() => {
    try { const v = localStorage.getItem("shift-rem"); return v === null ? 1440 : v === "" ? null : Number(v); } catch { return 1440; }
  });
  const setRem = (v: number | null) => { setRemV(v); try { localStorage.setItem("shift-rem", v == null ? "" : String(v)); } catch { /* */ } };
  const [script, setScript] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // indirizzo che manda i turni: scritto qui dall'utente, salvato nel suo account (non nel codice dell'app, che e' pubblico)
  const [sender, setSenderV] = useState<string>(() => { try { return localStorage.getItem("shift-sender") || ""; } catch { return ""; } });
  const senderOk = SENDER_RE.test(sender.trim());
  const keepSender = (v: string) => { try { if (v) localStorage.setItem("shift-sender", v); else localStorage.removeItem("shift-sender"); } catch { /* */ } };
  const saveSender = async (v: string) => {
    const uid = session.value?.user.id;
    if (!uid || !SENDER_RE.test(v)) return;
    await supabase.from("user_settings").upsert({ user_id: uid, shift_sender: v, updated_at: new Date().toISOString() });
  };
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("user_settings").select("shift_sender").maybeSingle();
      const v = (data as { shift_sender?: string | null } | null)?.shift_sender;
      if (v) { setSenderV(v); keepSender(v); }
    })();
  }, []);
  const [err, setErr] = useState("");
  const [log, setLog] = useState<ShiftImport[] | null>(null);
  const loadLog = async () => {
    const { data, error } = await supabase.from("shift_imports").select("at,rest,days,added,removed,range_from,range_to").order("at", { ascending: false }).limit(3);
    setLog(error ? [] : (data as ShiftImport[]));
  };
  useEffect(() => { void loadLog(); const iv = setInterval(() => void loadLog(), 20000); return () => clearInterval(iv); }, []);
  const prepare = async () => {
    const snd = sender.trim();
    if (!SENDER_RE.test(snd)) { setErr("Scrivi prima l'indirizzo che ti manda i turni (punto 1)."); return; }
    setBusy(true); setErr("");
    try {
      await saveSender(snd);
      const key = await createShiftKey();
      const txt = gmailScript(key, snd, rem == null ? -99999 : rem);
      setScript(txt);
      await copyText(txt);
      showToast("Script copiato: incollalo in Google Apps Script");
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  const copyManifest = async () => { await copyText(GMAIL_MANIFEST); showToast("Impostazioni copiate: incollale in appsscript.json"); };
  const fmt = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} alle ${hm(d)}`; };
  const day = (s: string | null) => { if (!s) return ""; const d = parseYmd(s); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
  return (
    <Page title="Turni dalla mail" dialog>
      <div class="card">
        <div class="row"><Icon n="notes" /><div class="grow"><div class="lab">Giorni di riposo automatici</div>
          <div class="val">Quando arriva la mail dei turni, i riposi finiscono da soli nel calendario «Turni». A fine mese si cancellano da soli.</div></div></div>
        <div class="row"><Icon n="person" /><div class="grow"><div class="lab">Indirizzo che ti manda i turni</div>
          <input class="inp" type="email" inputMode="email" autoComplete="off" spellcheck={false} placeholder="es. turni@azienda.com" value={sender}
            style={{ marginTop: "6px", width: "100%" }}
            onInput={(e) => { setSenderV((e.target as HTMLInputElement).value); setScript(null); }}
            onBlur={() => { const v = sender.trim(); keepSender(v); void saveSender(v); }} />
          <div class="val">{sender && !senderOk ? "Indirizzo non valido" : "Salvato solo nel tuo account: non è scritto nel codice dell'app."}</div></div></div>
        <button type="button" class="row click" onClick={() => push({ t: "rem", allDay: true, value: rem, none: true, onPick: (v) => { setRem(v); setScript(null); } })}>
          <Icon n="bell" /><div class="grow"><div class="lab">Promemoria per i riposi</div><div class="val">{rem == null ? "Nessuno" : remLabel(rem, true)}</div></div><Icon n="right" />
        </button>
      </div>
      <div class="card">
        <div class="row"><div class="grow"><div class="lab">Ultime importazioni</div>
          {log === null ? <div class="val">…</div> : !log.length ? <div class="val">Nessuna finora</div> : log.map((l) => (
            <div class="val">{fmt(l.at)} · {l.rest === 1 ? "1 riposo" : `${l.rest} riposi`}{l.range_from ? ` (${day(l.range_from)} – ${day(l.range_to)})` : ""}{l.added || l.removed ? ` · ${l.added} aggiunti, ${l.removed} tolti` : ""}</div>
          ))}</div></div>
      </div>
      <div class="card privacy">
        <div class="row"><Icon n="person" /><div class="grow"><div class="lab">Privacy</div></div></div>
        <ul>
          <li>Lo script gira <b>solo nel tuo account Google</b>: nessun altro legge la tua posta.</li>
          <li>Ha il permesso di Gmail in <b>sola lettura</b> e cerca solo le mail del mittente dei turni: non può scrivere, inviare o cancellare mail.</li>
          <li>L'indirizzo dei turni è salvato <b>solo nel tuo account</b>, non nel codice dell'app (che è pubblico).</li>
          <li>Al calendario arrivano <b>solo le date dei riposi</b>: niente testo, oggetto, nomi o orari della mail.</li>
          <li>La chiave dello script può <b>solo aggiungere riposi</b>: non legge e non modifica gli altri eventi.</li>
          <li>Il calendario sta sul tuo spazio Supabase in Europa (Francoforte), con connessione cifrata, visibile solo dal tuo account.</li>
        </ul>
      </div>
      <div class="card steps">
        <div class="lab" style={{ padding: "12px 14px 4px" }}>Da fare una volta sola (meglio dal PC)</div>
        <ol>
          <li><b>Hai già lo script della versione prima?</b> Toglili il permesso completo su Gmail: apri la pagina dei collegamenti di Google, scegli «Progetto senza titolo» (o il nome che gli hai dato) e rimuovi l'accesso. Poi continua nello stesso progetto.
            <div><button class="btn" onClick={() => void openUrl("https://myaccount.google.com/connections")}>Apri collegamenti Google</button></div></li>
          <li><b>Copia lo script</b> e incollalo in Google Apps Script al posto di tutto il testo (file «Codice.gs»), poi salva.
            <div class="btnrow"><button class="btn primary" disabled={busy || !senderOk} onClick={prepare}>{script ? "Copia di nuovo" : "Copia lo script"}</button>
              <button class="btn" onClick={() => void openUrl("https://script.google.com/home")}>Apri script.google.com</button></div></li>
          <li><b>Gmail in sola lettura</b>: in Apps Script apri «Impostazioni progetto» (ingranaggio a sinistra) e spunta «Mostra il file manifest "appsscript.json" nell'editor». Torna all'editor, apri <b>appsscript.json</b>, cancella tutto, incolla le impostazioni e salva.
            <div><button class="btn" onClick={copyManifest}>Copia le impostazioni</button></div></li>
          <li><b>Attiva</b>: in alto scegli la funzione <b>installa</b> e premi <b>Esegui</b>. Google chiede il permesso («Avanzate» → «Vai al progetto» → «Consenti»): deve dire <b>«Visualizzare i tuoi messaggi email»</b>. Se chiede di leggere, inviare ed eliminare le mail, le impostazioni del punto 3 non sono state salvate.</li>
          <li>Nel registro compare «Fatto»: da ora le mail dei turni vengono controllate <b>ogni 10 minuti</b>.</li>
        </ol>
        {script && <textarea class="inp code" readOnly rows={5} value={script} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />}
        <div class="note">Se cambi il promemoria, copia di nuovo lo script e sostituiscilo nel progetto.</div>
      </div>
      {err && <div class="note" style={{ color: "var(--danger)" }}>{err}</div>}
    </Page>
  );
}

// ---------------------------------------------------------------------------------------- dispositivi collegati
interface DevKey { id: string; name: string; scope: string; can_write: boolean; created_at: string; last_used: string | null; key_hash: string }
async function sha256hex(t: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** Le chiavi dei dispositivi (Trofeo LCD, widget del telefono, script della mail): si vede quando sono state usate l'ultima
 * volta e si possono scollegare. Una chiave scollegata smette subito di funzionare. */
export function DevicesPage() {
  const [keys, setKeys] = useState<DevKey[] | null>(null);
  const [mine, setMine] = useState("");
  const [err, setErr] = useState("");
  const load = async () => {
    const { data, error } = await supabase.from("device_keys").select("id,name,scope,can_write,created_at,last_used,key_hash").order("created_at", { ascending: false });
    if (error) { setErr(error.message); setKeys([]); return; }
    setKeys(data as DevKey[]);
  };
  useEffect(() => {
    void load();
    const uid = session.value?.user.id;
    let k = "";
    try { k = uid ? localStorage.getItem("widget-key-" + uid) || "" : ""; } catch { /* */ }
    if (k) void sha256hex(k).then(setMine);
  }, []);
  const DAY = 86400000;
  const idle = (k: DevKey) => !k.last_used ? Date.now() - new Date(k.created_at).getTime() > DAY : Date.now() - new Date(k.last_used).getTime() > 14 * DAY;
  const fmt = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; };
  const remove = async (ids: string[]) => {
    const { error } = await supabase.from("device_keys").delete().in("id", ids);
    if (error) { setErr(error.message); return; }
    showToast(ids.length === 1 ? "Dispositivo scollegato" : `${ids.length} dispositivi scollegati`);
    void load();
  };
  const ask = (k: DevKey) => push({ t: "confirm", title: `Scollegare «${k.name}»?`, danger: true, ok: "Scollega",
    text: k.key_hash === mine ? "È la chiave di questo telefono: widget e invio ad app chiusa si fermano finché l'app non ne crea una nuova (succede da sola alla prossima apertura con la rete)."
      : k.scope === "shifts" ? "Se è la chiave dello script in uso, la mail dei turni smette di arrivare finché non copi di nuovo lo script."
      : "Smette subito di funzionare. Se è il Trofeo LCD in uso, va ricollegato dalla pagina Trofeo LCD.",
    onOk: () => void remove([k.id]) });
  const old = (keys || []).filter((k) => idle(k) && k.key_hash !== mine);
  return (
    <Page title="Dispositivi collegati" dialog>
      <div class="note">Ogni dispositivo che legge il calendario senza il tuo accesso (Trofeo LCD, widget del telefono, script della mail) ha una chiave tutta sua. Se uno non lo usi più, scollegalo: la sua chiave smette subito di funzionare.</div>
      {old.length > 0 && <div class="card"><button class="row click" onClick={() => push({ t: "confirm", title: `Scollegare ${old.length} ${old.length === 1 ? "dispositivo" : "dispositivi"}?`, danger: true, ok: "Scollega",
        text: "Quelli mai usati o fermi da più di 14 giorni. Quelli in uso restano collegati.", onOk: () => void remove(old.map((k) => k.id)) })}>
        <Icon n="close" /><div class="grow"><div class="lab">Scollega quelli non usati</div><div class="val">{old.length} mai usati o fermi da più di 14 giorni</div></div></button></div>}
      <div class="card">
        {keys === null ? <div class="row"><div class="val">…</div></div> : !keys.length ? <div class="row"><div class="val">Nessun dispositivo collegato</div></div> : keys.map((k) => (
          <div class="row devrow">
            <Icon n={k.scope === "shifts" ? "notes" : k.name.includes("Trofeo") ? "monitor" : "cal"} />
            <div class="grow"><div class="lab">{k.name}{k.key_hash === mine ? " · questo telefono" : ""}</div>
              <div class="val">{k.scope === "shifts" ? "Solo aggiunge i riposi" : k.can_write ? "Legge e scrive" : "Solo lettura"} · creato il {fmt(k.created_at)} · {k.last_used ? `ultimo uso ${fmt(k.last_used)}` : "mai usato"}</div></div>
            <button class="btn" onClick={() => ask(k)}>Scollega</button>
          </div>
        ))}
      </div>
      {err && <div class="note" style={{ color: "var(--danger)" }}>{err}</div>}
    </Page>
  );
}

// -------------------------------------------------------------------------------------------- cambio password
/** Cambio della password: prima si controlla quella attuale (chi trovasse il telefono sbloccato non puo' cambiarla). */
export function PasswordPage() {
  const [cur, setCur] = useState(""), [nw, setNw] = useState(""), [rep, setRep] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const tooShort = nw.length > 0 && nw.length < 12, mismatch = rep.length > 0 && rep !== nw;
  const ok = cur.length > 0 && nw.length >= 12 && nw === rep && nw !== cur;
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const email = session.value?.user.email || "";
      const chk = await supabase.auth.signInWithPassword({ email, password: cur });
      if (chk.error) { setErr(chk.error.message.toLowerCase().includes("invalid") ? "La password attuale non è giusta." : chk.error.message); return; }
      const { error } = await supabase.auth.updateUser({ password: nw });
      if (error) { setErr(error.message.toLowerCase().includes("same") ? "La nuova password è uguale a quella di prima." : error.message); return; }
      pop();
      showToast("Password cambiata");
    } finally { setBusy(false); }
  };
  return (
    <Page title="Cambia password" dialog>
      <div class="note">Usa una password lunga (almeno 12 caratteri) che non usi da nessun'altra parte: il calendario non manda mail per recuperarla, quindi è l'unica chiave per entrare. Se la dimentichi, si reimposta dal pannello di Supabase.</div>
      <div class="card">
        <div class="row"><div class="grow"><div class="lab">Password attuale</div>
          <input class="inp" type="password" autoComplete="current-password" value={cur} style={{ marginTop: "6px", width: "100%" }} onInput={(e) => setCur((e.target as HTMLInputElement).value)} /></div></div>
        <div class="row"><div class="grow"><div class="lab">Nuova password</div>
          <input class="inp" type="password" autoComplete="new-password" value={nw} style={{ marginTop: "6px", width: "100%" }} onInput={(e) => setNw((e.target as HTMLInputElement).value)} />
          <div class="val">{tooShort ? `Ancora ${12 - nw.length} caratteri` : "Almeno 12 caratteri"}</div></div></div>
        <div class="row"><div class="grow"><div class="lab">Ripeti la nuova password</div>
          <input class="inp" type="password" autoComplete="new-password" value={rep} style={{ marginTop: "6px", width: "100%" }} onInput={(e) => setRep((e.target as HTMLInputElement).value)} />
          {mismatch && <div class="val" style={{ color: "var(--danger)" }}>Non coincide</div>}</div></div>
      </div>
      <div style={{ padding: "0 16px" }}><button class="btn primary" style={{ width: "100%" }} disabled={!ok || busy} onClick={save}>{busy ? "Attendi…" : "Cambia password"}</button></div>
      {err && <div class="note" style={{ color: "var(--danger)" }}>{err}</div>}
    </Page>
  );
}

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return; } catch { /* sotto: metodo vecchio */ }
  const ta = document.createElement("textarea");
  ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } finally { ta.remove(); }
}

// -------------------------------------------------------------------------------------------------- impostazioni
/** Android: stato dell'invio delle modifiche ad app chiusa (per capire subito se qualcosa non va). */
function PushStatusRow() {
  const [st, setSt] = useState<PushStatus | null>(null);
  const load = () => void nativePushStatus().then(setSt);
  useEffect(() => { load(); const iv = setInterval(load, 3000); return () => clearInterval(iv); }, []);
  if (!st) return null;
  const at = (t?: number) => (t ? new Date(t).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const n = st.pending || 0;
  let txt: string;
  if (!st.hasKey) txt = "Non ancora attivo: apri l'app con la rete una volta";
  else if (st.sched && st.sched !== "ok" && st.sched2 !== "ok") txt = `Problema: ${st.sched}`;
  else if (n) txt = `${n === 1 ? "1 modifica" : `${n} modifiche`} in attesa: partono da sole appena c'è rete${st.run ? ` · ultimo tentativo ${at(st.run_t)}: ${st.run}` : ""}`;
  else if (st.ok_t) txt = `Attivo · ultimo invio ad app chiusa: ${at(st.ok_t)}`;
  else txt = "Attivo: le modifiche fatte senza rete partono da sole quando torna, anche ad app chiusa";
  return (
    <div class="card">
      <div class="row"><Icon n="sync" /><div class="grow"><div class="lab">Invio ad app chiusa</div><div class="val">{txt}</div></div></div>
    </div>
  );
}

/** PC: stato dell'aggiornamento automatico (tocca per controllare subito o per riavviare con la versione nuova). */
function PcUpdateRow() {
  const u = pcUpdate.value;
  const txt = !u ? `Versione ${APP_VERSION} · si aggiorna da sola (tocca per controllare ora)`
    : u.state === "download" ? `Scaricamento della versione ${u.version}…`
    : u.state === "ready" ? `Versione ${u.version} installata: tocca per riavviare`
    : `Versione ${u.version}: non riuscito, si riprova fra poco (tocca per riprovare)`;
  const go = () => {
    if (u?.state === "ready") { void restartApp(); return; }
    if (u?.state === "download") return;
    void autoUpdatePC().then((st) => {
      if (st === "none") showToast(`Hai già l'ultima versione (${APP_VERSION})`);
      else if (st === "ready" && pcUpdate.value) showToast(`Versione ${pcUpdate.value.version} installata`, { label: "Riavvia", run: () => void restartApp() });
    }).catch((e) => showToast(`Aggiornamento non riuscito: ${String(e?.message || e)}`));
  };
  return (
    <div class="card">
      <button class="row click" onClick={go}><Icon n="sync" /><div class="grow"><div class="lab">Aggiornamenti automatici</div><div class="val">{txt}</div></div>{u?.state === "ready" && <Icon n="right" />}</button>
    </div>
  );
}

// ---- widget: piu' eventi nello stesso giorno (scelta uguale su telefono e PC) ----------------------------------
export const MULTI_LABEL: Record<MultiMark, [string, string]> = {
  split: ["Cerchio diviso", "Il cerchio si divide nei colori degli eventi (fino a 3)"],
  badge: ["Pallino in alto", "Pallino del secondo evento; con 3 o più eventi diventa «+2», «+3»"],
  dots: ["Puntini sotto", "Un puntino per ogni altro evento sotto il cerchio"],
};
const MR = "#ef4444", MB = "#3b82f6", MG = "#22c55e";
function slicePath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos((a - 90) * Math.PI / 180), cy + r * Math.sin((a - 90) * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${cx} ${cy}L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`;
}
/** Disegnino di come appare il widget: un giorno con 2 eventi e uno con 3. */
export function MultiPreview({ mode }: { mode: MultiMark }) {
  const day = (cx: number, n: number, cols: string[]) => {
    const cy = 20, r = 13;
    const parts: any[] = [];
    if (mode === "split") {
      const k = Math.min(3, cols.length), step = 360 / k, off = k === 2 ? 45 : 0;
      for (let i = 0; i < k; i++) parts.push(<path d={slicePath(cx, cy, r, off + i * step, off + (i + 1) * step)} fill={cols[i]} />);
      for (let i = 0; i < k; i++) {
        const a = (off + i * step - 90) * Math.PI / 180;
        parts.push(<line x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="var(--surface)" stroke-width="1.4" />);
      }
    } else {
      parts.push(<circle cx={cx} cy={cy} r={r} fill={cols[0]} />);
      if (mode === "badge" && cols.length === 2) {
        parts.push(<circle cx={cx + r * 0.72} cy={cy - r * 0.72} r={6.4} fill="var(--surface)" />, <circle cx={cx + r * 0.72} cy={cy - r * 0.72} r={4.6} fill={cols[1]} />);
      } else if (mode === "badge") {
        const bx = cx + r * 0.8, by = cy - r * 0.78;
        parts.push(<rect x={bx - 9.5} y={by - 6.6} width={19} height={13.2} rx={6.6} fill="var(--surface)" />,
          <rect x={bx - 8} y={by - 5.2} width={16} height={10.4} rx={5.2} fill="#f5f5f7" />,
          <text x={bx} y={by + 3.3} text-anchor="middle" font-size="8.5" font-weight="800" fill="#18181b">+{cols.length - 1}</text>);
      } else {
        const ex = cols.slice(1);
        ex.forEach((c, i) => parts.push(<circle cx={cx + (i - (ex.length - 1) / 2) * 7} cy={cy + r + 5.5} r={2.6} fill={c} />));
      }
    }
    parts.push(<text x={cx} y={cy + 4.6} text-anchor="middle" font-size="13" font-weight="800" fill="#fff">{n}</text>);
    return parts;
  };
  return (
    <svg class="mmprev" viewBox="0 0 96 44" width="96" height="44" aria-hidden="true">
      {day(24, 4, [MR, MB])}{day(70, 5, [MR, MB, MG])}
    </svg>
  );
}
export function MultiMarkSheet() {
  const cur = settings.value.multiMark;
  return (
    <>
      <div class="scrim top" onClick={pop} />
      <div class="sheet choicesheet mmsheet" role="dialog" aria-label="Più eventi nello stesso giorno">
        <div class="grip" />
        <div class="chtitle">Più eventi nello stesso giorno</div>
        <div class="mmnote">Nei widget del telefono e di Trofeo LCD, quando i giorni sono cerchi colorati. Vale per tutti i tuoi dispositivi.</div>
        <div class="chlist">
          {(["badge", "split", "dots"] as const).map((m) => (
            <button type="button" class={"chopt mmopt" + (m === cur ? " on" : "")} onClick={() => { pop(); if (m !== cur) setMultiMark(m); }}>
              <MultiPreview mode={m} />
              <span class="grow"><span class="mmlab">{MULTI_LABEL[m][0]}</span><span class="mmdesc">{MULTI_LABEL[m][1]}</span></span>
              {m === cur && <Icon n="check" />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function SettingsPage() {
  const st = settings.value;
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => { if (isTauri) void autostart().then(setAuto); }, []);
  const ss = syncState.value;
  return (
    <Page title="Impostazioni" dialog>
      <div class="card">
        <div class="row"><Icon n="person" /><div class="grow"><div class="lab">{accountName(session.value?.user.email)}</div>
          <div class="val"><span class={"status " + ss}><i />{ss === "ok" ? `Sincronizzato ${lastSync.value ? hm(new Date(lastSync.value)) : ""}` : ss === "sync" ? "Sincronizzazione…" : ss === "offline" ? "Senza rete: le modifiche partono appena torna" : `Errore: ${syncError.value}`}{pendingCount.value ? ` · ${pendingCount.value} da inviare` : ""}</span></div></div>
          <button class="iconbtn" aria-label="Sincronizza ora" onClick={() => scheduleSync(0)}><Icon n="sync" /></button>
        </div>
        <button class="row click" onClick={() => push({ t: "trofeo" })}><Icon n="monitor" /><div class="grow"><div class="lab">Trofeo LCD</div><div class="val">Eventi sul widget Calendario</div></div><Icon n="right" /></button>
        <button class="row click" onClick={() => push({ t: "shifts" })}><Icon n="notes" /><div class="grow"><div class="lab">Turni dalla mail</div><div class="val">Giorni di riposo inseriti da soli dalla mail dei turni</div></div><Icon n="right" /></button>
        <button class="row click" onClick={() => push({ t: "calendars" })}><Icon n="folder" /><div class="grow"><div class="lab">Calendari</div><div class="val">{visibleCals.value.map((c) => c.name).join(", ")}</div></div><Icon n="right" /></button>
        <button class="row click" onClick={() => push({ t: "devices" })}><Icon n="monitor" /><div class="grow"><div class="lab">Dispositivi collegati</div><div class="val">Chi può leggere o scrivere il calendario senza il tuo accesso</div></div><Icon n="right" /></button>
      </div>
      <div class="card">
        <div class="row"><Icon n="cal" /><div class="grow lab">La settimana inizia di</div>
          <div class="seg"><button class={st.weekStart === 1 ? "on" : ""} onClick={() => setSettings({ weekStart: 1 })}>Lunedì</button><button class={st.weekStart === 0 ? "on" : ""} onClick={() => setSettings({ weekStart: 0 })}>Domenica</button></div></div>
        <div class="row"><Icon n="list" /><div class="grow lab">Numeri delle settimane</div><Switch on={st.weekNumbers} onChange={(v) => setSettings({ weekNumbers: v })} /></div>
        <div class="row"><Icon n="cal" /><div class="grow"><div class="lab">Festività italiane</div><div class="val">Capodanno, Pasqua, 25 aprile, Natale… in rosso</div></div><Switch on={st.holidays} onChange={(v) => setSettings({ holidays: v })} /></div>
        <button class="row click" onClick={() => push({ t: "multimark" })}><Icon n="cal" /><div class="grow"><div class="lab">Widget: più eventi in un giorno</div>
          <div class="val">{MULTI_LABEL[st.multiMark][0]} · telefono e Trofeo LCD</div></div><Icon n="right" /></button>
        <div class="row"><Icon n="sun" /><div class="grow lab">Tema</div>
          <div class="seg">{(["system", "light", "dark"] as const).map((t) => <button class={st.theme === t ? "on" : ""} onClick={() => setSettings({ theme: t })}>{t === "system" ? "Auto" : t === "light" ? "Chiaro" : "Scuro"}</button>)}</div></div>
      </div>
      <div class="card">
        <div class="row"><Icon n="folder" /><div class="grow lab">Calendario predefinito</div>
          <Choice cls="setval" title="Calendario predefinito" value={st.defaultCal || ""} onPick={(v) => setSettings({ defaultCal: v || null })}
            options={[["", "Il primo"], ...visibleCals.value.map((c): [string, string] => [c.id, c.name])]} /></div>
        <div class="row"><Icon n="bell" /><div class="grow lab">Promemoria predefinito</div>
          <button type="button" class="setval choice" onClick={() => push({ t: "rem", allDay: false, value: st.defaultReminder, none: true, onPick: (v) => setSettings({ defaultReminder: v }) })}>
            {st.defaultReminder == null ? "Nessuno" : remLabel(st.defaultReminder, false)}<span class="chev">▾</span></button></div>
        <div class="row"><Icon n="clock" /><div class="grow lab">Durata predefinita</div>
          <Choice cls="setval" title="Durata predefinita" value={String(st.defaultDuration)} onPick={(v) => setSettings({ defaultDuration: parseInt(v) })}
            options={[15, 30, 45, 60, 90, 120, 180, 240].map((m): [string, string] => [String(m), m < 60 ? `${m} minuti` : m === 60 ? "1 ora" : m % 60 ? `${Math.floor(m / 60)} ${m < 120 ? "ora" : "ore"} e ${m % 60} min` : `${m / 60} ore`])} /></div>
        {isTauri && auto !== null && <div class="row"><Icon n="monitor" /><div class="grow"><div class="lab">Avvia con Windows</div><div class="val">Nell'area di notifica, per i promemoria</div></div><Switch on={auto} onChange={(v) => void autostart(v).then(setAuto)} /></div>}
      </div>
      {isTauri && <PcUpdateRow />}
      {isAndroid && <PushStatusRow />}
      {update.value && (
        <div class="card">
          <button class="row click" onClick={() => void openUrl(update.value!.url)}><Icon n="sync" /><div class="grow"><div class="lab">Aggiornamento disponibile</div><div class="val">Versione {update.value.version}: tocca per scaricarla e installarla</div></div><Icon n="right" /></button>
        </div>
      )}
      {!isAndroid && !isTauri && (
        <div class="card">
          <button class="row click" onClick={() => void openUrl(APK_URL)}><Icon n="cal" /><div class="grow"><div class="lab">App per Android</div><div class="val">Scarica e installa l'APK sul telefono</div></div><Icon n="right" /></button>
          <button class="row click" onClick={() => void openUrl(EXE_URL)}><Icon n="monitor" /><div class="grow"><div class="lab">App per Windows</div><div class="val">Promemoria anche a finestra chiusa e collegamento automatico a Trofeo LCD</div></div><Icon n="right" /></button>
        </div>
      )}
      <div class="card">
        <button class="row click" onClick={() => push({ t: "password" })}><Icon n="person" /><div class="grow"><div class="lab">Cambia password</div><div class="val">Unica e lunga: è l'unico modo per entrare nel calendario</div></div><Icon n="right" /></button>
        <button class="row click" onClick={() => push({ t: "confirm", title: "Uscire da tutti gli altri dispositivi?", danger: true, ok: "Esci dagli altri",
          text: "Resti dentro solo qui. Il telefono, il PC o il sito dove sei collegato dovranno rientrare con nome utente e password. I widget e Trofeo LCD non si fermano (usano le loro chiavi, che trovi in Dispositivi collegati).",
          onOk: () => void supabase.auth.signOut({ scope: "others" }).then(({ error }) => showToast(error ? "Non riuscito: " + error.message : "Uscito da tutti gli altri dispositivi")) })}>
          <Icon n="logout" /><div class="grow"><div class="lab">Esci da tutti gli altri dispositivi</div><div class="val">Se pensi che qualcuno sia entrato con la tua password</div></div></button>
        <button class="row click" onClick={() => push({ t: "confirm", title: "Uscire dall'account?", text: "Gli eventi restano salvati online: rientrando li ritrovi.", ok: "Esci", danger: true, onOk: () => { closeAll(); void signOut(); } })}><Icon n="logout" /><div class="grow lab">Esci dall'account</div></button>
      </div>
      <div class="note" style={{ textAlign: "center" }}>Calendario {APP_VERSION}{isAndroid ? " · Android" : isTauri ? " · Windows" : ""}</div>
    </Page>
  );
}
