// Account del calendario staccato dalla posta: si accede con un nome utente, che dietro le quinte diventa un indirizzo su
// «calendario.invalid». Quel dominio e' riservato e non esiste: nessuno puo' ricevere li' link di accesso o di cambio
// password. Cosi' anche chi entrasse nella tua Gmail non potrebbe entrare nel calendario. Si entra solo con la password.
export const ACCOUNT_DOMAIN = "calendario.invalid";

/** «federico» → «federico@calendario.invalid»; un indirizzo completo resta com'e' (vecchi account). */
export function loginEmail(u: string): string {
  const t = u.trim().toLowerCase();
  return t.includes("@") ? t : `${t}@${ACCOUNT_DOMAIN}`;
}

/** Nome da mostrare: per gli account con nome utente solo il nome, altrimenti l'indirizzo. */
export function accountName(email: string | undefined | null): string {
  const e = email || "";
  return e.endsWith("@" + ACCOUNT_DOMAIN) ? e.slice(0, -ACCOUNT_DOMAIN.length - 1) : e;
}
