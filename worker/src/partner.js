// Partnerprogramm (Lenn 2026-11-27): Jede Person mit Kundenkonto kann Partner werden, bekommt einen Link (…/?p=CODE)
// und erhält 7,5 % auf den bezahlten Warenwert NETTO (ohne MwSt. und Versand, nach Rabatt) der vermittelten Bestellungen.
// Ablauf einer Provision: vorgemerkt → verfügbar (Bestellung versendet + FREI_TAGE vergangen, kein offener Widerruf) → ausgezahlt.
// Storno oder voller Widerruf: Provision entfällt. Teilwiderruf: anteilig gekürzt. Eigene Käufe zählen nicht.
// Auszahlung: Partner beantragt ab MINDEST € (Überweisung oder PayPal), Lenn zahlt selbst und meldet „ausgezahlt“.
import { Fehler, text, email, jetzt, runden, zufall } from "./hilfe.js";
import { senden } from "./mail.js";
import { adressKern } from "./newsletter.js";

export const SATZ = 7.5;
export const MINDEST = 25;
export const FREI_TAGE = 14;
export const BEDINGUNGEN_STAND = "2026-11-27";
export const GUTSCHEIN_AUFSCHLAG = 10;   // Lenn 2026-11-27: als Shop-Gutschein 10 % mehr als bei Auszahlung
export const WERT_PRAEFIX = "DGP-";
const TAG = 86400000;
const ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O, 1/I

export function codeNormal(v) {
  const c = text(v, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{4,12}$/.test(c) ? c : "";
}
function neuerCode() {
  const z = zufall(6);
  let c = "";
  for (let i = 0; i < 6; i++) c += ZEICHEN[parseInt(z.slice(i * 2, i * 2 + 2), 16) % ZEICHEN.length];
  return c;
}

// IBAN-Prüfziffer (ISO 13616, mod 97)
export function ibanGueltig(v) {
  const i = String(v || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false;
  const umgestellt = (i.slice(4) + i.slice(0, 4)).replace(/[A-Z]/g, (b) => String(b.charCodeAt(0) - 55));
  let rest = 0;
  for (const ziffer of umgestellt) rest = (rest * 10 + Number(ziffer)) % 97;
  return rest === 1;
}

const kurzAdresse = (strasse, plz) => `${String(strasse || "").toLowerCase().replace(/[^a-z0-9äöüß]/g, "").replace(/strasse|straße|str$/g, "str")}|${String(plz || "").trim()}`;

// Eigenkauf? Gleiches Konto, gleiche E-Mail (auch Schreibvarianten) oder gleiche Rechnungs-/Lieferadresse wie der Partner
export function eigenkauf(partnerKunde, b) {
  if (partnerKunde.id && b.kunde_id && partnerKunde.id === b.kunde_id) return "Eigenes Konto";
  if (adressKern(partnerKunde.email) === adressKern(b.email)) return "Eigene E-Mail-Adresse";
  if (partnerKunde.strasse && partnerKunde.plz) {
    const p = kurzAdresse(partnerKunde.strasse, partnerKunde.plz);
    const adressen = [kurzAdresse(b.kunde.strasse, b.kunde.plz)];
    if (b.kunde.liefer) adressen.push(kurzAdresse(b.kunde.liefer.strasse, b.kunde.liefer.plz));
    if (adressen.includes(p)) return "Eigene Adresse";
  }
  return "";
}

// Nach dem Speichern einer Bestellung: Provision vormerken (oder als Eigenkauf mit 0 € festhalten, damit Lenn es sieht)
export async function zuordnen(env, b, rohCode) {
  const code = codeNormal(rohCode);
  if (!code) return null;
  const p = await env.DB.prepare("SELECT p.kunde_id, p.status, k.id, k.email, k.strasse, k.plz FROM partner p JOIN kunden k ON k.id = p.kunde_id WHERE p.code = ?").bind(code).first();
  if (!p || p.status !== "aktiv") return null;
  const basis = runden((b.warenwert || 0) - (b.rabatt || 0));
  const grund = eigenkauf(p, b);
  const betrag = grund ? 0 : runden(basis * SATZ / 100);
  await env.DB.prepare(`INSERT OR IGNORE INTO provisionen (nr, partner_id, code, basis, satz, betrag, status, grund, datum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(b.nr, p.kunde_id, code, basis, SATZ, betrag, grund ? "storniert" : "vorgemerkt", grund, jetzt()).run();
  return { code, betrag, grund };
}

// Bei Statuswechsel der Bestellung (Verwaltung): Versand startet die Wartezeit, Storno beendet die Provision
export async function bestellstatus(env, nr, status) {
  if (["versendet", "zugestellt"].includes(status)) {
    await env.DB.prepare("UPDATE provisionen SET frei_ab = ? WHERE nr = ? AND frei_ab = ''").bind(new Date(Date.now() + FREI_TAGE * TAG).toISOString(), nr).run();
  }
}

// Eine Provisionszeile mit Bestellung und Widerrufen → tatsächlicher Betrag und Zustand
const SQL_ZEILEN = `SELECT v.*, b.status AS b_status, b.brutto AS b_brutto, b.datum AS b_datum,
    COALESCE((SELECT SUM(w.betrag) FROM widerrufe w WHERE w.nr = v.nr AND w.status = 'erstattet'), 0) AS erstattet,
    (SELECT COUNT(*) FROM widerrufe w WHERE w.nr = v.nr AND w.status <> 'erstattet') AS widerruf_offen
  FROM provisionen v LEFT JOIN bestellungen b ON b.nr = v.nr`;

export function zustand(z, jetztMs = Date.now()) {
  if (z.status === "storniert" || z.b_status === "storniert" || !z.b_status) return { betrag: 0, zustand: "storniert" };
  const anteil = z.b_brutto > 0 ? Math.max(0, 1 - z.erstattet / z.b_brutto) : 1;
  const betrag = runden(z.betrag * anteil);
  if (betrag <= 0) return { betrag: 0, zustand: "storniert" };
  const frei = ["versendet", "zugestellt"].includes(z.b_status) && z.frei_ab && Date.parse(z.frei_ab) <= jetztMs && !z.widerruf_offen;
  return { betrag, zustand: frei ? "verfuegbar" : "vorgemerkt" };
}

function summen(zeilen, auszahlungen) {
  const s = { vorgemerkt: 0, verfuegbar: 0, ausgezahlt: 0, beantragt: 0 };
  for (const z of zeilen) if (z.zustand !== "storniert") s[z.zustand] = runden(s[z.zustand] + z.wert);
  for (const a of auszahlungen) if (a.status === "ausgezahlt" || a.status === "beantragt") s[a.status] = runden(s[a.status] + a.betrag);
  // Guthaben: verfügbare Provisionen minus alles, was schon ausgezahlt oder beantragt ist
  s.guthaben = runden(s.verfuegbar - s.ausgezahlt - s.beantragt);
  return s;
}

async function partnerDaten(env, kundeId) {
  const z = (await env.DB.prepare(`${SQL_ZEILEN} WHERE v.partner_id = ? ORDER BY v.datum DESC`).bind(kundeId).all()).results
    .map((x) => { const st = zustand(x); return { ...x, wert: st.betrag, zustand: st.zustand }; });
  const a = (await env.DB.prepare("SELECT * FROM auszahlungen WHERE partner_id = ? ORDER BY id DESC").bind(kundeId).all()).results;
  return { zeilen: z, auszahlungen: a, summen: summen(z, a) };
}

/* ---------- Partnerkonto (angemeldete Kunden) ---------- */
export async function lesen(env, k) {
  const p = await env.DB.prepare("SELECT * FROM partner WHERE kunde_id = ?").bind(k.id).first();
  const basis = { satz: SATZ, mindest: MINDEST, frei_tage: FREI_TAGE, aufschlag: GUTSCHEIN_AUFSCHLAG };
  if (!p) return { ...basis, partner: null };
  const d = await partnerDaten(env, k.id);
  return {
    ...basis,
    partner: {
      code: p.code, status: p.status, seit: p.seit, link: `${env.SITE_URL}/?p=${p.code}`, auszahlung: JSON.parse(p.auszahlung || "{}"), summen: d.summen,
      // Keine Kundendaten an Partner: nur Datum, Warenwert, Provision, Zustand
      provisionen: d.zeilen.filter((x) => !x.grund).map((x) => ({ datum: x.datum, basis: x.basis, betrag: x.wert, zustand: x.zustand, frei_ab: x.frei_ab })),
      auszahlungen: d.auszahlungen.map((x) => {
        const z = JSON.parse(x.ziel || "{}");
        return { id: x.id, betrag: x.betrag, status: x.status, beantragt: x.beantragt, erledigt: x.erledigt, art: z.art || "", ...(z.art === "gutschein" ? { code: z.code, wert: z.wert } : {}) };
      }),
    },
  };
}

export async function werden(env, k, d) {
  if (d.bedingungen !== true) throw new Fehler("Bitte stimmen Sie den Partnerbedingungen zu.");
  const da = await env.DB.prepare("SELECT code FROM partner WHERE kunde_id = ?").bind(k.id).first();
  if (da) return lesen(env, k);
  for (let versuch = 0; versuch < 5; versuch++) {
    const code = neuerCode();
    const r = await env.DB.prepare("INSERT OR IGNORE INTO partner (kunde_id, code, status, seit, bedingungen) VALUES (?, ?, 'aktiv', ?, ?)")
      .bind(k.id, code, jetzt(), BEDINGUNGEN_STAND).run();
    if (r.meta.changes) return lesen(env, k);
  }
  throw new Fehler("Bitte noch einmal versuchen.", 500);
}

const STEUER = ["privat", "klein", "ust"];
export function auszahlungsdaten(d) {
  const art = d.art === "paypal" ? "paypal" : "ueberweisung";
  const a = { art, inhaber: text(d.inhaber, 120), iban: "", paypal: "", steuer: STEUER.includes(d.steuer) ? d.steuer : "privat", steuernr: text(d.steuernr, 40) };
  if (!a.inhaber) throw new Fehler("Bitte den Namen angeben (Kontoinhaber bzw. Empfänger).");
  if (art === "ueberweisung") {
    a.iban = String(d.iban || "").toUpperCase().replace(/\s+/g, "");
    if (!ibanGueltig(a.iban)) throw new Fehler("Die IBAN ist nicht gültig. Bitte prüfen Sie sie.");
  } else a.paypal = email(d.paypal);
  if (a.steuer === "ust" && !a.steuernr) throw new Fehler("Bitte USt-IdNr. oder Steuernummer angeben, damit wir die Gutschrift mit Umsatzsteuer ausstellen können.");
  return a;
}

export async function auszahlungSpeichern(env, k, d) {
  const p = await env.DB.prepare("SELECT kunde_id FROM partner WHERE kunde_id = ?").bind(k.id).first();
  if (!p) throw new Fehler("Sie sind noch kein Partner.", 404);
  await env.DB.prepare("UPDATE partner SET auszahlung = ? WHERE kunde_id = ?").bind(JSON.stringify(auszahlungsdaten(d)), k.id).run();
  return lesen(env, k);
}

export async function auszahlen(env, ctx, k, d = {}) {
  const p = await env.DB.prepare("SELECT * FROM partner WHERE kunde_id = ?").bind(k.id).first();
  if (!p) throw new Fehler("Sie sind noch kein Partner.", 404);
  if (p.status !== "aktiv") throw new Fehler("Ihr Partnerkonto ist gesperrt. Bitte schreiben Sie uns an sales@ts-systec.de.", 403);
  const alsGutschein = d.art === "gutschein";
  const ziel = JSON.parse(p.auszahlung || "{}");
  if (!alsGutschein && !ziel.art) throw new Fehler("Bitte zuerst Ihre Auszahlungsdaten speichern.");
  const { summen: s, auszahlungen } = await partnerDaten(env, k.id);
  if (auszahlungen.some((a) => a.status === "beantragt")) throw new Fehler("Es läuft schon ein Auszahlungsantrag. Bitte warten Sie, bis er erledigt ist.");
  if (s.guthaben < MINDEST) throw new Fehler(`Auszahlung ab ${MINDEST} € verfügbarem Guthaben möglich. Verfügbar: ${s.guthaben.toFixed(2).replace(".", ",")} €.`);
  if (alsGutschein) return gutscheinAusstellen(env, ctx, k, p, s.guthaben);
  await env.DB.prepare("INSERT INTO auszahlungen (partner_id, betrag, ziel, status, beantragt) VALUES (?, ?, ?, 'beantragt', ?)")
    .bind(k.id, s.guthaben, JSON.stringify(ziel), jetzt()).run();
  const wohin = ziel.art === "paypal" ? `PayPal an ${ziel.paypal}` : `Überweisung an ${ziel.inhaber}, IBAN ${ziel.iban}`;
  const steuer = { privat: "Privatperson (ohne USt.)", klein: "Kleinunternehmer (ohne USt.)", ust: `umsatzsteuerpflichtig, ${ziel.steuernr} (Gutschrift mit 19 % USt. ausstellen)` }[ziel.steuer];
  ctx.waitUntil(senden(env, env.BESTELL_EMAIL, `Partner-Auszahlung beantragt: ${s.guthaben.toFixed(2).replace(".", ",")} € (${p.code})`,
    `Partner ${p.code} (${k.name || ""}, ${k.email}) möchte ${s.guthaben.toFixed(2).replace(".", ",")} € ausgezahlt bekommen.\n\n${wohin}\nSteuer: ${steuer}\n\nNach dem Zahlen in der Verwaltung unter „Partnerprogramm“ auf „Ausgezahlt“ klicken:\n${env.SITE_URL}/verwaltung/#v-partner`));
  return lesen(env, k);
}

// Provision als Shop-Gutschein: sofort erledigt, Wert = Provision + 10 %, Code per Mail
async function gutscheinAusstellen(env, ctx, k, p, betrag) {
  const wert = runden(betrag * (100 + GUTSCHEIN_AUFSCHLAG) / 100);
  let code = "";
  for (let versuch = 0; versuch < 5 && !code; versuch++) {
    const c = WERT_PRAEFIX + neuerCode() + neuerCode().slice(0, 2);
    if (!(await env.DB.prepare("SELECT code FROM wertgutscheine WHERE code = ?").bind(c).first())) code = c;
  }
  if (!code) throw new Fehler("Bitte noch einmal versuchen.", 500);
  const r = await env.DB.prepare("INSERT INTO auszahlungen (partner_id, betrag, ziel, status, beantragt, erledigt) VALUES (?, ?, ?, 'ausgezahlt', ?, ?)")
    .bind(k.id, betrag, JSON.stringify({ art: "gutschein", code, wert }), jetzt(), jetzt()).run();
  await env.DB.prepare("INSERT INTO wertgutscheine (code, partner_id, auszahlung_id, wert, rest, erstellt) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(code, k.id, r.meta.last_row_id, wert, wert, jetzt()).run();
  const w = wert.toFixed(2).replace(".", ",");
  ctx.waitUntil(senden(env, k.email, `Ihr Domo-Gastro-Gutschein über ${w} €`,
    `Hallo ${k.name || ""},\n\nvielen Dank für Ihre Empfehlungen! Statt ${betrag.toFixed(2).replace(".", ",")} € Auszahlung bekommen Sie einen Shop-Gutschein über ${w} € (${GUTSCHEIN_AUFSCHLAG} % mehr).\n\nIhr Code: ${code}\n\nTragen Sie ihn an der Kasse ins Feld „Gutscheincode“ ein. Er gilt für alle Artikel, auch während Aktionen, kann in mehreren Bestellungen aufgebraucht und weitergegeben werden. Eine Auszahlung in Geld ist nicht möglich. Der Restbetrag steht in Ihrem Konto: ${env.SITE_URL}/konto/#partner\n\nIhr Domo-Gastro-Team`));
  ctx.waitUntil(senden(env, env.BESTELL_EMAIL, `Partner ${p.code}: Provision ${betrag.toFixed(2).replace(".", ",")} € als Gutschein ${code} (${w} €)`,
    `Partner ${p.code} (${k.name || ""}, ${k.email}) hat ${betrag.toFixed(2).replace(".", ",")} € Provision als Shop-Gutschein genommen.\nCode ${code}, Wert ${w} € (inkl. ${GUTSCHEIN_AUFSCHLAG} % Aufschlag). Nichts zu tun.`));
  return lesen(env, k);
}

/* ---------- Shop-Guthaben einlösen (Kasse) ---------- */
export const istWertCode = (c) => String(c || "").startsWith(WERT_PRAEFIX);
export async function wertLesen(env, rohCode) {
  const code = text(rohCode, 30).toUpperCase().replace(/\s+/g, "");
  const g = await env.DB.prepare("SELECT code, wert, rest FROM wertgutscheine WHERE code = ?").bind(code).first();
  if (!g) throw new Fehler("Diesen Gutscheincode kennen wir nicht. Bitte prüfen Sie die Schreibweise.");
  if (g.rest <= 0.004) throw new Fehler("Dieser Gutschein ist schon aufgebraucht.");
  return g;
}
// Betrag reservieren, bevor die Bestellung gespeichert wird (gleichzeitige Doppel-Einlösung verhindern)
export async function wertReservieren(env, nr, code, betrag) {
  const u = await env.DB.prepare("UPDATE wertgutscheine SET rest = ROUND(rest - ?, 2) WHERE code = ? AND rest >= ? - 0.004").bind(betrag, code, betrag).run();
  if (!u.meta.changes) throw new Fehler("Der Gutschein reicht nicht mehr für diesen Betrag. Bitte laden Sie die Seite neu.");
  await env.DB.prepare("INSERT INTO wertgutschein_einloesungen (nr, code, betrag, datum) VALUES (?, ?, ?, ?)").bind(nr, code, betrag, jetzt()).run();
}
// Bestellung storniert oder Zahlung gescheitert: Betrag wieder auf den Gutschein
export async function wertFreigeben(env, nr) {
  const e = await env.DB.prepare("SELECT code, betrag FROM wertgutschein_einloesungen WHERE nr = ?").bind(nr).first();
  if (!e) return;
  await env.DB.prepare("UPDATE wertgutscheine SET rest = ROUND(rest + ?, 2) WHERE code = ?").bind(e.betrag, e.code).run();
  await env.DB.prepare("DELETE FROM wertgutschein_einloesungen WHERE nr = ?").bind(nr).run();
}

// Konto gelöscht: Provisionen bleiben für die Buchhaltung, Auszahlungsdaten werden gelöscht, Code wird gesperrt
export function kontoLoeschen(env, kundeId) {
  return env.DB.prepare("UPDATE partner SET status = 'geloescht', auszahlung = '{}' WHERE kunde_id = ?").bind(kundeId);
}

/* ---------- Verwaltung ---------- */
export async function verwaltungListe(env) {
  const z = (await env.DB.prepare(`${SQL_ZEILEN} ORDER BY v.datum DESC LIMIT 500`).all()).results.map((x) => { const st = zustand(x); return { ...x, wert: st.betrag, zustand: st.zustand }; });
  const a = (await env.DB.prepare(`SELECT a.*, p.code, k.name, k.email FROM auszahlungen a JOIN partner p ON p.kunde_id = a.partner_id LEFT JOIN kunden k ON k.id = a.partner_id ORDER BY a.id DESC LIMIT 300`).all()).results;
  const p = (await env.DB.prepare("SELECT p.*, k.name, k.email FROM partner p LEFT JOIN kunden k ON k.id = p.kunde_id ORDER BY p.seit DESC").all()).results;
  const gezaehlt = z.filter((x) => x.zustand !== "storniert");
  const gesamt = { ...summen(z, a), partner: p.filter((x) => x.status === "aktiv").length, verkaeufe: gezaehlt.length,
    umsatz_netto: runden(gezaehlt.reduce((s, x) => s + x.basis, 0)), provision: runden(gezaehlt.reduce((s, x) => s + x.wert, 0)),
    eigenkaeufe: z.filter((x) => x.grund).length };
  return {
    satz: SATZ, mindest: MINDEST, gesamt,
    verkaeufe: z.map((x) => ({ nr: x.nr, datum: x.datum, code: x.code, basis: x.basis, betrag: x.wert, zustand: x.zustand, grund: x.grund, frei_ab: x.frei_ab, bestellstatus: x.b_status || "" })),
    antraege: a.map((x) => ({ ...x, ziel: JSON.parse(x.ziel) })),
    partner: p.map((x) => {
      const eigene = z.filter((v) => v.partner_id === x.kunde_id);
      const s = summen(eigene, a.filter((y) => y.partner_id === x.kunde_id));
      const zaehlt = eigene.filter((v) => v.zustand !== "storniert");
      return { code: x.code, status: x.status, seit: x.seit, name: x.name || "", email: x.email || "", verkaeufe: zaehlt.length,
        umsatz_netto: runden(zaehlt.reduce((t, v) => t + v.basis, 0)), ...s };
    }),
  };
}

export async function verwaltungAktion(env, ctx, d) {
  const a = String(d.aktion || "");
  if (a === "ausgezahlt" || a === "abgelehnt") {
    const z = await env.DB.prepare("SELECT a.*, k.email, p.code FROM auszahlungen a JOIN partner p ON p.kunde_id = a.partner_id LEFT JOIN kunden k ON k.id = a.partner_id WHERE a.id = ?").bind(parseInt(d.id, 10) || 0).first();
    if (!z) throw new Fehler("Antrag nicht gefunden.", 404);
    if (z.status !== "beantragt") throw new Fehler("Dieser Antrag ist schon erledigt.");
    await env.DB.prepare("UPDATE auszahlungen SET status = ?, erledigt = ?, notiz = ? WHERE id = ?").bind(a, jetzt(), text(d.notiz, 300), z.id).run();
    if (z.email) {
      const betrag = z.betrag.toFixed(2).replace(".", ",");
      ctx.waitUntil(senden(env, z.email, a === "ausgezahlt" ? `Ihre Partner-Provision: ${betrag} € ausgezahlt` : "Ihr Auszahlungsantrag bei Domo Gastro",
        a === "ausgezahlt"
          ? `Hallo,\n\nwir haben Ihnen ${betrag} € Provision aus dem Domo-Gastro-Partnerprogramm ausgezahlt. Je nach Bank kann es ein bis zwei Werktage dauern, bis das Geld ankommt.\n\nIhre Übersicht: ${env.SITE_URL}/konto/#partner\n\nVielen Dank für Ihre Empfehlungen!\nIhr Domo-Gastro-Team`
          : `Hallo,\n\nIhren Auszahlungsantrag über ${betrag} € konnten wir leider nicht ausführen.${d.notiz ? `\nGrund: ${text(d.notiz, 300)}` : ""}\nDas Guthaben steht wieder in Ihrem Konto: ${env.SITE_URL}/konto/#partner\n\nBei Fragen antworten Sie einfach auf diese E-Mail.\nIhr Domo-Gastro-Team`));
    }
    return { ok: true };
  }
  if (a === "provision_stornieren" || a === "provision_wiederherstellen") {
    const z = await env.DB.prepare("SELECT * FROM provisionen WHERE nr = ?").bind(text(d.nr, 30)).first();
    if (!z) throw new Fehler("Provision nicht gefunden.", 404);
    if (a === "provision_wiederherstellen" && z.grund) throw new Fehler("Eigenkäufe bekommen keine Provision.");
    await env.DB.prepare("UPDATE provisionen SET status = ? WHERE nr = ?").bind(a === "provision_stornieren" ? "storniert" : "vorgemerkt", z.nr).run();
    return { ok: true };
  }
  if (a === "sperren" || a === "entsperren") {
    const r = await env.DB.prepare("UPDATE partner SET status = ? WHERE code = ? AND status <> 'geloescht'").bind(a === "sperren" ? "gesperrt" : "aktiv", codeNormal(d.code)).run();
    if (!r.meta.changes) throw new Fehler("Partner nicht gefunden.", 404);
    return { ok: true };
  }
  throw new Fehler("Unbekannte Aktion.");
}
