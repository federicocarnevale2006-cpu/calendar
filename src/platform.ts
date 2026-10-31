// Differenze fra telefono (Capacitor, Android) e PC (Tauri, Windows). Nel browser semplice tutto questo non fa niente.
import { Capacitor } from "@capacitor/core";
import { signal } from "@preact/signals";
import { APK_URL, APP_BUILD, EXE_URL, SITE } from "./config";
import { addDays, hm } from "./date";
import type { Occ } from "./model";

export const isAndroid = Capacitor.getPlatform() === "android";
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000;
}

export interface Reminder { id: number; at: Date; title: string; body: string }

export function remindersFor(occs: Occ[], now: Date): Reminder[] {
  const out: Reminder[] = [];
  for (const o of occs) {
    for (const m of o.ev.reminders || []) {
      const start = o.allDay ? new Date(o.start.getFullYear(), o.start.getMonth(), o.start.getDate(), 9, 0) : o.start;
      const at = new Date(start.getTime() - m * 60000);
      if (at <= now) continue;
      const when = o.allDay ? "Tutto il giorno" : m === 0 ? `Adesso · ${hm(o.start)}` : `${hm(o.start)} (fra ${m >= 60 ? (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`) : `${m} min`})`;
      out.push({ id: hash(`${o.key}_${m}`), at, title: o.ev.title || "(senza titolo)", body: [when, o.ev.location].filter(Boolean).join(" · ") });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ---- Android: notifiche programmate nel sistema (arrivano anche ad app chiusa) ------------------------------
let lastSig = "";
export async function scheduleAndroid(rem: Reminder[]) {
  if (!isAndroid) return;
  const list = rem.slice(0, 60);                                 // Android ne tiene un numero limitato: le prossime 60
  const sig = list.map((r) => `${r.id}@${r.at.getTime()}|${r.title}|${r.body}`).join(";");
  if (sig === lastSig) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== "granted") {
    const r = await LocalNotifications.requestPermissions();
    if (r.display !== "granted") return;
  }
  const pend = await LocalNotifications.getPending();
  if (pend.notifications.length) await LocalNotifications.cancel({ notifications: pend.notifications.map((n) => ({ id: n.id })) });
  if (list.length) {
    await LocalNotifications.schedule({
      notifications: list.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: true }, smallIcon: "ic_stat_cal" })),
    });
  }
  lastSig = sig;
}

// ---- Windows: l'app resta nell'area di notifica e controlla lei i promemoria ------------------------------
const fired = new Set<number>();
export async function tickTauri(rem: Reminder[], now: Date) {
  if (!isTauri) return;
  const due = rem.filter((r) => r.at <= addDays(now, 0) && now.getTime() - r.at.getTime() < 120000 && !fired.has(r.id));
  if (!due.length) return;
  const n = await import("@tauri-apps/plugin-notification");
  let ok = await n.isPermissionGranted();
  if (!ok) ok = (await n.requestPermission()) === "granted";
  for (const r of due) {
    fired.add(r.id);
    if (ok) n.sendNotification({ title: r.title, body: r.body });
  }
}
/** Promemoria scattati nell'ultimo minuto (per Windows, che li controlla ogni 20 secondi). */
export function dueWindow(rem: Reminder[], now: Date): Reminder[] {
  return rem.filter((r) => r.at.getTime() <= now.getTime() + 20000);
}

export async function writeTrofeoLink(json: string): Promise<string> {
  if (!isTauri) throw new Error("solo dall'app per PC");
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke("write_trofeo_link", { json })) as string;
}
export async function readTrofeoLink(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return (await invoke("read_trofeo_link")) as string | null;
  } catch {
    return null;
  }
}

export async function autostart(on?: boolean): Promise<boolean> {
  if (!isTauri) return false;
  const a = await import("@tauri-apps/plugin-autostart");
  if (on === true) await a.enable();
  if (on === false) await a.disable();
  return a.isEnabled();
}

// ---- aggiornamenti: l'app sul telefono e sul PC controlla se sul sito c'e' una versione piu' nuova ---------
export const update = signal<{ version: string; url: string } | null>(null);
export async function checkUpdate(): Promise<boolean> {
  if (!isAndroid && !isTauri) return false;                     // la versione web e' sempre l'ultima
  try {
    const r = await fetch(SITE + "version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return false;
    const j = await r.json();
    if (Number(j.build) > APP_BUILD) {
      update.value = { version: String(j.version || ""), url: isAndroid ? APK_URL : EXE_URL };
      return true;
    }
  } catch { /* senza rete: si riprova al prossimo avvio */ }
  return false;
}

/** Apre un indirizzo nel browser del sistema (non dentro l'app). */
export async function openUrl(url: string) {
  if (isTauri) {
    const { openUrl: o } = await import("@tauri-apps/plugin-opener");
    await o(url);
  } else if (isAndroid) {
    location.href = url;                                         // indirizzo esterno: Android lo apre nel browser
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export async function haptic() {
  if (!isAndroid) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* nessuna vibrazione */ }
}

/** Tasto indietro di Android: chiude il pannello aperto invece di uscire dall'app. */
export async function onBack(handler: () => boolean) {
  if (!isAndroid) return;
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", () => {
    if (!handler()) void App.minimizeApp();
  });
}

export async function statusBar(dark: boolean) {
  if (!isAndroid) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? "#000000" : "#f6f6f8" });
  } catch { /* versione di Android senza controllo della barra */ }
}
