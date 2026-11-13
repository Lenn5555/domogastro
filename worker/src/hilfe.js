// Kleine Helfer: Antworten, Kryptografie, Prüfungen. Keine Abhängigkeiten.

export class Fehler extends Error {
  constructor(text, status = 400) { super(text); this.status = status; }
}

export function json(daten, status = 200, kopf = {}) {
  return new Response(JSON.stringify(daten), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...kopf } });
}

const kodierer = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", kodierer.encode(text)));
}

export function zufall(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// Passwort-Prüfwert: PBKDF2-SHA256, 100 000 Runden (Obergrenze in Cloudflare Workers), eigenes Salz je Konto
export async function passwortHash(passwort, salz) {
  const schluessel = await crypto.subtle.importKey("raw", kodierer.encode(passwort), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: kodierer.encode(salz), iterations: 100000 }, schluessel, 256);
  return hex(bits);
}

export function gleich(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function text(v, max = 200) {
  return String(v ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim().slice(0, max);
}

export function email(v) {
  const e = text(v, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben.");
  return e;
}

export const jetzt = () => new Date().toISOString();
export const runden = (x) => Math.round(x * 100) / 100;
export const euro = (x) => x.toFixed(2).replace(".", ",") + " €";
