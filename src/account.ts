// Accesso con la propria email, ma l'account del calendario NON e' legato alla casella di posta: l'app trasforma l'email
// in un indirizzo interno su «calendario.invalid» (dominio riservato, che non esiste: li' non arriva nessuna mail).
// Cosi' nessuno puo' farsi mandare un link di accesso o di cambio password, nemmeno chi entrasse nella tua Gmail:
// si entra solo con la password. L'indirizzo interno e' l'impronta (SHA-256) dell'email: dall'indirizzo interno
// l'email non si ricava, e l'email vera non viene mai salvata sul server.
export const ACCOUNT_DOMAIN = "calendario.invalid";

async function sha256hex(t: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Email scritta nella schermata di accesso → indirizzo interno dell'account. */
export async function loginEmail(u: string): Promise<string> {
  const t = u.trim().toLowerCase();
  if (!t.includes("@")) return `${t}@${ACCOUNT_DOMAIN}`;             // vecchio nome utente
  if (t.endsWith("@" + ACCOUNT_DOMAIN)) return t;
  return `${(await sha256hex(t)).slice(0, 32)}@${ACCOUNT_DOMAIN}`;
}

/** Nome da mostrare nelle impostazioni: l'email con cui hai fatto l'accesso su questo dispositivo. */
export function accountName(email: string | undefined | null): string {
  try {
    const shown = localStorage.getItem("account-email");
    if (shown) return shown;
  } catch { /* */ }
  const e = email || "";
  if (/^[0-9a-f]{32}@calendario\.invalid$/.test(e)) return "Il tuo account";
  return e.endsWith("@" + ACCOUNT_DOMAIN) ? e.slice(0, -ACCOUNT_DOMAIN.length - 1) : e;
}

export function rememberAccountEmail(typed: string) {
  try { localStorage.setItem("account-email", typed.trim().toLowerCase()); } catch { /* */ }
}
