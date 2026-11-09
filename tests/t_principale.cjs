// «Evento principale del giorno»: l'interruttore nell'evento, e il valore (sempre vero/falso) arriva al server.
const { openApp, checker } = require("./harness.cjs");
module.exports = async function () {
  const c = checker("evento principale");
  const a = await openApp({ port: 8794, db: { events: [] } });
  try {
    for (const [titolo, principale] of [["Senza scelta", false], ["Con scelta", true]]) {
      await a.page.click('button[aria-label="Nuovo evento"]');
      await a.page.waitForTimeout(500);
      await a.page.fill('input[placeholder="Titolo"]', titolo);
      if (principale) {
        await a.page.click('button:has-text("Dettagli")');
        await a.page.waitForTimeout(500);
        await a.page.click('[aria-label="Evento principale del giorno"]');
      }
      await a.page.click('button:has-text("Salva")');
      await a.page.waitForTimeout(2500);
    }
    const rows = a.db.writes.filter((w) => w.table === "events").map((w) => [w.row.title, w.row.main]);
    c.check("senza scelta: falso (mai vuoto)", rows.find((r) => r[0] === "Senza scelta")?.[1], false);
    c.check("con scelta: vero", rows.find((r) => r[0] === "Con scelta")?.[1], true);
    c.check("nessun errore", a.errors, []);
  } finally { await a.close(); }
  return c.ok;
};
