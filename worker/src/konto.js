// Kundenkonto: registrieren, anmelden, abmelden, Passwort zurücksetzen, Daten ändern, löschen.
import { Fehler, sha256, zufall, passwortHash, gleich, text, email, jetzt } from "./hilfe.js";
import { senden } from "./mail.js";

const SITZUNG_TAGE = 30;
const FELDER = ["name", "firma", "ustid", "strasse", "plz", "ort", "telefon"];

function passwortPruefen(pw) {
  if (typeof pw !== "string" || pw.length < 10) throw new Fehler("Das Passwort muss mindestens 10 Zeichen lang sein.");
  if (pw.length > 200) throw new Fehler("Das Passwort ist zu lang.");
}

async function sitzungAnlegen(env, kundeId) {
  const token = zufall();
  const bis = Date.now() + SITZUNG_TAGE * 864e5;
  await env.DB.prepare("INSERT INTO sitzungen (hash, kunde_id, bis) VALUES (?, ?, ?)").bind(await sha256(token), kundeId, bis).run();
  return { token, bis };
}

export async function kundeAusAnfrage(env, request) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const s = await env.DB.prepare("SELECT kunde_id, bis FROM sitzungen WHERE hash = ?").bind(await sha256(token)).first();
  if (!s || s.bis < Date.now()) return null;
  return env.DB.prepare("SELECT * FROM kunden WHERE id = ?").bind(s.kunde_id).first();
}

export async function pflichtKunde(env, request) {
  const k = await kundeAusAnfrage(env, request);
  if (!k) throw new Fehler("Bitte melden Sie sich an.", 401);
  return k;
}

export async function anlegen(env, { email: mail, passwort, name, ...rest }) {
  const e = email(mail);
  passwortPruefen(passwort);
  if (await env.DB.prepare("SELECT id FROM kunden WHERE email = ?").bind(e).first())
    throw new Fehler("Für diese E-Mail-Adresse gibt es schon ein Konto. Bitte melden Sie sich an oder setzen Sie das Passwort zurück.", 409);
  const salz = zufall(16);
  const werte = FELDER.map((f) => text(f === "name" ? name : rest[f], 120));
  const r = await env.DB.prepare(`INSERT INTO kunden (email, ${FELDER.join(", ")}, pw_hash, pw_salz, erstellt) VALUES (?, ${FELDER.map(() => "?").join(", ")}, ?, ?, ?)`)
    .bind(e, ...werte, await passwortHash(passwort, salz), salz, jetzt()).run();
  const id = r.meta.last_row_id;
  return { id, sitzung: await sitzungAnlegen(env, id) };
}

export async function registrieren(env, d) {
  if (!d.datenschutz) throw new Fehler("Bitte bestätigen Sie die Datenschutzerklärung.");
  if (!text(d.name)) throw new Fehler("Bitte Ihren Namen angeben.");
  const { sitzung } = await anlegen(env, d);
  return { sitzung };
}

export async function anmelden(env, d) {
  const e = email(d.email);
  const k = await env.DB.prepare("SELECT * FROM kunden WHERE email = ?").bind(e).first();
  // Auch ohne Konto rechnen, damit die Antwortzeit nichts verrät
  const hash = await passwortHash(String(d.passwort || ""), k ? k.pw_salz : "kein-konto");
  if (!k || !gleich(hash, k.pw_hash)) throw new Fehler("E-Mail-Adresse oder Passwort stimmt nicht.", 401);
  return { sitzung: await sitzungAnlegen(env, k.id) };
}

export async function abmelden(env, request) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (token) await env.DB.prepare("DELETE FROM sitzungen WHERE hash = ?").bind(await sha256(token)).run();
  return { ok: true };
}

export async function passwortVergessen(env, d, ctx) {
  const e = email(d.email);
  const k = await env.DB.prepare("SELECT id, name FROM kunden WHERE email = ?").bind(e).first();
  if (k) {
    const token = zufall();
    await env.DB.prepare("INSERT INTO zuruecksetzen (hash, kunde_id, bis) VALUES (?, ?, ?)").bind(await sha256(token), k.id, Date.now() + 3600e3).run();
    const link = `${env.SITE_URL}/konto/?reset=${token}`;
    ctx.waitUntil(senden(env, e, "Passwort zurücksetzen – Domo Gastro",
      `Hallo ${k.name || ""},\n\nSie können Ihr Passwort für Domo Gastro hier neu setzen (Link gilt 1 Stunde):\n${link}\n\nHaben Sie das nicht angefordert, ignorieren Sie diese E-Mail einfach.\n\nIhr Domo-Gastro-Team`));
  }
  return { ok: true }; // immer gleiche Antwort: verrät nicht, ob es ein Konto gibt
}

export async function passwortSetzen(env, d) {
  passwortPruefen(d.passwort);
  const h = await sha256(String(d.token || ""));
  const r = await env.DB.prepare("SELECT kunde_id, bis FROM zuruecksetzen WHERE hash = ?").bind(h).first();
  if (!r || r.bis < Date.now()) throw new Fehler("Der Link ist abgelaufen. Bitte fordern Sie einen neuen an.");
  const salz = zufall(16);
  await env.DB.batch([
    env.DB.prepare("UPDATE kunden SET pw_hash = ?, pw_salz = ? WHERE id = ?").bind(await passwortHash(d.passwort, salz), salz, r.kunde_id),
    env.DB.prepare("DELETE FROM zuruecksetzen WHERE kunde_id = ?").bind(r.kunde_id),
    env.DB.prepare("DELETE FROM sitzungen WHERE kunde_id = ?").bind(r.kunde_id),
  ]);
  return { sitzung: await sitzungAnlegen(env, r.kunde_id) };
}

export async function lesen(env, k) {
  const b = await env.DB.prepare("SELECT * FROM bestellungen WHERE kunde_id = ? ORDER BY datum DESC LIMIT 100").bind(k.id).all();
  const kunde = { email: k.email };
  FELDER.forEach((f) => (kunde[f] = k[f]));
  return { kunde, bestellungen: b.results.map(oeffentlich) };
}

export async function aendern(env, k, d) {
  const werte = FELDER.map((f) => text(d[f], 120));
  await env.DB.prepare(`UPDATE kunden SET ${FELDER.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`).bind(...werte, k.id).run();
  return { ok: true };
}

// Konto löschen: Bestellungen bleiben (Aufbewahrungspflicht), werden vom Konto getrennt; Bewertungen werden anonymisiert
export async function loeschen(env, k) {
  await env.DB.batch([
    env.DB.prepare("UPDATE bestellungen SET kunde_id = NULL WHERE kunde_id = ?").bind(k.id),
    env.DB.prepare("UPDATE bewertungen SET kunde_id = NULL, name = 'Ehemaliger Kunde' WHERE kunde_id = ?").bind(k.id),
    env.DB.prepare("DELETE FROM sitzungen WHERE kunde_id = ?").bind(k.id),
    env.DB.prepare("DELETE FROM zuruecksetzen WHERE kunde_id = ?").bind(k.id),
    env.DB.prepare("DELETE FROM kunden WHERE id = ?").bind(k.id),
  ]);
  return { ok: true };
}

export function oeffentlich(b) {
  return {
    nr: b.nr, datum: b.datum, status: b.status, zahlart: b.zahlart, sendung: b.sendung, modus: b.modus,
    netto: b.netto, mwst: b.mwst, brutto: b.brutto,
    positionen: JSON.parse(b.positionen).map((p) => ({ sku: p.sku, name: p.name, menge: p.menge })),
  };
}
