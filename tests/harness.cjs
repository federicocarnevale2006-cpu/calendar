// Ambiente di prova: l'app compilata (dist) servita in locale, con un Supabase finto (nessun dato vero, niente rete).
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const DIST = path.join(__dirname, "..", "dist");
const SUPA = "https://ittsmkvywqnoqyugfckh.supabase.co";
const UID = "11111111-1111-4111-8111-111111111111";
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };

function staticServer(port) {
  return new Promise((ok) => {
    const srv = http.createServer((q, r) => {
      let p = path.join(DIST, decodeURIComponent(q.url.split("?")[0]));
      if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, "index.html");
      r.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
      r.end(fs.readFileSync(p));
    }).listen(port, () => ok(srv));
  });
}

const ev = (id, title, day, upd, extra = {}) => ({ id, user_id: UID, calendar_id: "c1", title, all_day: true, start_at: `2026-11-${String(day).padStart(2, "0")}T00:00:00Z`,
  end_at: `2026-11-${String(day).padStart(2, "0")}T00:00:00Z`, tz: "Europe/Rome", location: "", notes: "", color: null, rrule: null, exdates: [], reminders: [],
  deleted: false, created_at: upd, updated_at: upd, source: null, ...extra });

/** Apre l'app con un utente gia' collegato. `db` e' il "server": calendari, eventi, impostazioni e le richieste ricevute. */
async function openApp({ port = 8790, viewport = { width: 420, height: 860 }, db, loggedIn = true } = {}) {
  const srv = await staticServer(port);
  const session = { access_token: "tok", refresh_token: "ref", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: UID, aud: "authenticated", role: "authenticated", email: "prova@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" } };
  db = db || {};
  db.cals = db.cals || [{ id: "c1", user_id: UID, name: "Personale", color: "#3b82f6", visible: true, sort: 0, deleted: false, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }];
  db.events = db.events || [];
  db.prefs = db.prefs === undefined ? null : db.prefs;
  db.writes = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport });
  if (loggedIn) await ctx.addInitScript((s) => { if (!localStorage.getItem("calendario-auth")) localStorage.setItem("calendario-auth", JSON.stringify(s)); }, session);
  db.password = db.password || "vecchia-password-123";
  db.auth = [];
  await ctx.route(SUPA + "/**", async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    if (u.pathname.startsWith("/auth/v1/user")) {
      if (m === "PUT") { const b = JSON.parse(req.postData() || "{}"); db.auth.push({ what: "update", ...b }); if (b.password) db.password = b.password; }
      return route.fulfill({ json: session.user });
    }
    if (u.pathname.startsWith("/auth/v1/token")) {
      if (u.searchParams.get("grant_type") === "password") {
        const b = JSON.parse(req.postData() || "{}");
        db.auth.push({ what: "login", email: b.email });
        if (b.password !== db.password) return route.fulfill({ status: 400, json: { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" } });
        session.user.email = b.email;
      }
      return route.fulfill({ json: session });
    }
    if (u.pathname.startsWith("/auth/v1/logout")) { db.auth.push({ what: "logout", scope: u.searchParams.get("scope") }); return route.fulfill({ status: 204, body: "" }); }
    const t = u.pathname.startsWith("/rest/v1/calendars") ? "cals" : u.pathname.startsWith("/rest/v1/events") ? "events" : null;
    if (t) {
      if (m === "GET") {
        const gt = (u.searchParams.get("updated_at") || "gt.1970-01-01").slice(3);
        return route.fulfill({ json: db[t].filter((r) => r.updated_at > gt).sort((a, b) => a.updated_at.localeCompare(b.updated_at)) });
      }
      const body = JSON.parse(req.postData() || "[]");
      const rows = Array.isArray(body) ? body : [body];
      for (const r of rows) {
        db.writes.push({ table: t, row: r });
        const i = db[t].findIndex((x) => x.id === r.id);
        const row = { ...(i >= 0 ? db[t][i] : {}), ...r, updated_at: new Date().toISOString() };
        if (i >= 0) db[t][i] = row; else db[t].push(row);
      }
      return route.fulfill({ status: 201, json: rows });
    }
    if (u.pathname.startsWith("/rest/v1/user_settings")) {
      if (m !== "GET") { const b = JSON.parse(req.postData() || "{}"); db.writes.push({ table: "user_settings", row: b }); const { user_id, updated_at, ...rest } = b; db.prefs = { ...(db.prefs || {}), ...rest }; return route.fulfill({ status: 201, json: [] }); }
      if ((req.headers()["accept"] || "").includes("vnd.pgrst.object")) return db.prefs ? route.fulfill({ json: db.prefs }) : route.fulfill({ status: 406, json: { code: "PGRST116", message: "0 rows" } });
      return route.fulfill({ json: db.prefs ? [db.prefs] : [] });
    }
    if (u.pathname.startsWith("/rest/v1/device_keys")) {
      db.keys = db.keys || [];
      if (m === "DELETE") {
        const ids = ((u.searchParams.get("id") || "").match(/in\.\((.*)\)/) || [, ""])[1].split(",").map((x) => x.replace(/"/g, "")).filter(Boolean);
        db.writes.push({ table: "device_keys", del: ids });
        db.keys = db.keys.filter((k) => !ids.includes(k.id));
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fulfill({ json: db.keys });
    }
    if (u.pathname.startsWith("/rest/v1/rpc/create_shift_key")) return route.fulfill({ json: "tl_chiave_di_prova" });
    if (u.pathname.startsWith("/rest/v1/rpc")) return route.fulfill({ json: null });
    return route.fulfill({ json: [] });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(2500);
  const idb = (fn, arg) => page.evaluate(([src, a]) => new Promise((res) => {
    const rq = indexedDB.open("calendario");
    rq.onsuccess = () => { const db = rq.result; Promise.resolve((0, eval)(src)(db, a)).then((v) => { db.close(); res(v); }); };
  }), [fn.toString(), arg]);
  const close = async () => { await browser.close(); srv.close(); };
  return { page, ctx, db, errors, idb, close, ev };
}

/** Piccolo registro dei risultati: stampa OK/ERR e alla fine dice se e' andato tutto bene. */
function checker(name) {
  let ok = true;
  return {
    check(what, got, want) {
      const g = JSON.stringify(got) === JSON.stringify(want);
      ok &&= g;
      console.log(`${g ? "OK " : "ERR"} [${name}] ${what}: ${JSON.stringify(got)}${g ? "" : "  (atteso " + JSON.stringify(want) + ")"}`);
    },
    get ok() { return ok; },
  };
}

module.exports = { openApp, checker, ev, UID };
