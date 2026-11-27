import { test } from "node:test";
import assert from "node:assert/strict";
import { d1 } from "./d1.js";
import { ibanGueltig, eigenkauf, zustand, codeNormal, zuordnen, werden, lesen, auszahlungSpeichern, auszahlen, bestellstatus, verwaltungListe, verwaltungAktion, MINDEST } from "../src/partner.js";

const ctx = { waitUntil() {} };
const TAG = 86400000;

test("IBAN-Prüfziffer", () => {
  assert.equal(ibanGueltig("DE89 3704 0044 0532 0130 00"), true);
  assert.equal(ibanGueltig("DE89 3704 0044 0532 0130 01"), false);
  assert.equal(ibanGueltig("hallo"), false);
});

test("Partnercode wird normalisiert", () => {
  assert.equal(codeNormal(" ab-c2 34 "), "ABC234");
  assert.equal(codeNormal("x"), "");
});

test("Eigenkauf: Konto, Mail-Variante, Adresse", () => {
  const p = { id: 7, email: "max.muster@gmail.com", strasse: "Hauptstraße 5", plz: "64319" };
  assert.equal(eigenkauf(p, { kunde_id: 7, email: "x@y.de", kunde: {} }), "Eigenes Konto");
  assert.equal(eigenkauf(p, { kunde_id: null, email: "maxmuster+shop@googlemail.com", kunde: {} }), "Eigene E-Mail-Adresse");
  assert.equal(eigenkauf(p, { kunde_id: null, email: "a@b.de", kunde: { strasse: "Hauptstr. 5", plz: "64319" } }), "Eigene Adresse");
  assert.equal(eigenkauf(p, { kunde_id: null, email: "a@b.de", kunde: { strasse: "Nebenweg 1", plz: "10115" } }), "");
});

test("Zustand: vorgemerkt, verfügbar, Teilwiderruf, Storno", () => {
  const z = { status: "vorgemerkt", betrag: 7.5, b_status: "versendet", b_brutto: 119, erstattet: 0, widerruf_offen: 0, frei_ab: new Date(Date.now() - TAG).toISOString() };
  assert.deepEqual(zustand(z), { betrag: 7.5, zustand: "verfuegbar" });
  assert.equal(zustand({ ...z, frei_ab: new Date(Date.now() + TAG).toISOString() }).zustand, "vorgemerkt");
  assert.equal(zustand({ ...z, widerruf_offen: 1 }).zustand, "vorgemerkt");
  assert.deepEqual(zustand({ ...z, erstattet: 59.5 }), { betrag: 3.75, zustand: "verfuegbar" });
  assert.equal(zustand({ ...z, b_status: "storniert" }).zustand, "storniert");
  assert.equal(zustand({ ...z, erstattet: 119 }).zustand, "storniert");
});

async function bestellung(env, nr, { email = "kunde@firma.de", kunde_id = null, netto = 1000, status = "bezahlt" } = {}) {
  await env.DB.prepare(`INSERT INTO bestellungen (nr, kunde_id, email, modus, kunde, positionen, netto, mwst, brutto, zahlart, status, datum, aktualisiert)
    VALUES (?, ?, ?, 'privat', ?, '[]', ?, ?, ?, 'PayPal', ?, ?, ?)`).bind(nr, kunde_id, email, JSON.stringify({ strasse: "Nebenweg 1", plz: "10115" }), netto, netto * 0.19, netto * 1.19, status, "2026-11-27", "2026-11-27").run();
  return { nr, kunde_id, email, kunde: { strasse: "Nebenweg 1", plz: "10115" }, warenwert: netto, rabatt: 0 };
}

test("Ablauf: Partner werden, Verkauf, Freigabe, Auszahlung", async () => {
  const env = { DB: d1(), SITE_URL: "https://domogastro.de", BESTELL_EMAIL: "sales@x.de" };
  await env.DB.prepare("INSERT INTO kunden (email, name, strasse, plz, pw_hash, pw_salz, erstellt) VALUES ('p@x.de', 'Pia', 'Hauptstr. 5', '64319', '', '', '')").run();
  const k = { id: 1, email: "p@x.de", name: "Pia" };
  await assert.rejects(werden(env, k, {}), /Partnerbedingungen/);
  const p = (await werden(env, k, { bedingungen: true })).partner;
  assert.match(p.link, /\?p=[A-Z0-9]{6}$/);

  // Verkauf über 400 € netto → 30 € Provision; Eigenkauf → 0 €
  const b = await bestellung(env, "DG-1", { netto: 400 });
  assert.equal((await zuordnen(env, b, p.code.toLowerCase())).betrag, 30);
  const eigen = await bestellung(env, "DG-2", { email: "p@x.de" });
  assert.equal((await zuordnen(env, eigen, p.code)).grund, "Eigene E-Mail-Adresse");
  assert.equal(await zuordnen(env, await bestellung(env, "DG-3"), "FALSCH1"), null);

  let s = (await lesen(env, k)).partner;
  assert.equal(s.summen.vorgemerkt, 30);
  assert.equal(s.provisionen.length, 1); // Eigenkauf erscheint beim Partner nicht
  await assert.rejects(auszahlen(env, ctx, k), /Auszahlungsdaten/);
  await auszahlungSpeichern(env, k, { art: "ueberweisung", inhaber: "Pia P", iban: "DE89370400440532013000" });
  await assert.rejects(auszahlen(env, ctx, k), new RegExp(`ab ${MINDEST}`));

  // versendet, Wartezeit vorbei → verfügbar
  await env.DB.prepare("UPDATE bestellungen SET status = 'versendet' WHERE nr = 'DG-1'").run();
  await bestellstatus(env, "DG-1", "versendet");
  await env.DB.prepare("UPDATE provisionen SET frei_ab = ? WHERE nr = 'DG-1'").bind(new Date(Date.now() - 1000).toISOString()).run();
  s = (await auszahlen(env, ctx, k)).partner;
  assert.equal(s.summen.beantragt, 30);
  assert.equal(s.summen.guthaben, 0);
  await assert.rejects(auszahlen(env, ctx, k), /läuft schon/);

  const v = await verwaltungListe(env);
  assert.equal(v.gesamt.verkaeufe, 1);
  assert.equal(v.gesamt.eigenkaeufe, 1);
  assert.equal(v.gesamt.provision, 30);
  await verwaltungAktion(env, ctx, { aktion: "ausgezahlt", id: v.antraege[0].id });
  s = (await lesen(env, k)).partner;
  assert.equal(s.summen.ausgezahlt, 30);
  assert.equal(s.auszahlungen[0].status, "ausgezahlt");
});

test("Provision als Shop-Gutschein mit 10 % Aufschlag, teilweise einlösbar, bei Storno zurück", async () => {
  const env = { DB: d1(), SITE_URL: "https://domogastro.de", BESTELL_EMAIL: "sales@x.de" };
  await env.DB.prepare("INSERT INTO kunden (email, name, pw_hash, pw_salz, erstellt) VALUES ('p@x.de', 'Pia', '', '', '')").run();
  const k = { id: 1, email: "p@x.de", name: "Pia" };
  const { code } = (await werden(env, k, { bedingungen: true })).partner;
  const b = await bestellung(env, "DG-9", { netto: 400, status: "versendet" });
  await zuordnen(env, b, code);
  await env.DB.prepare("UPDATE provisionen SET frei_ab = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
  // ohne Auszahlungsdaten möglich, sofort erledigt
  const p = (await auszahlen(env, ctx, k, { art: "gutschein" })).partner;
  assert.equal(p.summen.ausgezahlt, 30);
  assert.equal(p.summen.guthaben, 0);
  const a = p.auszahlungen[0];
  assert.equal(a.art, "gutschein");
  assert.equal(a.wert, 33);
  assert.match(a.code, /^DGP-[A-Z0-9]{8}$/);

  const { wertLesen, wertReservieren, wertFreigeben } = await import("../src/partner.js");
  assert.equal((await wertLesen(env, a.code.toLowerCase())).rest, 33);
  await wertReservieren(env, "DG-10", a.code, 20);
  assert.equal((await wertLesen(env, a.code)).rest, 13);
  await assert.rejects(wertReservieren(env, "DG-11", a.code, 20), /reicht nicht/);
  await wertFreigeben(env, "DG-10");
  assert.equal((await wertLesen(env, a.code)).rest, 33);
});
