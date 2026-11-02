// Dispositivi collegati: elenco delle chiavi e scollegamento di quelle non usate (privacy).
const { openApp, checker } = require("./harness.cjs");
module.exports = async function () {
  const c = checker("dispositivi");
  const now = Date.now(), d = (n) => new Date(now - n * 86400000).toISOString();
  const keys = [
    { id: "k1", name: "Trofeo LCD (questo PC)", scope: "full", can_write: false, created_at: d(2), last_used: d(0), key_hash: "a" },
    { id: "k2", name: "Trofeo LCD (questo PC)", scope: "full", can_write: false, created_at: d(3), last_used: null, key_hash: "b" },
    { id: "k3", name: "Widget Android", scope: "full", can_write: true, created_at: d(40), last_used: d(30), key_hash: "c" },
    { id: "k4", name: "Gmail (turni)", scope: "shifts", can_write: true, created_at: d(1), last_used: d(0), key_hash: "e" },
  ];
  const a = await openApp({ port: 8796, db: { keys } });
  const p = a.page;
  try {
    await p.click('button[aria-label="Menu"]'); await p.waitForTimeout(400);
    await p.click("text=Impostazioni"); await p.waitForTimeout(700);
    await p.click('.row.click:has-text("Dispositivi collegati")'); await p.waitForTimeout(900);
    c.check("elenco delle chiavi", await p.locator(".devrow").count(), 4);
    c.check("proposta di scollegare quelle non usate", await p.locator("text=2 mai usati o fermi da più di 14 giorni").count(), 1);
    await p.click('.row.click:has-text("Scollega quelli non usati")'); await p.waitForTimeout(400);
    await p.click('.confirmsheet button:has-text("Scollega")'); await p.waitForTimeout(1200);
    const del = a.db.writes.filter((w) => w.table === "device_keys").flatMap((w) => w.del).sort();
    c.check("scollegate solo quelle non usate", del, ["k2", "k3"]);
    c.check("elenco aggiornato", await p.locator(".devrow").count(), 2);
    c.check("nessun errore", a.errors, []);
  } finally { await a.close(); }
  return c.ok;
};
