// Account staccato dalla posta: si accede con l'email, ma sul server l'account ha un indirizzo interno che non riceve mail
// (impronta dell'email su calendario.invalid). Cambio password con controllo, uscita dagli altri dispositivi.
const crypto = require("crypto");
const { openApp, checker } = require("./harness.cjs");
module.exports = async function () {
  const c = checker("account");
  const a = await openApp({ port: 8797, loggedIn: false });
  const p = a.page;
  try {
    c.check("niente «Crea l'account» (registrazioni chiuse)", await p.locator("text=Crea l'account").count(), 0);
    await p.fill('input[placeholder="Email"]', "Mario.Rossi@Esempio.it ");
    await p.fill('input[type="password"]', "vecchia-password-123");
    await p.click('button:has-text("Accedi")'); await p.waitForTimeout(2500);
    const atteso = crypto.createHash("sha256").update("mario.rossi@esempio.it").digest("hex").slice(0, 32) + "@calendario.invalid";
    c.check("l'email diventa l'indirizzo interno che non riceve mail", a.db.auth.filter((x) => x.what === "login").map((x) => x.email), [atteso]);
    c.check("l'email vera non arriva al server", JSON.stringify(a.db.auth).includes("esempio.it"), false);
    await p.click('button[aria-label="Menu"]'); await p.waitForTimeout(400);
    await p.click("text=Impostazioni"); await p.waitForTimeout(800);
    c.check("in impostazioni si vede l'email usata per entrare", await p.locator(".lab:text-is(\"mario.rossi@esempio.it\")").count(), 1);
    await p.click('.row.click:has-text("Cambia password")'); await p.waitForTimeout(600);
    const pw = p.locator('.page input[type="password"]');
    await pw.nth(0).fill("sbagliata"); await pw.nth(1).fill("una-password-nuova-lunga"); await pw.nth(2).fill("una-password-nuova-lunga");
    await p.click('button.btn.primary:has-text("Cambia password")'); await p.waitForTimeout(1200);
    c.check("password attuale sbagliata: niente cambio", a.db.auth.some((x) => x.what === "update"), false);
    c.check("avviso password attuale", await p.locator("text=La password attuale non è giusta.").count(), 1);
    await pw.nth(0).fill("vecchia-password-123");
    await p.click('button.btn.primary:has-text("Cambia password")'); await p.waitForTimeout(1500);
    c.check("password cambiata", a.db.password, "una-password-nuova-lunga");
    await p.click('.row.click:has-text("Esci da tutti gli altri dispositivi")'); await p.waitForTimeout(400);
    await p.click('.confirmsheet button:has-text("Esci dagli altri")'); await p.waitForTimeout(1200);
    c.check("uscita dagli altri dispositivi", a.db.auth.filter((x) => x.what === "logout").map((x) => x.scope), ["others"]);
    c.check("nessun errore", a.errors, []);
  } finally { await a.close(); }
  return c.ok;
};
