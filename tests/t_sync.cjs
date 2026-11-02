// Pulizia del database: un dispositivo fermo da piu' di 25 giorni rilegge tutto e toglie gli eventi spariti dal server.
const { openApp, checker, ev } = require("./harness.cjs");
module.exports = async function () {
  const c = checker("sincronizzazione");
  const a = await openApp({ port: 8792, db: { events: [ev("e1", "Resta", 10, "2026-10-02T00:00:00Z"), ev("e2", "Cancellato per sempre", 11, "2026-10-03T00:00:00Z")] } });
  const keys = () => a.idb((db) => new Promise((r) => { db.transaction("events").objectStore("events").getAllKeys().onsuccess = (e) => r(e.target.result.sort()); }));
  const setOk = (ms) => a.idb((db, v) => new Promise((r) => { const tx = db.transaction("meta", "readwrite"); tx.objectStore("meta").put(v, "pulled_ok"); tx.oncomplete = () => r(); }), ms);
  try {
    c.check("primo avvio", await keys(), ["e1", "e2"]);
    a.db.events = a.db.events.filter((e) => e.id !== "e2");
    await a.page.reload(); await a.page.waitForTimeout(2500);
    c.check("aggiornato da poco: lettura normale", await keys(), ["e1", "e2"]);
    await setOk(Date.now() - 30 * 86400000);
    await a.page.reload(); await a.page.waitForTimeout(2500);
    c.check("fermo da 30 giorni: rilegge tutto", await keys(), ["e1"]);
  } finally { await a.close(); }
  return c.ok;
};
