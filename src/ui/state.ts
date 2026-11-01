import { signal } from "@preact/signals";
import { startOfDay } from "../date";
import type { Ev, Occ } from "../model";

export type Overlay =
  | { t: "detail"; occ: Occ }
  | { t: "editor"; ev: Ev; isNew: boolean; occ?: Occ; scope?: "one" | "after" | "all" }
  | { t: "quick"; ev: Ev }
  | { t: "scope"; occ: Occ; action: "edit" | "delete" }
  | { t: "search" }
  | { t: "settings" }
  | { t: "calendars"; add?: boolean }
  | { t: "drawer" }
  | { t: "trofeo" }
  | { t: "rem"; allDay: boolean; start?: Date; value: number | null; onPick: (m: number | null) => void; none?: boolean }
  | { t: "choice"; title: string; options: [string, string][]; value: string; onPick: (v: string) => void }
  | { t: "shifts" };

export const cursor = signal<Date>(startOfDay(new Date()));
export const selDay = signal<Date | null>(null);
export const overlays = signal<Overlay[]>([]);
export const toast = signal<{ text: string; action?: { label: string; run: () => void } } | null>(null);
export const width = signal<number>(typeof window !== "undefined" ? window.innerWidth : 400);
export const now = signal<Date>(new Date());

export function push(o: Overlay) {
  overlays.value = [...overlays.value, o];
}
export function pop() {
  overlays.value = overlays.value.slice(0, -1);
}
export function closeAll() {
  overlays.value = [];
}
export function replaceTop(o: Overlay) {
  overlays.value = [...overlays.value.slice(0, -1), o];
}
let tt: ReturnType<typeof setTimeout> | null = null;
export function showToast(text: string, action?: { label: string; run: () => void }) {
  toast.value = { text, action };
  if (tt) clearTimeout(tt);
  tt = setTimeout(() => (toast.value = null), action ? 5000 : 2600);
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => (width.value = window.innerWidth));
  setInterval(() => (now.value = new Date()), 30000);
}
