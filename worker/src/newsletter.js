// Newsletter mit Double-Opt-in (Lenn 2026-11-24): Anmeldung zählt erst nach Klick auf den Bestätigungslink.
// Nachweis (§ 7 Abs. 2 UWG, Art. 7 Abs. 1 DSGVO): Zeitpunkt und IP von Anmeldung und Bestätigung sowie der Wortlaut der Einwilligung.
// Nach der ersten Bestätigung einmalig ein persönlicher Code DGN-… (nur einer je Mailadresse, auch nach Ab- und Wiederanmeldung).
// Einen Dienst für den eigentlichen Newsletter-Versand gibt es noch nicht; die Verwaltung exportiert die bestätigten Adressen als CSV.
import NL from "../../daten/newsletter.json" with { type: "json" };
import AKTION from "../../daten/aktion.json" with { type: "json" };
import { Fehler, text, email, jetzt, zufall, sha256 } from "./hilfe.js";
import { senden } from "./mail.js";
import { aktionAktiv } from "./steuer.js";

export const PRAEFIX = "DGN-";
const TAG = 86400000;
const LINK_GUELTIG = 7 * TAG;          // Bestätigungslink
const ERNEUT_FRUEHESTENS = 10 * 60000; // gleiche Adresse: höchstens alle 10 Minuten eine Bestätigungsmail
const ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeZufall = (n = 8) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => ZEICHEN[x % ZEICHEN.length]).join("");
const euroText = (x) => x.toFixed(2).replace(".", ",") + " €";

export const mindestwert = () => Number(NL.mindestwert_netto) || 0;

// Für die Kasse: Code aus dem Newsletter, aber Warenwert zu niedrig?
export function mindestwertFehler(code, warenwert) {
  const m = mindestwert();
  if (!String(code).startsWith(PRAEFIX) || !m || warenwert >= m) return "";
  return `Der Newsletter-Gutschein gilt ab ${euroText(m)} Warenwert (netto). Es fehlen noch ${euroText(Math.round((m - warenwert) * 100) / 100)}.`;
}

function abmeldeLink(env, s) { return `${env.SITE_URL}/newsletter/?abmelden=${s}`; }
function kopf(env, s, api) {
  // RFC 8058: Mailprogramme zeigen „Abmelden“ und melden mit einem Klick direkt beim Server ab
  return { "List-Unsubscribe": `<${api}/newsletter/ein-klick?s=${s}>, <mailto:${env.BESTELL_EMAIL}?subject=Newsletter%20abmelden>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
const fuss = (env, s) => `\n\n—\nSie möchten keine E-Mails mehr von uns? Abmelden mit einem Klick: ${abmeldeLink(env, s)}`;

export function bestaetigungsmail(env, token, s) {
  return `Guten Tag,

Sie (oder jemand mit Ihrer E-Mail-Adresse) möchten den Newsletter von Domo Gastro erhalten. Bitte bestätigen Sie das mit einem Klick:

${env.SITE_URL}/newsletter/?bestaetigen=${token}

Erst nach der Bestätigung tragen wir Sie ein und schicken Ihnen Ihren persönlichen ${NL.prozent}-%-Gutscheincode. Der Link gilt 7 Tage.

Sie haben sich nicht angemeldet? Dann ignorieren Sie diese E-Mail einfach; Sie bekommen dann keine weiteren E-Mails von uns.

Freundliche Grüße
Ihr Domo-Gastro-Team${fuss(env, s)}`;
}

export function codemail(env, code, s, jetztMs = Date.now()) {
  const a = aktionAktiv(AKTION, jetztMs);
  const m = mindestwert();
  return `Guten Tag,

danke für Ihre Anmeldung! Ab jetzt bekommen Sie von uns Angebote, Neuheiten und Tipps rund um Gastronomie-Ausstattung, ${NL.haeufigkeit}.

Ihr persönlicher Willkommensrabatt: ${NL.prozent} % auf Ihre nächste Bestellung
Gutscheincode: ${code}

So lösen Sie ihn ein: Geben Sie den Code im Warenkorb unter „Gutscheincode“ ein. Er gilt einmal, für den gesamten Warenwert einer Bestellung${m ? ` ab ${euroText(m)} Warenwert (netto)` : ""}, und ist nicht mit anderen Gutscheinen oder laufenden Rabattaktionen kombinierbar. Eine Barauszahlung ist nicht möglich.${a ? `\n\nGerade läuft unsere Aktion „${a.name}“ mit ${a.prozent} % auf alles. Ihr Code ist ab ${a.bis_text ? `dem Ende der Aktion (${a.bis_text})` : "dem Ende der Aktion"} einlösbar und verfällt nicht.` : ""}

Zum Shop: ${env.SITE_URL}/

Freundliche Grüße
Ihr Domo-Gastro-Team${fuss(env, s)}`;
}

// quelle: "fuss" (Feld unten auf jeder Seite) oder "kasse" (Häkchen beim Bestellen). api: öffentliche Adresse dieses Servers (für den Ein-Klick-Abmeldelink)
export async function anmelden(env, d, { ip = "", quelle = "fuss", api = "" } = {}) {
  if (d?.einwilligung !== true) throw new Fehler("Bitte bestätigen Sie, dass Sie den Newsletter erhalten möchten.");
  const mail = email(d.email);
  const q = quelle === "kasse" ? "kasse" : "fuss";
  const z = await env.DB.prepare("SELECT * FROM newsletter WHERE email = ?").bind(mail).first();
  // Gleiche Antwort in jedem Fall: Ob jemand schon eingetragen ist, verraten wir nicht.
  const antwort = { ok: true };
  if (z?.status === "bestaetigt") return antwort;
  if (z?.status === "offen" && Date.now() - Date.parse(z.angemeldet) < ERNEUT_FRUEHESTENS) return antwort;
  const token = zufall(24), s = z?.abmelde_schluessel || zufall(16), t = jetzt();
  await env.DB.prepare(`INSERT INTO newsletter (email, status, quelle, einwilligung, angemeldet, anmelde_ip, bestaetigen_hash, bestaetigen_bis, abmelde_schluessel)
      VALUES (?1, 'offen', ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(email) DO UPDATE SET status = 'offen', quelle = ?2, einwilligung = ?3, angemeldet = ?4, anmelde_ip = ?5, bestaetigen_hash = ?6, bestaetigen_bis = ?7,
      bestaetigt = '', bestaetigt_ip = ''`)
    .bind(mail, q, NL.einwilligung, t, text(ip, 60), await sha256(token), Date.now() + LINK_GUELTIG, s).run();
  await senden(env, mail, "Bitte bestätigen: Newsletter von Domo Gastro", bestaetigungsmail(env, token, s), api ? { kopf: kopf(env, s, api) } : {});
  return antwort;
}

export async function bestaetigen(env, d, { ip = "", api = "" } = {}) {
  const token = text(d?.token, 100);
  if (!/^[0-9a-f]{48}$/.test(token)) throw new Fehler("Dieser Bestätigungslink ist ungültig.");
  const z = await env.DB.prepare("SELECT * FROM newsletter WHERE bestaetigen_hash = ?").bind(await sha256(token)).first();
  if (!z) throw new Fehler("Dieser Bestätigungslink ist ungültig oder wurde durch eine neuere Anmeldung ersetzt. Bitte melden Sie sich erneut an.", 404);
  if (z.status === "bestaetigt") return { ok: true, schon: true };
  if (z.status !== "offen") throw new Fehler("Sie haben sich inzwischen abgemeldet. Wenn Sie den Newsletter doch möchten, melden Sie sich bitte erneut an.", 410);
  if (z.bestaetigen_bis < Date.now()) throw new Fehler("Dieser Bestätigungslink ist abgelaufen (7 Tage). Bitte melden Sie sich erneut an.", 410);
  await env.DB.prepare("UPDATE newsletter SET status = 'bestaetigt', bestaetigt = ?, bestaetigt_ip = ?, abgemeldet = '' WHERE email = ? AND status = 'offen'")
    .bind(jetzt(), text(ip, 60), z.email).run();
  // Nur ein Code je Adresse, auch bei gleichzeitigen Klicks: erst die Zeile reservieren, dann den Gutschein anlegen
  const code = PRAEFIX + codeZufall();
  const u = await env.DB.prepare("UPDATE newsletter SET code = ? WHERE email = ? AND code = ''").bind(code, z.email).run();
  if (!u.meta.changes) return { ok: true, code: false };
  await env.DB.prepare("INSERT INTO gutscheine (code, kunde_id, bewertung_id, prozent, erstellt) VALUES (?, NULL, NULL, ?, ?)").bind(code, NL.prozent, jetzt()).run();
  const ok = await senden(env, z.email, `Willkommen bei Domo Gastro – Ihr ${NL.prozent}-%-Gutschein`, codemail(env, code, z.abmelde_schluessel), api ? { kopf: kopf(env, z.abmelde_schluessel, api) } : {});
  if (ok) await env.DB.prepare("UPDATE newsletter SET mail_gesendet = ? WHERE email = ?").bind(jetzt(), z.email).run();
  return { ok: true, code: true };
}

export async function abmelden(env, schluessel) {
  const s = text(schluessel, 64);
  if (!/^[0-9a-f]{32}$/.test(s)) throw new Fehler("Dieser Abmeldelink ist ungültig.");
  const z = await env.DB.prepare("SELECT email, status FROM newsletter WHERE abmelde_schluessel = ?").bind(s).first();
  if (!z) throw new Fehler("Diesen Abmeldelink kennen wir nicht. Schreiben Sie uns gern an sales@ts-systec.de, dann tragen wir Sie von Hand aus.", 404);
  if (z.status !== "abgemeldet")
    await env.DB.prepare("UPDATE newsletter SET status = 'abgemeldet', abgemeldet = ?, bestaetigen_hash = '' WHERE email = ?").bind(jetzt(), z.email).run();
  return { ok: true };
}

// Täglich: unbestätigte Anmeldungen nach 30 Tagen löschen (Datensparsamkeit). Wer schon einen Code bekam, bleibt als „abgemeldet“ stehen (ein Code je Adresse).
export async function aufraeumen(env) {
  const grenze = new Date(Date.now() - 30 * TAG).toISOString();
  await env.DB.prepare("DELETE FROM newsletter WHERE status = 'offen' AND code = '' AND angemeldet < ?").bind(grenze).run();
  await env.DB.prepare("UPDATE newsletter SET status = 'abgemeldet', bestaetigen_hash = '' WHERE status = 'offen' AND angemeldet < ?").bind(grenze).run();
}

export async function verwaltungListe(env) {
  const r = await env.DB.prepare(`SELECT n.email, n.quelle, n.angemeldet, n.anmelde_ip, n.bestaetigt, n.bestaetigt_ip, n.einwilligung, n.code,
      COALESCE(g.eingeloest_nr, '') AS eingeloest_nr
    FROM newsletter n LEFT JOIN gutscheine g ON g.code = n.code WHERE n.status = 'bestaetigt' ORDER BY n.bestaetigt DESC`).all();
  const z = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM newsletter GROUP BY status").all();
  const anzahl = { offen: 0, bestaetigt: 0, abgemeldet: 0 };
  for (const x of z.results) anzahl[x.status] = x.n;
  return { liste: r.results, anzahl, mindestwert: mindestwert(), prozent: NL.prozent };
}
