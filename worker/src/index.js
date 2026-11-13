// Shop-Server für Domo Gastro (Cloudflare Worker + D1).
// Konto:      POST /konto/registrieren, /konto/anmelden, /konto/abmelden, /konto/passwort-vergessen, /konto/passwort-setzen
//             GET/PUT/DELETE /konto
// Bestellung: POST /bestellung, /bestellung/status, /bezahlen/abschluss
// Bewertung:  GET /bewertungen?produkt=…, POST /bewertungen
// Verwaltung: GET /verwaltung, POST /verwaltung/status, /verwaltung/bewertung (Schlüssel VERWALTUNG_SCHLUESSEL)
import { Fehler, json } from "./hilfe.js";
import * as konto from "./konto.js";
import * as shop from "./shop.js";

function herkunftVon(env, request) {
  const h = request.headers.get("Origin") || "";
  return (env.HERKUNFT || "").split(",").map((s) => s.trim()).includes(h) ? h : null;
}

async function gebremst(env, request, art) {
  if (!env.BREMSE) return false;
  const ip = request.headers.get("CF-Connecting-IP") || "unbekannt";
  return !(await env.BREMSE.limit({ key: `${art}:${ip}` })).success;
}

async function koerper(request) {
  if ((request.headers.get("Content-Length") | 0) > 20000) throw new Fehler("Anfrage zu groß.", 413);
  try { return await request.json(); } catch { throw new Fehler("Ungültige Anfrage."); }
}

async function verteilen(request, env, ctx) {
  const url = new URL(request.url);
  const weg = `${request.method} ${url.pathname.replace(/\/+$/, "") || "/"}`;
  const d = request.method === "POST" || request.method === "PUT" ? await koerper(request) : {};
  switch (weg) {
    case "POST /konto/registrieren": return konto.registrieren(env, d);
    case "POST /konto/anmelden": return konto.anmelden(env, d);
    case "POST /konto/abmelden": return konto.abmelden(env, request);
    case "POST /konto/passwort-vergessen": return konto.passwortVergessen(env, d, ctx);
    case "POST /konto/passwort-setzen": return konto.passwortSetzen(env, d);
    case "GET /konto": return konto.lesen(env, await konto.pflichtKunde(env, request));
    case "PUT /konto": return konto.aendern(env, await konto.pflichtKunde(env, request), d);
    case "DELETE /konto": return konto.loeschen(env, await konto.pflichtKunde(env, request));
    case "POST /bestellung": return shop.bestellen(env, ctx, d, await konto.kundeAusAnfrage(env, request));
    case "POST /bestellung/status": return shop.status(env, d);
    case "POST /bezahlen/abschluss": return shop.bezahlt(env, ctx, d);
    case "GET /bewertungen": return shop.bewertungenLesen(env, url.searchParams.get("produkt"));
    case "POST /bewertungen": return shop.bewerten(env, ctx, await konto.pflichtKunde(env, request), d);
    case "GET /verwaltung": await shop.verwaltungPruefen(env, request); return shop.verwaltungListe(env);
    case "POST /verwaltung/status": await shop.verwaltungPruefen(env, request); return shop.verwaltungStatus(env, ctx, d);
    case "POST /verwaltung/bewertung": await shop.verwaltungPruefen(env, request); return shop.verwaltungBewertung(env, d);
    default: throw new Fehler("Nicht gefunden.", 404);
  }
}

export default {
  async fetch(request, env, ctx) {
    const herkunft = herkunftVon(env, request);
    const cors = herkunft ? { "Access-Control-Allow-Origin": herkunft, Vary: "Origin" } : {};
    if (request.method === "OPTIONS") {
      return new Response(null, { status: herkunft ? 204 : 403, headers: herkunft ? {
        ...cors, "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" } : {} });
    }
    try {
      if (!herkunft && request.method !== "GET") throw new Fehler("Nicht erlaubt.", 403);
      const art = new URL(request.url).pathname.split("/")[1] || "start";
      if (await gebremst(env, request, art)) throw new Fehler("Zu viele Anfragen. Bitte kurz warten.", 429);
      return json(await verteilen(request, env, ctx), 200, cors);
    } catch (err) {
      if (err instanceof Fehler) return json({ fehler: err.message }, err.status, cors);
      if (err?.message && /E-Mail-Adresse/.test(err.message)) return json({ fehler: err.message }, 400, cors);
      console.error(err);
      return json({ fehler: "Da ist etwas schiefgegangen. Bitte später erneut versuchen oder an sales@ts-systec.de schreiben." }, 500, cors);
    }
  },
};
