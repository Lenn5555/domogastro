// Shop-Server für Domo Gastro (Cloudflare Worker + D1).
// Konto:      POST /konto/registrieren, /konto/anmelden, /konto/abmelden, /konto/passwort-vergessen, /konto/passwort-setzen
//             GET/PUT/DELETE /konto
// Bestellung: POST /bestellung (Überweisung), /bestellung/status; Kreditkarte/PayPal: GET /bezahlen, POST /bezahlen/start, /bezahlen/abschluss
// Widerruf:   POST /widerruf (Widerrufsbutton), Verwaltung: POST /verwaltung/widerruf
// Bewertung:  GET /bewertungen?produkt=…, POST /bewertungen (mit Konto oder Vorname + E-Mail, erscheint sofort)
// Gutschein:  POST /gutschein/pruefen; USt-IdNr.: POST /ustid/pruefen (EU-Abfrage VIES)
// Zeitplan:   täglich fällige Bitten um Bewertung verschicken (wrangler.toml [triggers])
// Berater:    GET /beraten (eingerichtet?), POST /beraten (KI-Produktberater mit Claude, Schlüssel ANTHROPIC_API_KEY)
// Newsletter:  POST /newsletter/anmelden, /newsletter/bestaetigen, /newsletter/abmelden; POST /newsletter/ein-klick?s=… (Mailprogramm, RFC 8058)
// Verwaltung: GET /verwaltung, GET /verwaltung/newsletter, POST /verwaltung/status, /verwaltung/bewertung (Schlüssel VERWALTUNG_SCHLUESSEL)
import { Fehler, json } from "./hilfe.js";
import * as konto from "./konto.js";
import * as shop from "./shop.js";
import Anthropic from "@anthropic-ai/sdk";
import * as berater from "./berater.js";
import * as widerruf from "./widerruf.js";
import * as newsletter from "./newsletter.js";

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
  if ((request.headers.get("Content-Length") | 0) > 60000) throw new Fehler("Anfrage zu groß.", 413);
  try { return await request.json(); } catch { throw new Fehler("Ungültige Anfrage."); }
}

const ipVon = (request) => request.headers.get("CF-Connecting-IP") || "";

// Häkchen „Newsletter“ an der Kasse: nach erfolgreicher Bestellung Bestätigungsmail (Double-Opt-in) an die Bestelladresse
function mitNewsletter(env, ctx, request, d, ergebnis) {
  // Bestandskunden-Gruppe (§ 7 Abs. 3 UWG): nur mit Hinweis an der Kasse, siehe newsletter.bestandskundeMerken
  if (ergebnis?.nr) ctx.waitUntil(newsletter.bestandskundeMerken(env, ergebnis.nr).catch((err) => console.error("Bestandskunde:", err)));
  if (d.newsletter === true && ergebnis?.email) {
    ctx.waitUntil(newsletter.anmelden(env, { email: ergebnis.email, einwilligung: true }, { ip: ipVon(request), quelle: "kasse", api: new URL(request.url).origin })
      .catch((err) => console.error("Newsletter (Kasse):", err)));
  }
  return ergebnis;
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
    case "POST /bestellung": return mitNewsletter(env, ctx, request, d, await shop.bestellen(env, ctx, d, await konto.kundeAusAnfrage(env, request)));
    case "POST /bestellung/status": return shop.status(env, d);
    case "POST /widerruf": return widerruf.widerrufen(env, ctx, d);
    case "GET /bezahlen": return shop.bezahlenInfo(env);
    case "POST /bezahlen/start": return shop.bezahlenStart(env, d, await konto.kundeAusAnfrage(env, request));
    case "POST /bezahlen/abschluss": return mitNewsletter(env, ctx, request, d, await shop.bezahlenAbschluss(env, ctx, d, await konto.kundeAusAnfrage(env, request)));
    case "GET /bewertungen/uebersicht": return shop.bewertungenUebersicht(env);
    case "GET /bewertungen": return shop.bewertungenLesen(env, url.searchParams.get("produkt"), await konto.kundeAusAnfrage(env, request));
    case "POST /gutschein/pruefen": return shop.gutscheinPruefen(env, d);
    case "POST /ustid/pruefen": return shop.ustidAnfrage(env, d);
    case "POST /bewertungen": {
      const kunde = await konto.kundeAusAnfrage(env, request);
      const { mail, ...antwort } = kunde ? await shop.bewerten(env, ctx, kunde, d) : await shop.bewertenOffen(env, d, ipVon(request));
      // Freiwilliges Häkchen „Newsletter“ im Bewertungsformular: nur Bestätigungsmail (Double-Opt-in), nie automatisch eintragen
      if (d.newsletter === true && mail) {
        ctx.waitUntil(newsletter.anmelden(env, { email: mail, einwilligung: true }, { ip: ipVon(request), quelle: "bewertung", api: url.origin })
          .catch((err) => console.error("Newsletter (Bewertung):", err)));
      }
      return antwort;
    }
    case "POST /newsletter/anmelden":
      if (env.NEWSLETTER_BREMSE && !(await env.NEWSLETTER_BREMSE.limit({ key: `nl:${ipVon(request)}` })).success) throw new Fehler("Zu viele Anmeldungen auf einmal. Bitte kurz warten.", 429);
      return newsletter.anmelden(env, d, { ip: ipVon(request), quelle: "fuss", api: url.origin });
    case "POST /newsletter/bestaetigen": return newsletter.bestaetigen(env, d, { ip: ipVon(request), api: url.origin });
    case "POST /newsletter/abmelden": return newsletter.abmelden(env, d.s);
    case "GET /beraten": return { aktiv: Boolean(env.ANTHROPIC_API_KEY) };
    case "POST /beraten": return beratenAnfrage(env, d, request);
    case "GET /verwaltung": await shop.verwaltungPruefen(env, request); return shop.verwaltungListe(env);
    case "GET /verwaltung/newsletter": await shop.verwaltungPruefen(env, request); return newsletter.verwaltungListe(env);
    case "POST /verwaltung/newsletter/test": await shop.verwaltungPruefen(env, request); return newsletter.testSenden(env, d);
    case "POST /verwaltung/newsletter/senden": await shop.verwaltungPruefen(env, request); return newsletter.versandStarten(env, d);
    case "POST /verwaltung/newsletter/abbrechen": await shop.verwaltungPruefen(env, request); return newsletter.versandAbbrechen(env, d);
    case "POST /verwaltung/status": await shop.verwaltungPruefen(env, request); return shop.verwaltungStatus(env, ctx, d);
    case "POST /verwaltung/widerruf": await shop.verwaltungPruefen(env, request); return widerruf.verwaltungWiderruf(env, ctx, d);
    case "POST /verwaltung/bewertung": await shop.verwaltungPruefen(env, request); return shop.verwaltungBewertung(env, d);
    default: throw new Fehler("Nicht gefunden.", 404);
  }
}

async function beratenAnfrage(env, d, request) {
  const verlauf = berater.verlaufPruefen(d);
  if (!verlauf) throw new Fehler("Bitte eine Frage eingeben.");
  if (!env.ANTHROPIC_API_KEY) throw new Fehler("Der Berater ist noch nicht eingerichtet.", 503);
  // eigene, strengere Bremse für den Berater (jede Antwort kostet), zusätzlich zur allgemeinen
  if (env.BERATER_BREMSE) {
    const ip = request.headers.get("CF-Connecting-IP") || "unbekannt";
    if (!(await env.BERATER_BREMSE.limit({ key: `beraten:${ip}` })).success) throw new Fehler("Zu viele Fragen auf einmal. Bitte kurz warten.", 429);
  }
  try {
    return await berater.beraten(berater.neuerClient(env), verlauf, env.MODELL || undefined);
  } catch (err) {
    console.error("Berater:", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    throw new Fehler("Der Berater ist gerade nicht erreichbar. Bitte später noch einmal versuchen.", err instanceof Anthropic.RateLimitError ? 429 : 502);
  }
}

export default {
  async scheduled(ereignis, env, ctx) {
    if (ereignis.cron === "*/10 * * * *") { ctx.waitUntil(newsletter.versandWeiter(env)); return; }
    ctx.waitUntil(shop.bewertungsanfragenSenden(env));
    ctx.waitUntil(newsletter.aufraeumen(env));
    ctx.waitUntil(shop.bewertungIpAufraeumen(env));
  },
  async fetch(request, env, ctx) {
    const herkunft = herkunftVon(env, request);
    const cors = herkunft ? { "Access-Control-Allow-Origin": herkunft, Vary: "Origin" } : {};
    if (request.method === "OPTIONS") {
      return new Response(null, { status: herkunft ? 204 : 403, headers: herkunft ? {
        ...cors, "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" } : {} });
    }
    // Ein-Klick-Abmeldung aus dem Mailprogramm (RFC 8058): kommt ohne Origin und als Formular, nicht als JSON
    const pfad = new URL(request.url).pathname.replace(/\/+$/, "");
    if (request.method === "POST" && pfad === "/newsletter/ein-klick") {
      try { await newsletter.abmelden(env, new URL(request.url).searchParams.get("s")); return new Response("Abgemeldet.", { status: 200 }); }
      catch (err) { return new Response(err instanceof Fehler ? err.message : "Fehler", { status: err?.status || 500 }); }
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
