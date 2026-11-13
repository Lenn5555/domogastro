// Bestellung, Bestellstatus, Bewertungen und Verwaltung (Status setzen, Bewertungen freigeben).
import KATALOG from "./katalog.json" with { type: "json" };
import { Fehler, text, email, jetzt, runden, zufall, sha256, gleich } from "./hilfe.js";
import { anlegen as kontoAnlegen, oeffentlich } from "./konto.js";
import { senden, kundenmail, vertriebsmail, statusmail } from "./mail.js";
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
    plz: text(k?.plz, 5), ort: text(k?.ort, 80), telefon: text(k?.telefon, 40), hinweis: text(k?.hinweis, 1000),
  };
  if (!d.name || !d.strasse || !d.ort) throw new Fehler("Bitte Name und vollständige Adresse angeben.");
  if (!/^\d{5}$/.test(d.plz)) throw new Fehler("Bitte eine gültige deutsche Postleitzahl angeben. Wir liefern nur innerhalb Deutschlands.");
  if (modus === "gewerbe" && !d.firma) throw new Fehler("Bitte den Firmennamen angeben oder oben auf „Privat“ wechseln.");
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
export async function bewertungenLesen(env, slug) {
  const r = await env.DB.prepare("SELECT name, sterne, titel, text, verifiziert, datum FROM bewertungen WHERE produkt = ? AND freigegeben = 1 ORDER BY datum DESC LIMIT 100")
    .bind(text(slug, 120)).all();
  const liste = r.results;
  const schnitt = liste.length ? liste.reduce((s, b) => s + b.sterne, 0) / liste.length : 0;
  return { anzahl: liste.length, schnitt: Math.round(schnitt * 10) / 10, liste };
}

export async function bewerten(env, ctx, kunde, d) {
  const slug = text(d.produkt, 120);
  const skus = KATALOG.produkte[slug];
  if (!skus) throw new Fehler("Produkt nicht gefunden.", 404);
  const sterne = parseInt(d.sterne, 10);
  if (!(sterne >= 1 && sterne <= 5)) throw new Fehler("Bitte 1 bis 5 Sterne wählen.");
  const titel = text(d.titel, 80), inhalt = text(d.text, 2000);
  if (!titel || inhalt.length < 10) throw new Fehler("Bitte Überschrift und mindestens einen Satz schreiben.");
  // Nur wer das Produkt gekauft und bezahlt hat
  const b = await env.DB.prepare("SELECT positionen FROM bestellungen WHERE kunde_id = ? AND status IN ('bezahlt', 'in_bearbeitung', 'versendet', 'zugestellt')").bind(kunde.id).all();
  const gekauft = b.results.some((z) => JSON.parse(z.positionen).some((p) => skus.includes(p.sku)));
  if (!gekauft) throw new Fehler("Bewerten können Sie Produkte, die Sie bei uns gekauft haben.", 403);
  const teile = (kunde.name || "Kunde").trim().split(/\s+/);
  const name = teile.length > 1 ? `${teile[0]} ${teile[teile.length - 1][0]}.` : teile[0];
  try {
    await env.DB.prepare("INSERT INTO bewertungen (produkt, kunde_id, name, sterne, titel, text, datum) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(slug, kunde.id, name, sterne, titel, inhalt, jetzt()).run();
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new Fehler("Sie haben dieses Produkt schon bewertet.", 409);
    throw err;
  }
  ctx.waitUntil(senden(env, env.BESTELL_EMAIL, `Neue Bewertung (${sterne} Sterne): ${slug}`,
    `${name} hat „${slug}“ mit ${sterne} Sternen bewertet:\n\n${titel}\n${inhalt}\n\nFreigeben: ${env.SITE_URL}/verwaltung/`));
  return { ok: true };
}

/* ---------- Verwaltung (nur mit VERWALTUNG_SCHLUESSEL) ---------- */
export async function verwaltungPruefen(env, request) {
  const s = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.VERWALTUNG_SCHLUESSEL || !s || !gleich(await sha256(s), await sha256(env.VERWALTUNG_SCHLUESSEL))) throw new Fehler("Falscher Schlüssel.", 401);
}

export async function verwaltungListe(env) {
  const b = await env.DB.prepare("SELECT * FROM bestellungen ORDER BY datum DESC LIMIT 200").all();
  const r = await env.DB.prepare("SELECT id, produkt, name, sterne, titel, text, datum FROM bewertungen WHERE freigegeben = 0 ORDER BY datum").all();
  return { bestellungen: b.results.map((z) => ({ ...oeffentlich(z), email: z.email, kunde: JSON.parse(z.kunde), transaktion: z.transaktion })), bewertungen: r.results };
}

export async function verwaltungStatus(env, ctx, d) {
  if (!STATI.includes(d.status)) throw new Fehler("Unbekannter Status.");
  const z = await env.DB.prepare("SELECT * FROM bestellungen WHERE nr = ?").bind(text(d.nr, 30)).first();
  if (!z) throw new Fehler("Bestellung nicht gefunden.", 404);
  const sendung = text(d.sendung ?? z.sendung, 200);
  await env.DB.prepare("UPDATE bestellungen SET status = ?, sendung = ?, aktualisiert = ? WHERE nr = ?").bind(d.status, sendung, jetzt(), z.nr).run();
  if (d.status !== z.status && d.benachrichtigen !== false) {
    const b = { ...ausZeile(z), status: d.status, sendung };
    ctx.waitUntil(senden(env, b.email, `Ihre Bestellung ${b.nr}: Status geändert`, statusmail(env, b)));
  }
  return { ok: true };
}

export async function verwaltungBewertung(env, d) {
  const id = parseInt(d.id, 10);
  if (d.freigeben) await env.DB.prepare("UPDATE bewertungen SET freigegeben = 1 WHERE id = ?").bind(id).run();
  else await env.DB.prepare("DELETE FROM bewertungen WHERE id = ?").bind(id).run();
  return { ok: true };
}
