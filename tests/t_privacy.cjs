// Privacy: nel codice pubblicato (sito, app) non c'e' l'indirizzo dei turni; l'utente lo scrive nell'app e finisce solo nel suo account.
const fs = require("fs"), path = require("path");
const { openApp, checker } = require("./harness.cjs");
module.exports = async function () {
  const c = checker("privacy");
  // nessun indirizzo email di aziende nel codice compilato (solo esempi)
  const dist = path.join(__dirname, "..", "dist", "assets");
  let trovati = [];
  for (const f of fs.readdirSync(dist).filter((f) => f.endsWith(".js"))) {
    const t = fs.readFileSync(path.join(dist, f), "utf8");
    for (const m of t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(?:com|it|net|org|eu)\b/g)) {
      if (!/(example\.com|esempio\.it|azienda\.com|supabase|sentry|w3\.org)/i.test(m[0])) trovati.push(m[0]);
    }
  }
  c.check("nessun indirizzo email nel codice pubblicato", [...new Set(trovati)], []);
  const a = await openApp({ port: 8795 });
  const p = a.page;
  try {
    await p.click('button[aria-label="Menu"]'); await p.waitForTimeout(400);
    await p.click("text=Impostazioni"); await p.waitForTimeout(700);
    await p.click('.row.click:has-text("Turni dalla mail")'); await p.waitForTimeout(700);
    const btn = p.locator('button:has-text("Copia lo script")');
    c.check("senza indirizzo lo script non si copia", await btn.isDisabled(), true);
    await p.fill('input[type="email"]', "turni@prova-azienda.it");
    await p.locator('input[type="email"]').blur(); await p.waitForTimeout(500);
    await btn.click(); await p.waitForTimeout(1200);
    const script = await p.locator("textarea.inp.code").inputValue();
    c.check("lo script usa l'indirizzo scritto", script.includes('const MITTENTE = "turni@prova-azienda.it";'), true);
    c.check("indirizzo salvato nel proprio account", a.db.prefs && a.db.prefs.shift_sender, "turni@prova-azienda.it");
    c.check("nessun errore", a.errors, []);
  } finally { await a.close(); }
  return c.ok;
};
