import { test } from "node:test";
import assert from "node:assert/strict";
import { d1 } from "./d1.js";
import KATALOG from "../src/katalog.json" with { type: "json" };
import * as shop from "../src/shop.js";
import { bewertungsmail } from "../src/mail.js";

const slug = Object.keys(KATALOG.produkte)[0], sku = KATALOG.produkte[slug][0];
const env = () => ({ DB: d1(), SITE_URL: "https://domogastro.de", VERWALTUNG_SCHLUESSEL: "geheim" });
const neu = (x) => ({ produkt: slug, sterne: 4, name: "Bob", email: "b@x.de", titel: "Gut", text: "Passt.", dauer: 8000, ...x });

test("Bewertung ohne Konto erscheint sofort, ohne Gutschein; Spamschutz", async () => {
  const e = env();
  await assert.rejects(shop.bewertenOffen(e, neu({ name: "" })), /Vornamen/);
  await assert.rejects(shop.bewertenOffen(e, neu({ dauer: 1200 })), /noch einmal/);
  assert.equal((await shop.bewertenOffen(e, neu({ website: "http://spam" }))).ok, true);  // Honigtopf: still verworfen
  assert.equal((await shop.bewertungenLesen(e, slug)).anzahl, 0);
  assert.equal((await shop.bewertenOffen(e, neu(), "1.2.3.4")).verifiziert, false);
  const l = await shop.bewertungenLesen(e, slug);
  assert.equal(l.anzahl, 1); assert.equal(l.liste[0].verifiziert, 0); assert.equal(l.liste[0].email, undefined);
  await assert.rejects(shop.bewertenOffen(e, neu({ name: "Bobby" }), "9.9.9.9"), /schon bewertet/);
  await shop.bewertenOffen(e, neu({ email: "c@x.de" }), "1.2.3.4");
  await shop.bewertenOffen(e, neu({ email: "d@x.de" }), "1.2.3.4");
  await assert.rejects(shop.bewertenOffen(e, neu({ email: "f@x.de" }), "1.2.3.4"), /morgen/);
  assert.equal(e.DB.roh.prepare("SELECT COUNT(*) AS n FROM gutscheine").get().n, 0);
  const v = await shop.verwaltungListe(e);
  assert.equal(v.bewertungen.length, 3); assert.ok(v.bewertungen.every((b) => b.email && b.herkunft === "mail"));
  await shop.verwaltungBewertung(e, { id: v.bewertungen[0].id, freigeben: false });
  assert.equal((await shop.bewertungenLesen(e, slug)).anzahl, 2);
});

test("Verifizierter Kauf nur über den Link aus der Erinnerungsmail, nicht über eine eingetippte Adresse", async () => {
  const e = env();
  e.DB.roh.prepare(`INSERT INTO bestellungen (nr, email, modus, kunde, positionen, netto, mwst, brutto, zahlart, status, datum, aktualisiert)
    VALUES ('DG-1', 'kaeufer@x.de', 'privat', '{"name":"Anna"}', ?, 1, 0, 1, 'PayPal', 'bezahlt', 'x', 'x')`).run(JSON.stringify([{ sku, menge: 1, name: "X" }]));
  assert.equal((await shop.bewertenOffen(e, neu({ email: "kaeufer@x.de" }))).verifiziert, false);
  const k = await shop.kaufSchluessel(e, "DG-1");
  const mail = bewertungsmail(e, { nr: "DG-1", kunde: { name: "Anna" } }, [{ slug, name: "X" }], k);
  assert.ok(mail.includes(`?bestellung=DG-1&k=${k}#bewertungen`));
  await assert.rejects(shop.bewertenOffen(e, neu({ name: "Anna", email: "egal@x.de", bestellung: "DG-1", k })), /schon bewertet/);  // Adresse der Bestellung zählt
  e.DB.roh.prepare("DELETE FROM bewertungen").run(); e.DB.roh.prepare("DELETE FROM bewertung_mail").run();
  assert.equal((await shop.bewertenOffen(e, neu({ name: "Anna", email: "egal@x.de", bestellung: "DG-1", k: "falsch" }))).verifiziert, false);
  assert.equal((await shop.bewertenOffen(e, neu({ name: "Anna", email: "x@x.de", bestellung: "DG-1", k }))).verifiziert, true);
});

test("E-Mail freiwillig: ohne Adresse sofort sichtbar, ohne Kauf-Zeichen", async () => {
  const e = env();
  const r = await shop.bewertenOffen(e, neu({ email: "" }), "5.5.5.5");
  assert.equal(r.verifiziert, false); assert.equal(r.mail, "");
  await shop.bewertenOffen(e, neu({ email: "" }), "5.5.5.5");  // ohne Adresse greift nur das IP-Limit
  assert.equal((await shop.bewertungenLesen(e, slug)).anzahl, 2);
  assert.equal(e.DB.roh.prepare("SELECT COUNT(*) AS n FROM bewertung_mail").get().n, 0);
  await assert.rejects(shop.bewertenOffen(e, neu({ email: "kaputt" }), "6.6.6.6"), /gültige E-Mail/);
});
