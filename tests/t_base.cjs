// L'app si apre, mostra gli eventi del server, crea un evento nuovo e lo manda al server.
const { openApp, checker, ev } = require("./harness.cjs");
module.exports = async function () {
  const c = checker("base");
  const a = await openApp({ port: 8791, db: { events: [ev("e1", "Dentista", 10, "2026-10-02T00:00:00Z")] } });
  try {
    c.check("nessun errore all'avvio", a.errors, []);
    c.check("evento del server in locale", await a.idb((db) => new Promise((r) => { db.transaction("events").objectStore("events").getAllKeys().onsuccess = (e) => r(e.target.result); })), ["e1"]);
    await a.page.click('button[aria-label="Nuovo evento"]');
    await a.page.waitForTimeout(500);
    await a.page.fill('input[placeholder="Titolo"]', "Prova automatica");
    await a.page.click('button:has-text("Salva")');
    await a.page.waitForTimeout(2500);
    const sent = a.db.writes.filter((w) => w.table === "events").map((w) => w.row.title);
    c.check("evento nuovo inviato al server", sent.includes("Prova automatica"), true);
    c.check("nessun errore durante l'uso", a.errors, []);
  } finally { await a.close(); }
  return c.ok;
};
