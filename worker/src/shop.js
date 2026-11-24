// Bestellung, Bestellstatus, Bewertungen und Verwaltung (Status setzen, Bewertungen freigeben).
import KATALOG from "./katalog.json" with { type: "json" };
import { Fehler, text, email, jetzt, runden, zufall, sha256, gleich } from "./hilfe.js";
import { anlegen as kontoAnlegen, oeffentlich } from "./konto.js";
import { senden, kundenmail, vertriebsmail, statusmail, bewertungsmail, zahlungsmail, rechtsAnhaenge } from "./mail.js";
import * as paypal from "./paypal.js";
import { widerrufeVon } from "./widerruf.js";
import LAENDER from "../../daten/laender.json" with { type: "json" };
import AKTION from "../../daten/aktion.json" with { type: "json" };
import { gesamtRechnen, landVon, aktionAktiv, stueckpreis } from "./steuer.js";
import { ustidPruefen } from "./ustid.js";
import { mindestwertFehler, mindestwert, PRAEFIX as NL_PRAEFIX, WERBEHINWEIS_STAND } from "./newsletter.js";

export const MWST = 0.19;
const ZAHLARTEN = ["Vorkasse", "Kreditkarte", "PayPal"];
const SOFORT = ["Kreditkarte", "PayPal"]; // beide laufen über PayPal
export const STATI = ["eingegangen", "zahlung_offen", "bezahlt", "in_bearbeitung", "versendet", "zugestellt", "storniert"];

function bestellnummer() {
  const d = new Date();
  const tag = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `DG-${tag}-${zufall(3).toUpperCase()}`;
}

// Preise kommen nur aus dem Katalog des Servers, nie aus dem Browser. prozent = Gutschein-Rabatt auf den Warenwert.
// land = Lieferland (daten/laender.json), ustidGueltig = Unternehmer mit geprüfter USt-IdNr. aus einem anderen EU-Land
export function rechnen(positionen, prozent = 0, land = "DE", ustidGueltig = false, jetzt = Date.now()) {
  if (!Array.isArray(positionen) || !positionen.length) throw new Fehler("Der Warenkorb ist leer.");
  if (positionen.length > 50) throw new Fehler("Zu viele Positionen.");
  if (!landVon(LAENDER, land)) throw new Fehler("In dieses Land liefern wir leider nicht. Schreiben Sie uns gern an sales@ts-systec.de.");
  const akt = aktionAktiv(AKTION, jetzt);  // Preisaktion (Black Week): reduzierter Stückpreis
  const pos = positionen.map((p) => {
    const a = KATALOG.artikel[String(p.sku)];
    const menge = parseInt(p.menge, 10);
    if (!a || !a.p) throw new Fehler(`Artikel ${text(p.sku, 40)} ist nicht bestellbar.`);
    if (!(menge >= 1 && menge <= 99)) throw new Fehler("Ungültige Menge.");
    return { sku: String(p.sku), name: a.n, slug: a.s, menge, netto: stueckpreis(AKTION, a.p, jetzt), ...(akt ? { netto_vorher: a.p } : {}), a };
  });
  const g = gesamtRechnen(LAENDER, land, pos, prozent, ustidGueltig, AKTION, jetzt);
  if (g.gesperrt.length) throw new Fehler(`„${g.gesperrt[0].name}“ können wir nach ${g.land.n} noch nicht liefern (Elektrogerät). Bitte entfernen Sie es aus dem Warenkorb oder schreiben Sie uns an sales@ts-systec.de.`);
  return {
    positionen: pos.map(({ a, ...x }) => x), warenwert: g.warenwert, rabatt: g.rabatt, versand: g.versand,
    netto: g.netto, mwst: g.mwst, brutto: g.brutto,
    steuer: { land: g.land.c, landname: g.land.n, art: g.art, satz: g.satz, versand: g.versand, pakete: g.pakete, warenwert: g.warenwert,
      ...(akt ? { aktion: { name: akt.name, prozent: akt.prozent } } : {}) },
  };
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
    d.liefer = { firma: text(l.firma, 120), name: text(l.name, 120), strasse: text(l.strasse, 120), plz: text(l.plz, 10), ort: text(l.ort, 80) };
    if (!d.liefer.name || !d.liefer.strasse || !d.liefer.ort) throw new Fehler("Bitte Name und vollständige Lieferadresse angeben.");
  }
  // § 7 Abs. 3 UWG (Lenn 2026-11-24): Hinweis auf Werbung zu ähnlichen Produkten wurde an der Kasse gezeigt; Häkchen = sofortiger Widerspruch
  if (k?.werbehinweis === true) d.werbehinweis = WERBEHINWEIS_STAND;
  if (k?.keine_werbung === true) d.keine_werbung = true;
  d.land = landVon(LAENDER, String(k?.land || "DE")) ? String(k?.land || "DE") : "";
  if (!d.land) throw new Fehler("In dieses Land liefern wir leider nicht. Schreiben Sie uns gern an sales@ts-systec.de.");
  const plz = d.liefer ? d.liefer.plz : d.plz;
  if (d.land === "DE" ? !/^\d{5}$/.test(plz) : !/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(plz))
    throw new Fehler(d.land === "DE" ? "Bitte eine gültige deutsche Postleitzahl für die Lieferadresse angeben." : "Bitte eine gültige Postleitzahl für die Lieferadresse angeben.");
  return d;
}

// Prüft die Bestelldaten und rechnet den Betrag (für Vorkasse und Sofortbezahlen gleich)
async function vorbereiten(env, d, kunde) {
  const modus = d.modus === "gewerbe" ? "gewerbe" : "privat";
  if (!d.agb) throw new Fehler("Bitte akzeptieren Sie die AGB.");
  if (!ZAHLARTEN.includes(d.zahlart)) throw new Fehler("Bitte eine Zahlungsart wählen.");
  if (SOFORT.includes(d.zahlart) && !paypal.aktiv(env)) throw new Fehler("Kreditkarte und PayPal sind gerade nicht verfügbar. Bitte Überweisung wählen.");
  const mail = email(d.kunde?.email);
  const k = kundendaten(d.kunde, modus);
  const code = gutscheinCode(d.gutschein);
  const g = code ? await gutscheinLesen(env, code) : null;
  // Unternehmer aus einem anderen EU-Land mit gültiger USt-IdNr.: steuerfreie innergemeinschaftliche Lieferung (Prüfung bei der EU, VIES)
  const land = landVon(LAENDER, k.land);
  let ust = null;
  if (modus === "gewerbe" && land.eu && land.c !== "DE" && k.ustid) {
    ust = await ustidPruefen(env, k.ustid, land);
    if (!ust.gueltig) throw new Fehler(ust.fehler || "Die USt-IdNr. ist laut EU-Prüfung (VIES) nicht gültig. Bitte prüfen Sie sie oder bestellen Sie ohne USt-IdNr. mit Umsatzsteuer.");
  }
  const r = rechnen(d.positionen, g ? g.prozent : 0, k.land, Boolean(ust?.gueltig));
  const mw = g ? mindestwertFehler(g.code, r.warenwert) : "";
  if (mw) throw new Fehler(mw);
  // Der Browser zeigt den Betrag vor dem Absenden an; weicht er ab (z. B. Preisänderung), lieber neu bestätigen lassen
  if (d.gesamt_brutto != null && Math.abs(Number(d.gesamt_brutto) - r.brutto) > 0.01)
    throw new Fehler("Die Preise haben sich geändert. Bitte laden Sie den Warenkorb neu und prüfen Sie den Betrag.", 409);
  // Fingerabdruck für PayPal: dieselben Daten beim Start und beim Abschluss
  const abdruck = await paypal.fingerabdruck([modus, mail, k, r.positionen.map((p) => [p.sku, p.menge]), g?.code || "", d.zahlart,
    kunde?.id || "", Boolean(d.konto_anlegen), Boolean(d.bewertungsmail)]);
  // erst nach dem Fingerabdruck: Prüfnachweis enthält eine Uhrzeit
  k.steuer = r.steuer;
  if (ust) k.ustid_pruefung = ust.nachweis;
  return { modus, mail, k, g, r, abdruck };
}

// Speichert die Bestellung: Konto anlegen (falls gewünscht), Gutschein reservieren, Zeile schreiben.
// vorZahlung (nur Sofortbezahlen) zieht das Geld ein, nachdem alles geprüft und reserviert ist, und vor dem Speichern.
async function speichern(env, ctx, d, kunde, v, nr, zahlung = null) {
  const { modus, mail, k, g, r } = v;
  let kundeId = kunde?.id || null, sitzung = null;
  if (!kundeId && d.konto_anlegen) {
    const neu = await kontoAnlegen(env, { email: mail, passwort: d.passwort, name: k.name, ...k });
    kundeId = neu.id; sitzung = neu.sitzung;
  }
  // Bitte um Bewertung nur mit Konto (Bewerten setzt Anmeldung voraus) und nur mit ausdrücklicher Zustimmung
  k.bewertungsmail = Boolean(d.bewertungsmail && kundeId);
  if (g) {
    // Code reservieren, bevor die Bestellung gespeichert wird (gleichzeitige Doppel-Einlösung verhindern)
    const u = await env.DB.prepare("UPDATE gutscheine SET eingeloest_nr = ?, eingeloest_am = ? WHERE code = ? AND eingeloest_nr = ''").bind(nr, jetzt(), g.code).run();
    if (!u.meta.changes) throw new Fehler("Dieser Gutscheincode wurde bereits eingelöst.");
    k.gutschein = { code: g.code, prozent: g.prozent, rabatt: r.rabatt };
  }
  let bezahlt = null;
  if (zahlung) {
    bezahlt = await zahlung();
    if (bezahlt.fehler) {
      if (g) await env.DB.prepare("UPDATE gutscheine SET eingeloest_nr = '', eingeloest_am = '' WHERE code = ? AND eingeloest_nr = ?").bind(g.code, nr).run();
      throw new Fehler(bezahlt.fehler);
    }
  }
  const b = {
    nr, kunde_id: kundeId, email: kunde?.email || mail, modus, kunde: k, ...r,
    zahlart: d.zahlart, status: bezahlt ? "bezahlt" : "eingegangen", datum: jetzt(),
    paypal_id: bezahlt ? text(d.paypal_id, 40) : "", transaktion: bezahlt?.transaktion || "",
  };
  await env.DB.prepare(`INSERT INTO bestellungen (nr, kunde_id, email, modus, kunde, positionen, netto, mwst, brutto, zahlart, status, paypal_id, transaktion, datum, aktualisiert)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(b.nr, b.kunde_id, b.email, b.modus, JSON.stringify(b.kunde), JSON.stringify(b.positionen), b.netto, b.mwst, b.brutto,
          b.zahlart, b.status, b.paypal_id, b.transaktion, b.datum, b.datum).run();
  benachrichtigen(env, ctx, b);
  return { nr: b.nr, email: b.email, sitzung };
}

// Überweisung (Vorkasse)
export async function bestellen(env, ctx, d, kunde) {
  if (SOFORT.includes(d.zahlart)) throw new Fehler("Bitte bezahlen Sie über die Knöpfe unten.");
  const v = await vorbereiten(env, d, kunde);
  return speichern(env, ctx, d, kunde, v, bestellnummer());
}

function benachrichtigen(env, ctx, b) {
  ctx.waitUntil(Promise.all([
    // Bestätigung zuerst, bei Vorkasse danach die Bankverbindung als eigene kurze Mail
    senden(env, b.email, `Ihre Bestellung ${b.nr} bei Domo Gastro`, kundenmail(env, b), { anhaenge: rechtsAnhaenge(b) })
      .then(() => b.zahlart === "Vorkasse" && senden(env, b.email, `Zahlungsinformationen zu Ihrer Bestellung ${b.nr}`, zahlungsmail(env, b))),
    senden(env, env.BESTELL_EMAIL, `Bestellung ${b.nr} (${b.modus}) ${b.zahlart}`, vertriebsmail(env, b)),
  ]));
}

function ausZeile(z) {
  return { ...z, kunde: JSON.parse(z.kunde), positionen: JSON.parse(z.positionen) };
}

/* ---------- Sofortbezahlen: Kreditkarte oder PayPal ---------- */
export async function ustidAnfrage(env, d) {
  const land = landVon(LAENDER, String(d.land || ""));
  if (!land || !land.eu || land.c === "DE") return { gueltig: false, fehler: "Steuerfrei nur bei Lieferung in ein anderes EU-Land." };
  const u = await ustidPruefen(env, text(d.ustid, 30), land);
  return { gueltig: u.gueltig, name: u.nachweis?.name || "", fehler: u.fehler || "" };
}

export function bezahlenInfo(env) {
  return paypal.aktiv(env) ? { aktiv: true, client_id: env.PAYPAL_CLIENT_ID } : { aktiv: false };
}

export async function bezahlenStart(env, d, kunde, abruf = fetch) {
  if (!SOFORT.includes(d.zahlart)) throw new Fehler("Bitte eine Zahlungsart wählen.");
  const v = await vorbereiten(env, d, kunde);
  return paypal.anlegen(env, { nr: bestellnummer(), brutto: v.r.brutto, abdruck: v.abdruck }, abruf);
}

export async function bezahlenAbschluss(env, ctx, d, kunde, abruf = fetch) {
  const id = text(d.paypal_id, 40);
  // Doppelt abgeschickt (z. B. Netzaussetzer): vorhandene Bestellung zurückgeben, nichts doppelt einziehen
  const da = id && await env.DB.prepare("SELECT nr, email FROM bestellungen WHERE paypal_id = ?").bind(id).first();
  if (da) return { nr: da.nr, email: da.email };
  if (!SOFORT.includes(d.zahlart)) throw new Fehler("Bitte eine Zahlungsart wählen.");
  const v = await vorbereiten(env, d, kunde);
  const p = await paypal.pruefen(env, id, { brutto: v.r.brutto, abdruck: v.abdruck }, abruf);
  if (p.fehler) throw new Fehler(p.fehler);
  return speichern(env, ctx, d, kunde, v, p.nr, () => paypal.einziehen(env, id, abruf));
}

export async function status(env, d) {
  const z = await env.DB.prepare("SELECT * FROM bestellungen WHERE nr = ?").bind(text(d.nr, 30).toUpperCase()).first();
  // Gleiche Meldung bei falscher Nummer und falscher Adresse
  if (!z || !gleich(z.email, String(d.email || "").trim().toLowerCase())) throw new Fehler("Keine Bestellung mit dieser Nummer und E-Mail-Adresse gefunden.", 404);
  return { ...oeffentlich(z), widerrufe: await widerrufeVon(env, z.nr) };
}

/* ---------- Bewertungen ---------- */
// Lenn 2026-11-24: Jeder kann bewerten, ohne Gutschein. Ohne Konto erscheint die Bewertung erst nach Klick auf einen Bestätigungslink per E-Mail.
// „Verifizierter Kauf“, wenn dieses Produkt mit demselben Konto bzw. derselben E-Mail-Adresse gekauft und bezahlt wurde.
const BEZAHLT = "status IN ('bezahlt', 'in_bearbeitung', 'versendet', 'zugestellt')";
const enthaelt = (zeilen, skus) => zeilen.some((z) => JSON.parse(z.positionen).some((p) => skus.includes(p.sku)));
async function gekauft(env, kundeId, skus) {
  return enthaelt((await env.DB.prepare(`SELECT positionen FROM bestellungen WHERE kunde_id = ? AND ${BEZAHLT}`).bind(kundeId).all()).results, skus);
}
async function gekauftMail(env, mail, skus) {
  return enthaelt((await env.DB.prepare(`SELECT positionen FROM bestellungen WHERE email = ? AND ${BEZAHLT}`).bind(mail).all()).results, skus);
}

// darf: "ja" (angemeldet, Formular ohne Name/E-Mail) | "offen" (Gast: Formular mit Vorname und E-Mail) | "schon_bewertet"
async function darfBewerten(env, kunde, slug) {
  if (!kunde) return "offen";
  if (await env.DB.prepare("SELECT id FROM bewertungen WHERE produkt = ? AND kunde_id = ?").bind(slug, kunde.id).first()) return "schon_bewertet";
  return "ja";
}

export async function bewertungenLesen(env, slug, kunde = null) {
  const p = text(slug, 120);
  // Öffentlich: nur wie viele Personen wie viele Sterne gegeben haben. Einzeln (mit Namen) erscheinen nur Bewertungen mit Kommentar.
  const v = await env.DB.prepare("SELECT sterne, COUNT(*) AS n FROM bewertungen WHERE produkt = ? AND freigegeben = 1 GROUP BY sterne").bind(p).all();
  const verteilung = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const z of v.results) verteilung[z.sterne] = z.n;
  const anzahl = Object.values(verteilung).reduce((s, n) => s + n, 0);
  const schnitt = anzahl ? Object.entries(verteilung).reduce((s, [k, n]) => s + k * n, 0) / anzahl : 0;
  const r = await env.DB.prepare(`SELECT name, sterne, titel, text, verifiziert, datum,
      EXISTS (SELECT 1 FROM gutscheine g WHERE g.bewertung_id = bewertungen.id) AS belohnt
    FROM bewertungen WHERE produkt = ? AND freigegeben = 1 AND (titel <> '' OR text <> '') ORDER BY datum DESC LIMIT 100`)
    .bind(p).all();
  return { anzahl, schnitt: Math.round(schnitt * 10) / 10, verteilung, liste: r.results, darf: KATALOG.produkte[p] ? await darfBewerten(env, kunde, p) : "nein" };
}

function bewertungDaten(d) {
  const slug = text(d.produkt, 120);
  const skus = KATALOG.produkte[slug];
  if (!skus) throw new Fehler("Produkt nicht gefunden.", 404);
  const sterne = parseInt(d.sterne, 10);
  if (!(sterne >= 1 && sterne <= 5)) throw new Fehler("Bitte 1 bis 5 Sterne wählen.");
  return { slug, skus, sterne, titel: text(d.titel, 80), inhalt: text(d.text, 2000) };  // Überschrift und Text freiwillig
}

// Angemeldet: erscheint sofort
export async function bewerten(env, ctx, kunde, d) {
  const { slug, skus, sterne, titel, inhalt } = bewertungDaten(d);
  const teile = (kunde.name || "Kunde").trim().split(/\s+/);
  const name = teile.length > 1 ? `${teile[0]} ${teile[teile.length - 1][0]}.` : teile[0];
  try {
    await env.DB.prepare("INSERT INTO bewertungen (produkt, kunde_id, name, sterne, titel, text, verifiziert, freigegeben, datum) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)")
      .bind(slug, kunde.id, name, sterne, titel, inhalt, (await gekauft(env, kunde.id, skus)) ? 1 : 0, jetzt()).run();
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new Fehler("Sie haben dieses Produkt schon bewertet.", 409);
    throw err;
  }
  // Keine Mail an uns bei neuen Bewertungen (Lenn 2026-11-18); Übersicht und Löschen in /verwaltung/
  return { ok: true, sichtbar: true, mail: kunde.email };
}

// Link aus der Bewertungs-Erinnerung: beweist den Kauf ohne Konto (Bestellnummer + Prüfwert, nur wir können ihn erzeugen)
export async function kaufSchluessel(env, nr) {
  return (await sha256(`bewertung:${nr}:${env.VERWALTUNG_SCHLUESSEL || ""}`)).slice(0, 32);
}

// Ohne Konto (Lenn 2026-11-24: ohne E-Mail-Bestätigung, erscheint sofort). Vorname und E-Mail Pflicht, E-Mail nie öffentlich.
// Spamschutz, den Kunden nicht merken: verstecktes Feld (Honigtopf), mindestens 5 Sekunden zwischen Seitenaufruf und Absenden,
// höchstens 3 Bewertungen je IP und Tag, eine Bewertung je E-Mail und Produkt.
// „Verifizierter Kauf“ ohne Konto nur über den persönlichen Link aus der Erinnerungsmail: Eine eingetippte E-Mail-Adresse beweist nichts.
export const BEWERTUNGEN_JE_IP_UND_TAG = 3;
export async function bewertenOffen(env, d, ip = "") {
  if (text(d.website, 200)) return { ok: true, sichtbar: true };      // Bot hat das versteckte Feld ausgefüllt: still verwerfen
  if (!(Number(d.dauer) >= 5000)) throw new Fehler("Bitte prüfen Sie Ihre Angaben und senden Sie die Bewertung noch einmal ab.");
  const { slug, skus, sterne, titel, inhalt } = bewertungDaten(d);
  const name = text(d.name, 40);
  if (!name) throw new Fehler("Bitte Ihren Vornamen angeben.");
  let mail = "", verifiziert = 0;
  const nr = text(d.bestellung, 30).toUpperCase();
  if (nr && gleich(text(d.k, 40), await kaufSchluessel(env, nr))) {
    const z = await env.DB.prepare(`SELECT email, positionen FROM bestellungen WHERE nr = ? AND ${BEZAHLT}`).bind(nr).first();
    if (z && enthaelt([z], skus)) { verifiziert = 1; mail = z.email; }
  }
  if (!mail) {
    if (nr && !text(d.email)) throw new Fehler("Den Kauf konnten wir über diesen Link nicht bestätigen. Bitte geben Sie Ihre E-Mail-Adresse an.");
    mail = email(d.email);
  }
  if (await env.DB.prepare("SELECT 1 FROM bewertung_mail WHERE produkt = ? AND email = ?").bind(slug, mail).first())
    throw new Fehler("Mit dieser E-Mail-Adresse wurde dieses Produkt schon bewertet.", 409);
  // IP nur als Tages-Prüfwert (mit Datum gehasht), wird täglich gelöscht
  const tag = jetzt().slice(0, 10), iph = await sha256(`${tag}:${ip}`);
  if ((await env.DB.prepare("SELECT COUNT(*) AS n FROM bewertung_ip WHERE ip = ? AND tag = ?").bind(iph, tag).first()).n >= BEWERTUNGEN_JE_IP_UND_TAG)
    throw new Fehler("Heute sind von hier aus schon mehrere Bewertungen eingegangen. Bitte versuchen Sie es morgen noch einmal.", 429);
  await env.DB.prepare("INSERT INTO bewertung_ip (ip, tag) VALUES (?, ?)").bind(iph, tag).run();
  const id = (await env.DB.prepare("INSERT INTO bewertungen (produkt, kunde_id, name, sterne, titel, text, verifiziert, freigegeben, datum) VALUES (?, NULL, ?, ?, ?, ?, ?, 1, ?)")
    .bind(slug, name, sterne, titel, inhalt, verifiziert, jetzt()).run()).meta.last_row_id;
  try {
    await env.DB.prepare("INSERT INTO bewertung_mail (bewertung_id, produkt, email, erstellt) VALUES (?, ?, ?, ?)").bind(id, slug, mail, jetzt()).run();
  } catch (err) {
    await env.DB.prepare("DELETE FROM bewertungen WHERE id = ?").bind(id).run();
    if (String(err).includes("UNIQUE")) throw new Fehler("Mit dieser E-Mail-Adresse wurde dieses Produkt schon bewertet.", 409);
    throw err;
  }
  return { ok: true, sichtbar: true, verifiziert: Boolean(verifiziert), mail };
}

export async function bewertungIpAufraeumen(env) {
  await env.DB.prepare("DELETE FROM bewertung_ip WHERE tag < ?").bind(jetzt().slice(0, 10)).run();
}

/* ---------- Verwaltung (nur mit VERWALTUNG_SCHLUESSEL) ---------- */
export async function verwaltungPruefen(env, request) {
  const s = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.VERWALTUNG_SCHLUESSEL || !s || !gleich(await sha256(s), await sha256(env.VERWALTUNG_SCHLUESSEL))) throw new Fehler("Falscher Schlüssel.", 401);
}

export async function verwaltungListe(env) {
  const b = await env.DB.prepare("SELECT * FROM bestellungen ORDER BY datum DESC LIMIT 200").all();
  // Für Lenn zum Erkennen von Fakes: verifizierter Kauf, E-Mail (Konto oder bestätigte Adresse), Datum
  const r = await env.DB.prepare(`SELECT b.id, b.produkt, b.name, b.sterne, b.titel, b.text, b.datum, b.verifiziert,
      COALESCE(m.email, k.email, '') AS email, CASE WHEN m.email IS NOT NULL THEN 'mail' WHEN b.kunde_id IS NOT NULL THEN 'konto' ELSE '' END AS herkunft
    FROM bewertungen b LEFT JOIN bewertung_mail m ON m.bewertung_id = b.id LEFT JOIN kunden k ON k.id = b.kunde_id
    ORDER BY b.datum DESC LIMIT 300`).all();
  const w = await env.DB.prepare("SELECT * FROM widerrufe ORDER BY id DESC LIMIT 300").all();
  const wNach = {};
  for (const x of w.results) (wNach[x.nr] ||= []).unshift({ ...x, positionen: JSON.parse(x.positionen) });
  return { bestellungen: b.results.map((z) => ({ ...oeffentlich(z), email: z.email, kunde: JSON.parse(z.kunde), transaktion: z.transaktion, widerrufe: wNach[z.nr] || [] })), bewertungen: r.results,
    gutscheine: await gutscheinStatistik(env, "DG5-"), newsletter_gutscheine: await gutscheinStatistik(env, NL_PRAEFIX) };
}

// Wie viele Gutscheine wurden vergeben/eingelöst, und was haben die Bestellungen damit eingebracht (ohne Stornos)?
// praefix: "DG5-" = Dank für Bewertung, "DGN-" = Newsletter-Willkommen
async function gutscheinStatistik(env, praefix = "DG5-") {
  const v = await env.DB.prepare("SELECT COUNT(*) AS vergeben, SUM(eingeloest_nr <> '') AS eingeloest FROM gutscheine WHERE code LIKE ?").bind(praefix + "%").first();
  const summe = (bedingung) => env.DB.prepare(`SELECT COUNT(*) AS anzahl, COALESCE(SUM(b.brutto), 0) AS brutto, COALESCE(SUM(b.netto), 0) AS netto,
      COALESCE(SUM(json_extract(b.kunde, '$.gutschein.rabatt')), 0) AS rabatt
    FROM bestellungen b JOIN gutscheine g ON g.eingeloest_nr = b.nr WHERE g.code LIKE ? AND ${bedingung}`).bind(praefix + "%").first();
  return {
    vergeben: v.vergeben || 0, eingeloest: v.eingeloest || 0,
    alle: await summe("b.status <> 'storniert'"),
    bezahlt: await summe("b.status IN ('bezahlt', 'in_bearbeitung', 'versendet', 'zugestellt')"),
  };
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

/* ---------- Gutscheine ---------- */
function gutscheinCode(v) {
  return text(v, 30).toUpperCase().replace(/\s+/g, "");
}
// Lenn 2026-11-21: Rabattaktionen sind nicht kombinierbar. Während einer Preisaktion (Black Week) kein Gutschein; der Code bleibt gültig.
function keineAktion(jetzt = Date.now()) {
  const a = aktionAktiv(AKTION, jetzt);
  if (a) throw new Fehler(`Gutscheine sind nicht mit der Aktion „${a.name}“ (${a.prozent} % auf alles) kombinierbar. Ihr Code bleibt gültig und ist ab ${a.bis_text ? "dem Ende der Aktion (" + a.bis_text + ")" : "dem Ende der Aktion"} wieder einlösbar.`);
}
async function gutscheinLesen(env, code) {
  keineAktion();
  const g = await env.DB.prepare("SELECT code, prozent, eingeloest_nr FROM gutscheine WHERE code = ?").bind(code).first();
  if (!g) throw new Fehler("Diesen Gutscheincode kennen wir nicht. Bitte prüfen Sie die Schreibweise.");
  if (g.eingeloest_nr) throw new Fehler("Dieser Gutscheincode wurde bereits eingelöst.");
  return g;
}
export async function gutscheinPruefen(env, d) {
  const g = await gutscheinLesen(env, gutscheinCode(d.code));
  return { code: g.code, prozent: g.prozent, ...(g.code.startsWith(NL_PRAEFIX) && mindestwert() ? { mindestwert: mindestwert() } : {}) };
}

/* ---------- Bitte um Bewertung (einmal je Bestellung) ---------- */
const TAG = 86400000;
async function bewertungsanfrageVormerken(env, z, status) {
  if (status === "storniert") {
    await env.DB.prepare("DELETE FROM bewertungsanfragen WHERE nr = ? AND gesendet = ''").bind(z.nr).run();
    // Gutschein einer stornierten Bestellung wieder freigeben
    await env.DB.prepare("UPDATE gutscheine SET eingeloest_nr = '', eingeloest_am = '' WHERE eingeloest_nr = ?").bind(z.nr).run();
    return;
  }
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
      if (produkte.length && await senden(env, b.email, "Wie zufrieden sind Sie mit Ihrer Bestellung?", bewertungsmail(env, b, produkte, await kaufSchluessel(env, b.nr)))) ergebnis = jetzt();
      // Versand fehlgeschlagen: morgen erneut versuchen, aber höchstens 14 Tage lang
      else if (produkte.length && Date.parse(faellig) > Date.now() - 14 * TAG) continue;
    }
    await env.DB.prepare("UPDATE bewertungsanfragen SET gesendet = ? WHERE nr = ?").bind(ergebnis, nr).run();
  }
}

export async function verwaltungBewertung(env, d) {
  const id = parseInt(d.id, 10);
  if (d.freigeben) await env.DB.prepare("UPDATE bewertungen SET freigegeben = 1 WHERE id = ?").bind(id).run();
  else {
    await env.DB.prepare("DELETE FROM bewertungen WHERE id = ?").bind(id).run();
    await env.DB.prepare("DELETE FROM bewertung_mail WHERE bewertung_id = ?").bind(id).run();
  }
  return { ok: true };
}
