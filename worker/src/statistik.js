// Eigene Besucherstatistik (Lenn 2026-11-26): ohne Cookies, ohne Einwilligung, ohne IP oder Kennung.
// Gespeichert werden nur Tageszähler je Ereignis und Quelle, z. B. „2026-11-26 · einstieg · google · 12“.
import { Fehler } from "./hilfe.js";

export const EREIGNISSE = ["seite", "einstieg", "produkt", "warenkorb", "kasse", "bestellung"];
export const QUELLEN = ["ads", "google", "andere", "direkt"];

// Tag in deutscher Zeit, damit ein Abendbesuch nicht im nächsten Tag landet
export function tag(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}

export async function zaehlen(env, ereignis, quelle = "") {
  if (!EREIGNISSE.includes(ereignis)) throw new Fehler("Unbekanntes Ereignis.");
  const q = QUELLEN.includes(quelle) ? quelle : "";
  await env.DB.prepare(`INSERT INTO statistik (tag, ereignis, quelle, n) VALUES (?, ?, ?, 1)
    ON CONFLICT(tag, ereignis, quelle) DO UPDATE SET n = n + 1`).bind(tag(), ereignis, q).run();
  return { ok: true };
}

// Für /verwaltung/: Summen für 7 und 30 Tage, Einstiege nach Quelle und die Tage einzeln (neueste zuerst)
export async function verwaltungStatistik(env) {
  const ab30 = tag(new Date(Date.now() - 29 * 864e5)), ab7 = tag(new Date(Date.now() - 6 * 864e5));
  const r = (await env.DB.prepare("SELECT tag, ereignis, quelle, n FROM statistik WHERE tag >= ? ORDER BY tag DESC").bind(ab30).all()).results;
  const leer = () => Object.fromEntries(EREIGNISSE.map((e) => [e, 0]));
  const summe = { 7: leer(), 30: leer() }, quellen = { 7: {}, 30: {} }, tage = {};
  for (const z of r) {
    for (const t of [7, 30]) {
      if (t === 7 && z.tag < ab7) continue;
      summe[t][z.ereignis] = (summe[t][z.ereignis] || 0) + z.n;
      if (z.ereignis === "einstieg") quellen[t][z.quelle || "direkt"] = (quellen[t][z.quelle || "direkt"] || 0) + z.n;
    }
    (tage[z.tag] ||= { tag: z.tag, ...leer() })[z.ereignis] += z.n;
  }
  return { summe, quellen, tage: Object.values(tage) };
}

export async function aufraeumen(env) {
  // Zähler älter als zwei Jahre braucht niemand mehr
  await env.DB.prepare("DELETE FROM statistik WHERE tag < ?").bind(tag(new Date(Date.now() - 730 * 864e5))).run();
}
