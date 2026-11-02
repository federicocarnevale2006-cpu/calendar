// Account staccato dalla Gmail: accesso con nome utente, cambio password con controllo, uscita dagli altri dispositivi.
const { openApp, checker } = require("./harness.cjs");
module.exports = async function () {
  const c = checker("account");
  const a = await openApp({ port: 8797, loggedIn: false });
  const p = a.page;
  try {
    c.check("niente «Crea l'account» (registrazioni chiuse)", await p.locator("text=Crea l'account").count(), 0);
    await p.fill('input[placeholder="Nome utente"]', "Federico ");
    await p.fill('input[type="password"]', "vecchia-password-123");
    await p.click('button:has-text("Accedi")'); await p.waitForTimeout(2500);
    c.check("il nome utente diventa l'indirizzo che non riceve mail", a.db.auth.filter((x) => x.what === "login").map((x) => x.email), ["federico@calendario.invalid"]);
    await p.click('button[aria-label="Menu"]'); await p.waitForTimeout(400);
    await p.click("text=Impostazioni"); await p.waitForTimeout(800);
    c.check("in impostazioni si vede il nome utente", await p.locator(".lab:text-is(\"federico\")").count(), 1);
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
