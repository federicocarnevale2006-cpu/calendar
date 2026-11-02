// Pagine aperte di rado (impostazioni, calendari, Trofeo LCD, turni): stanno in un file a parte che si carica solo quando
// serve, cosi' all'avvio l'app ha meno codice da leggere. Qualche secondo dopo l'avvio si carica comunque in anticipo
// (senza fretta): quando le apri sono gia' pronte.
import { useEffect, useState } from "preact/hooks";

type PagesMod = typeof import("./pages");
let mod: PagesMod | null = null;
let loading: Promise<PagesMod> | null = null;

export function loadPages(): Promise<PagesMod> {
  if (!loading) loading = import("./pages").then((m) => (mod = m)).catch((e) => { loading = null; throw e; });
  return loading;
}

export function LazyPage({ name, props }: { name: "SettingsPage" | "Calendars" | "TrofeoPage" | "MultiMarkSheet" | "CalEditSheet" | "ShiftsPage"; props?: Record<string, unknown> }) {
  const [m, setM] = useState<PagesMod | null>(mod);
  useEffect(() => { if (!m) void loadPages().then(setM).catch(() => { /* senza rete o file mancante: si riprova alla prossima apertura */ }); }, []);
  if (!m) return null;
  const C = m[name] as (p: any) => any;
  return <C {...(props || {})} />;
}
