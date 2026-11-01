// Script per Google (Apps Script) da incollare una volta in script.google.com: gira nell'account Gmail dell'utente,
// ogni 10 minuti legge le mail dei turni e manda al calendario i giorni di riposo (funzione import_shifts del server).
// Il testo e' "raw" (String.raw): le barre delle espressioni regolari restano come sono.
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

export const SHIFT_SENDER = "turni@azienda.com";

const TEMPLATE = String.raw`// Calendario · turni dalla mail
// Ogni 10 minuti cerca le mail dei turni e mette nel calendario i giorni di riposo, con un promemoria.
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
  var msgs = [];
  GmailApp.search("from:" + MITTENTE + " newer_than:120d", 0, 40).forEach(function (t) {
    t.getMessages().forEach(function (m) { msgs.push(m); });
  });
  msgs.sort(function (a, b) { return a.getDate() - b.getDate(); });   // dalla piu' vecchia: vince l'ultima mail
  var n = 0;
  msgs.forEach(function (m) {
    var id = m.getId();
    if (fatte.indexOf(id) >= 0) return;
    if (String(m.getFrom()).toLowerCase().indexOf(MITTENTE.toLowerCase()) < 0) return;
    var giorni = leggiTurni(m.getBody(), m.getPlainBody());
    if (!giorni.length) { fatte.push(id); return; }                     // mail senza la tabella dei turni
    var r = UrlFetchApp.fetch(SERVER, {
      method: "post", contentType: "application/json", headers: { apikey: APIKEY }, muteHttpExceptions: true,
      payload: JSON.stringify({ p_key: CHIAVE, p_days: giorni, p_reminder: PROMEMORIA, p_msg: id, p_subject: m.getSubject() })
    });
    if (r.getResponseCode() !== 200) {                                  // si riprova al prossimo giro
      Logger.log("Non riuscito (" + r.getResponseCode() + "): " + r.getContentText());
      return;
    }
    Logger.log(m.getSubject() + ": " + r.getContentText());
    fatte.push(id);
    n++;
  });
  props.setProperty("fatte", JSON.stringify(fatte.slice(-300)));
  return n;
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

/** Lo script completo, con la chiave del dispositivo e il promemoria scelto (minuti prima delle 9:00 del giorno). */
export function gmailScript(key: string, reminder = 1440): string {
  return TEMPLATE.replace("__CHIAVE__", key)
    .replace("__MITTENTE__", SHIFT_SENDER)
    .replace("__SERVER__", SUPABASE_URL)
    .replace("__APIKEY__", SUPABASE_KEY)
    .replace("__PROMEMORIA__", String(Math.round(reminder)));
}
