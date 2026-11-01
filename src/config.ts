// Progetto Supabase «calendario». La chiave pubblicabile e' fatta per stare nelle app: i dati sono protetti dal login
// e dalle regole del database (ogni account vede solo i propri eventi).
export const SUPABASE_URL = "https://ittsmkvywqnoqyugfckh.supabase.co";
export const SUPABASE_KEY = "sb_publishable_XGU1Aw_MuNkJV67cp1wLoQ_FATnQfLJ";
const ENV = (import.meta as any).env || {};
export const APP_VERSION: string = ENV.VITE_APP_VERSION || "1.0.0";
export const APP_BUILD: number = Number(ENV.VITE_BUILD || 0);   // numero della compilazione (GitHub): serve a sapere se c'e' una versione piu' nuova
// sito con la versione web e i file da scaricare (APK per Android, installazione per Windows)
export const SITE = "https://federicocarnevale2006-cpu.github.io/calendar/";
// i file da scaricare stanno nelle Release di GitHub (funzionano anche se il sito non e' attivo)
const REL = "https://github.com/federicocarnevale2006-cpu/calendar/releases/latest/download/";
export const APK_URL = REL + "Calendario.apk";
export const EXE_URL = REL + "Calendario.exe";           // un solo file, senza installazione (come Trofeo LCD)
// numero dell'ultima versione pubblicata (file scritto dalla compilazione)
export const VERSION_URL = "https://raw.githubusercontent.com/federicocarnevale2006-cpu/calendar/gh-pages/version.json";
// stesso file .exe della Release, ma da un indirizzo che l'app per PC puo' scaricare da sola (aggiornamento automatico)
export const EXE_RAW_URL = "https://raw.githubusercontent.com/federicocarnevale2006-cpu/calendar/gh-pages/download/Calendario.exe";

export const PALETTE = [
  "#3b82f6", "#0ea5e9", "#14b8a6", "#22c55e", "#84cc16", "#eab308",
  "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#6366f1", "#64748b",
];
