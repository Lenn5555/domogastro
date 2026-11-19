// Bestellung, Bestellstatus, Bewertungen und Verwaltung (Status setzen, Bewertungen freigeben).
import KATALOG from "./katalog.json" with { type: "json" };
import { Fehler, text, email, jetzt, runden, zufall, sha256, gleich } from "./hilfe.js";
import { anlegen as kontoAnlegen, oeffentlich } from "./konto.js";
import { senden, kundenmail, vertriebsmail, statusmail, bewertungsmail, gutscheinmail, zahlungsmail, rechtsAnhaenge } from "./mail.js";
import * as paypal from "./paypal.js";

export const MWST = 0.19;
export const GUTSCHEIN_PROZENT = 5;
const ZAHLARTEN = ["Vorkasse", "Kreditkarte", "PayPal"];
const SOFORT = ["Kreditkarte", "PayPal"]; // beide laufen über PayPal
export const STATI = ["eingegangen", "zahlung_offen", "bezahlt", "in_bearbeitung", "versendet", "zugestellt", "storniert"];

function bestellnummer() {
  const d = new Date();
  const tag = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `DG-${tag}-${zufall(3).toUpperCase()}`;
}

// Preise kommen nur aus dem Katalog des Servers, nie aus dem Browser. prozent = Gutschein-Rabatt auf den Warenwert.
export function rechnen(positionen, prozent = 0) {
  if (!Array.isArray(positionen) || !positionen.length) throw new Fehler("Der Warenkorb ist leer.");
  if (positionen.length > 50) throw new Fehler("Zu viele Positionen.");
  const pos = positionen.map((p) => {
    const a = KATALOG.artikel[String(p.sku)];
    const menge = parseInt(p.menge, 10);
    if (!a || !a.p) throw new Fehler(`Artikel ${text(p.sku, 40)} ist nicht bestellbar.`);
    if (!(menge >= 1 && menge <= 99)) throw new Fehler("Ungültige Menge.");
    return { sku: String(p.sku), name: a.n, slug: a.s, menge, netto: a.p };
  });
  const warenwert = runden(pos.reduce((s, p) => s + p.netto * p.menge, 0));
  const rabatt = runden(warenwert * prozent / 100);
  const netto = runden(warenwert - rabatt);
  const mwst = runden(netto * MWST);
  return { positionen: pos, warenwert, rabatt, netto, mwst, brutto: runden(netto + mwst) };
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
  const r = rechnen(d.positionen, g ? g.prozent : 0);
  // Der Browser zeigt den Betrag vor dem Absenden an; weicht er ab (z. B. Preisänderung), lieber neu bestätigen lassen
  if (d.gesamt_brutto != null && Math.abs(Number(d.gesamt_brutto) - r.brutto) > 0.01)
    throw new Fehler("Die Preise haben sich geändert. Bitte laden Sie den Warenkorb neu und prüfen Sie den Betrag.", 409);
  // Fingerabdruck für PayPal: dieselben Daten beim Start und beim Abschluss
  const abdruck = await paypal.fingerabdruck([modus, mail, k, r.positionen.map((p) => [p.sku, p.menge]), g?.code || "", d.zahlart,
    kunde?.id || "", Boolean(d.konto_anlegen), Boolean(d.bewertungsmail)]);
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
  const r = await env.DB.prepare(`SELECT name, sterne, titel, text, verifiziert, datum,
      EXISTS (SELECT 1 FROM gutscheine g WHERE g.bewertung_id = bewertungen.id) AS belohnt
    FROM bewertungen WHERE produkt = ? AND freigegeben = 1 AND (titel <> '' OR text <> '') ORDER BY datum DESC LIMIT 100`)
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
  let bewertungId;
  try {
    bewertungId = (await env.DB.prepare("INSERT INTO bewertungen (produkt, kunde_id, name, sterne, titel, text, freigegeben, datum) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
      .bind(slug, kunde.id, name, sterne, titel, inhalt, jetzt()).run()).meta.last_row_id;
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new Fehler("Sie haben dieses Produkt schon bewertet.", 409);
    throw err;
  }
  // Keine Mail an uns bei neuen Bewertungen (Lenn 2026-11-18); Übersicht in /verwaltung/
  // Dankeschön für JEDE Bewertung, unabhängig von den Sternen: persönlicher 5-%-Code per Mail
  const code = `DG5-${gutscheinZufall()}`;
  await env.DB.prepare("INSERT INTO gutscheine (code, kunde_id, bewertung_id, prozent, erstellt) VALUES (?, ?, ?, ?, ?)")
    .bind(code, kunde.id, bewertungId, GUTSCHEIN_PROZENT, jetzt()).run();
  ctx.waitUntil(senden(env, kunde.email, `Danke für Ihre Bewertung – Ihr ${GUTSCHEIN_PROZENT}-%-Gutschein`, gutscheinmail(env, kunde.name || "liebe Kundin, lieber Kunde", code, GUTSCHEIN_PROZENT)));
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
  return { bestellungen: b.results.map((z) => ({ ...oeffentlich(z), email: z.email, kunde: JSON.parse(z.kunde), transaktion: z.transaktion })), bewertungen: r.results,
    gutscheine: await gutscheinStatistik(env) };
}

// Wie viele Bewertungs-Gutscheine wurden vergeben/eingelöst, und was haben die Bestellungen damit eingebracht (ohne Stornos)?
async function gutscheinStatistik(env) {
  const v = await env.DB.prepare("SELECT COUNT(*) AS vergeben, SUM(eingeloest_nr <> '') AS eingeloest FROM gutscheine").first();
  const summe = (bedingung) => env.DB.prepare(`SELECT COUNT(*) AS anzahl, COALESCE(SUM(b.brutto), 0) AS brutto, COALESCE(SUM(b.netto), 0) AS netto,
      COALESCE(SUM(json_extract(b.kunde, '$.gutschein.rabatt')), 0) AS rabatt
    FROM bestellungen b JOIN gutscheine g ON g.eingeloest_nr = b.nr WHERE ${bedingung}`).first();
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
const ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";  // ohne 0/O, 1/I
function gutscheinZufall(n = 8) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => ZEICHEN[x % ZEICHEN.length]).join("");
}
function gutscheinCode(v) {
  return text(v, 30).toUpperCase().replace(/\s+/g, "");
}
async function gutscheinLesen(env, code) {
  const g = await env.DB.prepare("SELECT code, prozent, eingeloest_nr FROM gutscheine WHERE code = ?").bind(code).first();
  if (!g) throw new Fehler("Diesen Gutscheincode kennen wir nicht. Bitte prüfen Sie die Schreibweise.");
  if (g.eingeloest_nr) throw new Fehler("Dieser Gutscheincode wurde bereits eingelöst.");
  return g;
}
export async function gutscheinPruefen(env, d) {
  const g = await gutscheinLesen(env, gutscheinCode(d.code));
  return { code: g.code, prozent: g.prozent };
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
