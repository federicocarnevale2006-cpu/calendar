import { useState } from "preact/hooks";
import { supabase } from "../store";
import { APK_URL, EXE_URL } from "../config";
import { loginEmail, rememberAccountEmail } from "../account";
import { isAndroid, isTauri } from "../platform";

function itErr(m: string): string {
  const s = m.toLowerCase();
  if (s.includes("invalid login")) return "Email o password sbagliate.";
  if (s.includes("already registered") || s.includes("already been registered")) return "Esiste già un account con questa email: accedi.";
  if (s.includes("password should be") || s.includes("weak")) return "Password troppo corta: almeno 6 caratteri.";
  if (s.includes("valid email") || s.includes("invalid format")) return "Email non valida.";
  if (s.includes("registrazioni chiuse") || s.includes("database error saving new user")) return "Le registrazioni sono chiuse per questo calendario.";
  if (s.includes("rate limit")) return "Troppi tentativi: riprova fra qualche minuto.";
  if (s.includes("fetch") || s.includes("network")) return "Nessuna connessione a internet.";
  return m;
}

export function Login() {
  const mode = "in" as "in" | "up";                       // registrazioni chiuse sul server: solo accesso
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (e: Event) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "up") {
        const { error } = await supabase.auth.signUp({ email: await loginEmail(email), password: pw });
        if (error) throw error;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: await loginEmail(email), password: pw });
      if (error) throw error;
      rememberAccountEmail(email);
    } catch (x: any) {
      setErr(itErr(String(x?.message || x)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="login">
      <form class="box" onSubmit={go}>
        <div class="logo">{new Date().getDate()}</div>
        <h1>{mode === "in" ? "Accedi" : "Crea l'account"}</h1>
        <p>Lo stesso account sul telefono e sul PC: gli eventi si sincronizzano da soli e compaiono anche sullo schermo Trofeo LCD.</p>
        <div class="field"><input class="inp" type="email" autocomplete="email" autoCapitalize="none" spellcheck={false} placeholder="Email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} required /></div>
        <div class="field"><input class="inp" type="password" autocomplete={mode === "in" ? "current-password" : "new-password"} placeholder="Password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} required minLength={6} /></div>
        <div class="err">{err}</div>
        <button class="btn primary" disabled={busy}>{busy ? "Attendi…" : mode === "in" ? "Accedi" : "Crea account"}</button>
        {!isAndroid && !isTauri && (
          <div class="dl">
            <a href={APK_URL}>Scarica l'app per Android</a>
            <a href={EXE_URL}>Scarica l'app per Windows</a>
          </div>
        )}
      </form>
    </div>
  );
}
