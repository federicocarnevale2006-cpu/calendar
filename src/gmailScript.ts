// Script per Google (Apps Script) da incollare una volta in script.google.com: gira nell'account Gmail dell'utente,
// ogni 10 minuti legge le mail dei turni e manda al calendario i giorni di riposo (funzione import_shifts del server).
// Il testo e' "raw" (String.raw): le barre delle espressioni regolari restano come sono.
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

// L'indirizzo che manda i turni non sta nel codice (che e' pubblico): lo scrive l'utente nell'app e resta nel suo account.
export const SENDER_RE = /^[^\s"'\\<>@]+@[^\s"'\\<>@]+\.[^\s"'\\<>@]+$/;

const TEMPLATE = String.raw`// Calendario · turni dalla mail (versione con Gmail in SOLA LETTURA)
// Ogni 10 minuti cerca le mail dei turni e mette nel calendario i giorni di riposo, con un promemoria.
// Privacy: lo script gira solo nel tuo account Google. Legge solo le mail del mittente dei turni (permesso di sola
// lettura: non puo' scrivere, inviare o cancellare mail) e al calendario manda SOLO le date dei giorni di riposo:
// niente testo della mail, oggetto, nomi o orari.
// Per attivarlo: qui sopra scegli la funzione «installa» e premi ▶ Esegui (la prima volta Google chiede il permesso).

const CHIAVE = "__CHIAVE__";
const MITTENTE = "__MITTENTE__";
const SERVER = "__SERVER__/rest/v1/rpc/import_shifts";
const APIKEY = "__APIKEY__";
const PROMEMORIA = __PROMEMORIA__;   // minuti prima delle 9:00 del giorno di riposo (1440 = il giorno prima alle 9:00)

function installa() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "controllaTurni") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("controllaTurni").timeBased().everyMinutes(10).create();
  var n = controllaTurni();
  Logger.log("Fatto: le mail dei turni vengono controllate ogni 10 minuti. Mail lette adesso: " + n);
}

function controllaTurni() {
  var props = PropertiesService.getScriptProperties();
  var fatte = JSON.parse(props.getProperty("fatte") || "[]");
  var elenco = Gmail.Users.Messages.list("me", { q: "from:" + MITTENTE + " newer_than:120d", maxResults: 40 });
  var msgs = (elenco.messages || [])
    .filter(function (m) { return fatte.indexOf(m.id) < 0; })
    .map(function (m) { return Gmail.Users.Messages.get("me", m.id, { format: "full" }); });
  msgs.sort(function (a, b) { return Number(a.internalDate) - Number(b.internalDate); });   // dalla piu' vecchia: vince l'ultima
  var n = 0;
  msgs.forEach(function (m) {
    if (intestazione(m, "From").toLowerCase().indexOf(MITTENTE.toLowerCase()) < 0) { fatte.push(m.id); return; }
    var corpo = testoMail(m.payload);
    var giorni = leggiTurni(corpo.html, corpo.text).map(function (g) { return { date: g.date, rest: g.rest }; });
    if (!giorni.length) { fatte.push(m.id); return; }                   // mail senza la tabella dei turni
    var r = UrlFetchApp.fetch(SERVER, {
      method: "post", contentType: "application/json", headers: { apikey: APIKEY }, muteHttpExceptions: true,
      payload: JSON.stringify({ p_key: CHIAVE, p_days: giorni, p_reminder: PROMEMORIA })
    });
    if (r.getResponseCode() !== 200) {                                  // si riprova al prossimo giro
      Logger.log("Non riuscito (" + r.getResponseCode() + "): " + r.getContentText());
      return;
    }
    Logger.log("Turni letti: " + r.getContentText());
    fatte.push(m.id);
    n++;
  });
  props.setProperty("fatte", JSON.stringify(fatte.slice(-300)));
  return n;
}

function intestazione(m, nome) {
  var h = (m.payload && m.payload.headers) || [];
  for (var i = 0; i < h.length; i++) if (String(h[i].name).toLowerCase() === nome.toLowerCase()) return String(h[i].value || "");
  return "";
}

// testo della mail (parti HTML e testo semplice)
function testoMail(p) {
  var out = { html: "", text: "" };
  (function giro(x) {
    if (!x) return;
    var tipo = String(x.mimeType || "").toLowerCase();
    if (x.body && x.body.data && (tipo === "text/html" || tipo === "text/plain")) {
      var d = x.body.data;
      var b = typeof d === "string" ? Utilities.newBlob(Utilities.base64DecodeWebSafe(d)) : Utilities.newBlob(d);
      var s = b.getDataAsString("UTF-8");
      if (tipo === "text/html") out.html += s; else out.text += s;
    }
    (x.parts || []).forEach(giro);
  })(p);
  return out;
}

// Righe della tabella: «Mon 02/11/2026 B&M Riposo», «Tue 03/11/2026 B&M 14:00-18:00 09:30-13:30»
function leggiTurni(html, testo) {
  html = String(html || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ");
  // prima riga per riga della tabella (una riga = un giorno: il testo dopo la tabella non si mescola)
  var out = [], visti = {};
  html.split(/<tr[\s>]/i).forEach(function (pezzo) {
    righe(senzaTag(pezzo.split(/<\/tr>/i)[0])).forEach(function (g) {
      if (!visti[g.date]) { visti[g.date] = 1; out.push(g); }
    });
  });
  if (!out.length) out = righe(senzaTag(html));                         // niente tabella: tutto il testo
  if (!out.length) out = righe(String(testo || ""));
  return out;
}

function senzaTag(h) {
  return String(h)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th|tr|p|div|li|table|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, function (_, c) { return String.fromCharCode(+c); });
}

function righe(t) {
  t = t.replace(/[ \t\r\f\v ]+/g, " ");
  var re = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g, pos = [], m;
  while ((m = re.exec(t))) pos.push({ i: m.index, end: re.lastIndex, d: +m[1], mo: +m[2], y: +m[3] });
  var out = [], visti = {};
  for (var k = 0; k < pos.length; k++) {
    var p = pos[k];
    if (p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31 || p.y < 2020 || p.y > 2100) continue;
    var seg = t.slice(p.end, k + 1 < pos.length ? pos[k + 1].i : t.length).slice(0, 160);
    var orario = seg.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
    var ir = seg.search(/riposo/i);
    var riposo = ir >= 0 && (!orario || ir < orario.index);             // «Riposo» al posto dell'orario del turno
    if (!riposo && !orario) continue;                                   // non e' una riga dei turni (es. data della mail)
    var data = p.y + "-" + (p.mo < 10 ? "0" : "") + p.mo + "-" + (p.d < 10 ? "0" : "") + p.d;
    if (visti[data]) continue;
    visti[data] = 1;
    out.push({ date: data, rest: riposo, shift: orario ? orario[1] + "-" + orario[2] : null });
  }
  return out;
}
`;

/** Impostazioni del progetto (appsscript.json): Gmail in SOLA LETTURA e nient'altro. */
export const GMAIL_MANIFEST = JSON.stringify({
  timeZone: "Europe/Rome",
  runtimeVersion: "V8",
  exceptionLogging: "STACKDRIVER",
  dependencies: { enabledAdvancedServices: [{ userSymbol: "Gmail", serviceId: "gmail", version: "v1" }] },
  oauthScopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp",
  ],
}, null, 2);

/** Lo script completo, con la chiave del dispositivo, l'indirizzo dei turni e il promemoria (minuti prima delle 9:00 del giorno). */
export function gmailScript(key: string, sender: string, reminder = 1440): string {
  if (!SENDER_RE.test(sender)) throw new Error("Indirizzo dei turni non valido");
  return TEMPLATE.replace("__CHIAVE__", key)
    .replace("__MITTENTE__", sender)
    .replace("__SERVER__", SUPABASE_URL)
    .replace("__APIKEY__", SUPABASE_KEY)
    .replace("__PROMEMORIA__", String(Math.round(reminder)));
}
