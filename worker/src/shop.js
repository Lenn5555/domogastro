// Bestellung, Bestellstatus, Bewertungen und Verwaltung (Status setzen, Bewertungen freigeben).
import KATALOG from "./katalog.json" with { type: "json" };
import { Fehler, text, email, jetzt, runden, zufall, sha256, gleich } from "./hilfe.js";
import { anlegen as kontoAnlegen, oeffentlich } from "./konto.js";
import { senden, kundenmail, vertriebsmail, statusmail, bewertungsmail } from "./mail.js";
import * as paypal from "./paypal.js";

export const MWST = 0.19;
const ZAHLARTEN = ["Vorkasse", "PayPal"];
export const STATI = ["eingegangen", "zahlung_offen", "bezahlt", "in_bearbeitung", "versendet", "zugestellt", "storniert"];

function bestellnummer() {
  const d = new Date();
  const tag = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `DG-${tag}-${zufall(3).toUpperCase()}`;
}

// Preise kommen nur aus dem Katalog des Servers, nie aus dem Browser
export function rechnen(positionen) {
  if (!Array.isArray(positionen) || !positionen.length) throw new Fehler("Der Warenkorb ist leer.");
  if (positionen.length > 50) throw new Fehler("Zu viele Positionen.");
  const pos = positionen.map((p) => {
    const a = KATALOG.artikel[String(p.sku)];
    const menge = parseInt(p.menge, 10);
    if (!a || !a.p) throw new Fehler(`Artikel ${text(p.sku, 40)} ist nicht bestellbar.`);
    if (!(menge >= 1 && menge <= 99)) throw new Fehler("Ungültige Menge.");
    return { sku: String(p.sku), name: a.n, slug: a.s, menge, netto: a.p };
  });
  const netto = runden(pos.reduce((s, p) => s + p.netto * p.menge, 0));
  const mwst = runden(netto * MWST);
  return { positionen: pos, netto, mwst, brutto: runden(netto + mwst) };
}

function kundendaten(k, modus) {
  const d = {
    name: text(k?.name, 120), firma: text(k?.firma, 120), ustid: text(k?.ustid, 30), strasse: text(k?.strasse, 120),
    plz: text(k?.plz, 10), ort: text(k?.ort, 80), telefon: text(k?.telefon, 40), hinweis: text(k?.hinweis, 1000),
  };
  if (!d.name || !d.strasse || !d.plz || !d.ort) throw new Fehler("Bitte Name und vollständige Rechnungsadresse angeben.");
  if (modus === "gewerbe" && !d.firma) throw new Fehler("Bitte den Firmennamen angeben oder oben auf „Privat“ wechseln.");
  // Eigene Lieferadresse nur, wenn der Kunde „gleich wie Rechnungsadresse“ abgewählt hat
  const l = k?.liefer;
  if (l && typeof l === "object") {
    d.liefer = { firma: text(l.firma, 120), name: text(l.name, 120), strasse: text(l.strasse, 120), plz: text(l.plz, 5), ort: text(l.ort, 80) };
    if (!d.liefer.name || !d.liefer.strasse || !d.liefer.ort) throw new Fehler("Bitte Name und vollständige Lieferadresse angeben.");
  }
  if (!/^\d{5}$/.test(d.liefer ? d.liefer.plz : d.plz))
    throw new Fehler("Bitte eine gültige deutsche Postleitzahl für die Lieferadresse angeben. Wir liefern nur innerhalb Deutschlands.");
  return d;
}

export async function bestellen(env, ctx, d, kunde, abruf = fetch) {
  const modus = d.modus === "gewerbe" ? "gewerbe" : "privat";
  if (!d.agb) throw new Fehler("Bitte akzeptieren Sie die AGB.");
  if (!ZAHLARTEN.includes(d.zahlart)) throw new Fehler("Bitte eine Zahlungsart wählen.");
  if (d.zahlart === "PayPal" && !paypal.aktiv(env)) throw new Fehler("PayPal ist gerade nicht verfügbar. Bitte Vorkasse wählen.");
  const mail = email(d.kunde?.email);
  const k = kundendaten(d.kunde, modus);
  const r = rechnen(d.positionen);
  // Der Browser zeigt den Betrag vor dem Absenden an; weicht er ab (z. B. Preisänderung), lieber neu bestätigen lassen
  if (d.gesamt_brutto != null && Math.abs(Number(d.gesamt_brutto) - r.brutto) > 0.01)
    throw new Fehler("Die Preise haben sich geändert. Bitte laden Sie den Warenkorb neu und prüfen Sie den Betrag.", 409);

  let kundeId = kunde?.id || null, sitzung = null;
  if (!kundeId && d.konto_anlegen) {
    const neu = await kontoAnlegen(env, { email: mail, passwort: d.passwort, name: k.name, ...k });
    kundeId = neu.id; sitzung = neu.sitzung;
  }
  // Bitte um Bewertung nur mit Konto (Bewerten setzt Anmeldung voraus) und nur mit ausdrücklicher Zustimmung
  k.bewertungsmail = Boolean(d.bewertungsmail && kundeId);
  const b = {
    nr: bestellnummer(), kunde_id: kundeId, email: kunde?.email || mail, modus, kunde: k, ...r,
    zahlart: d.zahlart, status: d.zahlart === "PayPal" ? "zahlung_offen" : "eingegangen", datum: jetzt(),
  };
  let link = null;
  if (b.zahlart === "PayPal") {
    const p = await paypal.anlegen(env, b, abruf);
    b.paypal_id = p.id; link = p.link;
  }
  await env.DB.prepare(`INSERT INTO bestellungen (nr, kunde_id, email, modus, kunde, positionen, netto, mwst, brutto, zahlart, status, paypal_id, datum, aktualisiert)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(b.nr, b.kunde_id, b.email, b.modus, JSON.stringify(b.kunde), JSON.stringify(b.positionen), b.netto, b.mwst, b.brutto,
          b.zahlart, b.status, b.paypal_id || "", b.datum, b.datum).run();
  if (!link) benachrichtigen(env, ctx, b);
  return { nr: b.nr, paypal: link, sitzung };
}

function benachrichtigen(env, ctx, b) {
  ctx.waitUntil(Promise.all([
    senden(env, b.email, `Ihre Bestellung ${b.nr} bei Domo Gastro`, kundenmail(env, b)),
    senden(env, env.BESTELL_EMAIL, `Bestellung ${b.nr} (${b.modus}) ${b.zahlart}`, vertriebsmail(env, b)),
  ]));
}

function ausZeile(z) {
  return { ...z, kunde: JSON.parse(z.kunde), positionen: JSON.parse(z.positionen) };
}

export async function bezahlt(env, ctx, d, abruf = fetch) {
  const z = await env.DB.prepare("SELECT * FROM bestellungen WHERE nr = ?").bind(text(d.nr, 30)).first();
  if (!z) throw new Fehler("Bestellung nicht gefunden.", 404);
  if (z.status !== "zahlung_offen") return { ok: true }; // schon abgeschlossen
  const b = ausZeile(z);
  const r = await paypal.abschliessen(env, b, text(d.paypal_id, 40), abruf);
  if (r.fehler) throw new Fehler(r.fehler);
  await env.DB.prepare("UPDATE bestellungen SET status = 'bezahlt', transaktion = ?, aktualisiert = ? WHERE nr = ?").bind(r.transaktion, jetzt(), b.nr).run();
  benachrichtigen(env, ctx, { ...b, status: "bezahlt", transaktion: r.transaktion });
  return { ok: true };
}

export async function status(env, d) {
  const z = await env.DB.prepare("SELECT * FROM bestellungen WHERE nr = ?").bind(text(d.nr, 30).toUpperCase()).first();
  // Gleiche Meldung bei falscher Nummer und falscher Adresse
  if (!z || !gleich(z.email, String(d.email || "").trim().toLowerCase())) throw new Fehler("Keine Bestellung mit dieser Nummer und E-Mail-Adresse gefunden.", 404);
  return oeffentlich(z);
}

/* ---------- Bewertungen ---------- */
// Hat der Kunde einen Artikel dieses Produkts gekauft UND bezahlt? (Vorkasse zählt erst, wenn in der Verwaltung „bezahlt“ gesetzt ist)
async function gekauft(env, kundeId, skus) {
  const b = await env.DB.prepare("SELECT positionen FROM bestellungen WHERE kunde_id = ? AND status IN ('bezahlt', 'in_bearbeitung', 'versendet', 'zugestellt')").bind(kundeId).all();
  return b.results.some((z) => JSON.parse(z.positionen).some((p) => skus.includes(p.sku)));
}

// darf: "anmelden" | "nicht_gekauft" | "schon_bewertet" | "ja"  – steuert, ob die Produktseite das Formular zeigt
async function darfBewerten(env, kunde, slug) {
  const skus = KATALOG.produkte[slug];
  if (!kunde || !skus) return "anmelden";
  if (await env.DB.prepare("SELECT id FROM bewertungen WHERE produkt = ? AND kunde_id = ?").bind(slug, kunde.id).first()) return "schon_bewertet";
  return (await gekauft(env, kunde.id, skus)) ? "ja" : "nicht_gekauft";
}

export async function bewertungenLesen(env, slug, kunde = null) {
  const p = text(slug, 120);
  // Öffentlich: nur wie viele Personen wie viele Sterne gegeben haben. Einzeln (mit Namen) erscheinen nur Bewertungen mit Kommentar.
  const v = await env.DB.prepare("SELECT sterne, COUNT(*) AS n FROM bewertungen WHERE produkt = ? AND freigegeben = 1 GROUP BY sterne").bind(p).all();
  const verteilung = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const z of v.results) verteilung[z.sterne] = z.n;
  const anzahl = Object.values(verteilung).reduce((s, n) => s + n, 0);
  const schnitt = anzahl ? Object.entries(verteilung).reduce((s, [k, n]) => s + k * n, 0) / anzahl : 0;
  const r = await env.DB.prepare("SELECT name, sterne, titel, text, verifiziert, datum FROM bewertungen WHERE produkt = ? AND freigegeben = 1 AND (titel <> '' OR text <> '') ORDER BY datum DESC LIMIT 100")
    .bind(p).all();
  return { anzahl, schnitt: Math.round(schnitt * 10) / 10, verteilung, liste: r.results, darf: await darfBewerten(env, kunde, p) };
}

export async function bewerten(env, ctx, kunde, d) {
  const slug = text(d.produkt, 120);
  const skus = KATALOG.produkte[slug];
  if (!skus) throw new Fehler("Produkt nicht gefunden.", 404);
  const sterne = parseInt(d.sterne, 10);
  if (!(sterne >= 1 && sterne <= 5)) throw new Fehler("Bitte 1 bis 5 Sterne wählen.");
  const titel = text(d.titel, 80), inhalt = text(d.text, 2000);  // beides freiwillig, Pflicht sind nur die Sterne
  // Nur wer das Produkt gekauft und bezahlt hat
  if (!(await gekauft(env, kunde.id, skus))) throw new Fehler("Bewerten können Sie Produkte, die Sie bei uns gekauft haben.", 403);
  const teile = (kunde.name || "Kunde").trim().split(/\s+/);
  const name = teile.length > 1 ? `${teile[0]} ${teile[teile.length - 1][0]}.` : teile[0];
  try {
    await env.DB.prepare("INSERT INTO bewertungen (produkt, kunde_id, name, sterne, titel, text, freigegeben, datum) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
      .bind(slug, kunde.id, name, sterne, titel, inhalt, jetzt()).run();
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new Fehler("Sie haben dieses Produkt schon bewertet.", 409);
    throw err;
  }
  // Keine Mail bei neuen Bewertungen (Lenn 2026-11-18); Übersicht in /verwaltung/
  return { ok: true };
}

/* ---------- Verwaltung (nur mit VERWALTUNG_SCHLUESSEL) ---------- */
export async function verwaltungPruefen(env, request) {
  const s = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.VERWALTUNG_SCHLUESSEL || !s || !gleich(await sha256(s), await sha256(env.VERWALTUNG_SCHLUESSEL))) throw new Fehler("Falscher Schlüssel.", 401);
}

export async function verwaltungListe(env) {
  const b = await env.DB.prepare("SELECT * FROM bestellungen ORDER BY datum DESC LIMIT 200").all();
  const r = await env.DB.prepare("SELECT id, produkt, name, sterne, titel, text, datum FROM bewertungen ORDER BY datum DESC LIMIT 100").all();
  return { bestellungen: b.results.map((z) => ({ ...oeffentlich(z), email: z.email, kunde: JSON.parse(z.kunde), transaktion: z.transaktion })), bewertungen: r.results };
}

export async function verwaltungStatus(env, ctx, d) {
  if (!STATI.includes(d.status)) throw new Fehler("Unbekannter Status.");
  const z = await env.DB.prepare("SELECT * FROM bestellungen WHERE nr = ?").bind(text(d.nr, 30)).first();
  if (!z) throw new Fehler("Bestellung nicht gefunden.", 404);
  const sendung = text(d.sendung ?? z.sendung, 200);
  await env.DB.prepare("UPDATE bestellungen SET status = ?, sendung = ?, aktualisiert = ? WHERE nr = ?").bind(d.status, sendung, jetzt(), z.nr).run();
  await bewertungsanfrageVormerken(env, z, d.status);
  if (d.status !== z.status && d.benachrichtigen !== false) {
    const b = { ...ausZeile(z), status: d.status, sendung };
    ctx.waitUntil(senden(env, b.email, `Ihre Bestellung ${b.nr}: Status geändert`, statusmail(env, b)));
  }
  return { ok: true };
}

/* ---------- Bitte um Bewertung (einmal je Bestellung) ---------- */
const TAG = 86400000;
async function bewertungsanfrageVormerken(env, z, status) {
  if (status === "storniert") { await env.DB.prepare("DELETE FROM bewertungsanfragen WHERE nr = ? AND gesendet = ''").bind(z.nr).run(); return; }
  if (!z.kunde_id || !JSON.parse(z.kunde).bewertungsmail) return;
  // 7 Tage nach „versendet“ oder 3 Tage nach „zugestellt“, je nachdem, was früher ist
  const tage = status === "versendet" ? 7 : status === "zugestellt" ? 3 : 0;
  if (!tage) return;
  await env.DB.prepare(`INSERT INTO bewertungsanfragen (nr, faellig) VALUES (?, ?)
    ON CONFLICT(nr) DO UPDATE SET faellig = MIN(faellig, excluded.faellig) WHERE gesendet = ''`)
    .bind(z.nr, new Date(Date.now() + tage * TAG).toISOString()).run();
}

export async function bewertungsanfragenSenden(env) {
  const r = await env.DB.prepare("SELECT nr, faellig FROM bewertungsanfragen WHERE gesendet = '' AND faellig <= ? LIMIT 50").bind(jetzt()).all();
  for (const { nr, faellig } of r.results) {
    const z = await env.DB.prepare("SELECT * FROM bestellungen WHERE nr = ?").bind(nr).first();
    let ergebnis = "uebersprungen";
    const kunde = z && z.kunde_id && await env.DB.prepare("SELECT id FROM kunden WHERE id = ?").bind(z.kunde_id).first();
    if (kunde && ["versendet", "zugestellt"].includes(z.status)) {
      const b = ausZeile(z);
      const schon = (await env.DB.prepare("SELECT produkt FROM bewertungen WHERE kunde_id = ?").bind(z.kunde_id).all()).results.map((x) => x.produkt);
      const produkte = [];
      for (const p of b.positionen) {
        const slug = KATALOG.artikel[String(p.sku)]?.s;
        if (slug && !schon.includes(slug) && !produkte.some((x) => x.slug === slug)) produkte.push({ slug, name: p.name });
      }
      if (produkte.length && await senden(env, b.email, "Wie zufrieden sind Sie mit Ihrer Bestellung?", bewertungsmail(env, b, produkte))) ergebnis = jetzt();
      // Versand fehlgeschlagen: morgen erneut versuchen, aber höchstens 14 Tage lang
      else if (produkte.length && Date.parse(faellig) > Date.now() - 14 * TAG) continue;
    }
    await env.DB.prepare("UPDATE bewertungsanfragen SET gesendet = ? WHERE nr = ?").bind(ergebnis, nr).run();
  }
}

export async function verwaltungBewertung(env, d) {
  const id = parseInt(d.id, 10);
  if (d.freigeben) await env.DB.prepare("UPDATE bewertungen SET freigegeben = 1 WHERE id = ?").bind(id).run();
  else await env.DB.prepare("DELETE FROM bewertungen WHERE id = ?").bind(id).run();
  return { ok: true };
}
