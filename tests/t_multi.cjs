// Impostazione dei widget «piu' eventi in un giorno»: scelta, salvata sul server, arriva dagli altri dispositivi.
const { openApp, checker } = require("./harness.cjs");
module.exports = async function () {
  const c = checker("widget piu' eventi");
  const a = await openApp({ port: 8793 });
  const st = () => a.page.evaluate(() => JSON.parse(localStorage.getItem("calendario-settings") || "{}"));
  try {
    c.check("predefinito", (await st()).multiMark || "badge", "badge");
    await a.page.click('button[aria-label="Menu"]'); await a.page.waitForTimeout(400);
    await a.page.click("text=Impostazioni"); await a.page.waitForTimeout(800);
    await a.page.click("text=Widget: più eventi in un giorno"); await a.page.waitForTimeout(600);
    c.check("tre scelte con anteprima", await a.page.locator(".mmopt svg.mmprev").count(), 3);
    await a.page.click('.mmopt:has-text("Cerchio diviso")'); await a.page.waitForTimeout(1500);
    c.check("scelta salvata", (await st()).multiMark, "split");
    c.check("inviata al server", a.db.prefs && a.db.prefs.multi_mark, "split");
    a.db.prefs = { multi_mark: "dots" };
    await a.page.reload(); await a.page.waitForTimeout(2500);
    c.check("scelta di un altro dispositivo", (await st()).multiMark, "dots");
    c.check("nessun errore", a.errors, []);
  } finally { await a.close(); }
  return c.ok;
};
