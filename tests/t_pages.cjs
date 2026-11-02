// Le pagine caricate a parte (impostazioni, calendari, Trofeo LCD, turni dalla mail) si aprono senza errori.
const { openApp, checker } = require("./harness.cjs");
module.exports = async function () {
  const c = checker("pagine");
  const a = await openApp({ port: 8794 });
  const p = a.page;
  const back = async () => { await p.locator('.page button[aria-label="Indietro"]').last().click(); await p.waitForTimeout(400); };
  try {
    await p.click('button[aria-label="Menu"]'); await p.waitForTimeout(400);
    await p.click("text=Impostazioni"); await p.waitForTimeout(800);
    c.check("impostazioni", await p.locator("text=La settimana inizia di").count(), 1);
    for (const [row, inside] of [["Trofeo LCD", "Collega"], ["Turni dalla mail", "Copia lo script"], ["Calendari", "Personale"]]) {
      await p.click(`.row.click:has-text("${row}")`); await p.waitForTimeout(700);
      c.check(`pagina «${row}»`, (await p.locator(`text=${inside}`).count()) > 0, true);
      await back();
    }
    c.check("nessun errore", a.errors, []);
  } finally { await a.close(); }
  return c.ok;
};
