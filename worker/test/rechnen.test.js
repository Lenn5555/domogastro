import { test } from "node:test";
import assert from "node:assert/strict";
import KATALOG from "../src/katalog.json" with { type: "json" };
import { rechnen } from "../src/shop.js";
import AKTION from "../../daten/aktion.json" with { type: "json" };
import { passwortHash, gleich } from "../src/hilfe.js";

const [sku, artikel] = Object.entries(KATALOG.artikel).find(([, a]) => a.p);

test("Preise kommen aus dem Katalog, nicht aus dem Browser", () => {
  const r = rechnen([{ sku, menge: 2, netto: 0.01 }], 0, "DE", false, Date.parse("2020-01-01"));
  assert.equal(r.netto, Math.round(artikel.p * 2 * 100) / 100);
  assert.equal(r.brutto, Math.round((r.netto + r.mwst) * 100) / 100);
});

test("unbekannte Artikel, Artikel ohne Preis und falsche Mengen werden abgelehnt", () => {
  const ohnePreis = Object.keys(KATALOG.artikel).find((k) => !KATALOG.artikel[k].p);
  assert.throws(() => rechnen([{ sku: "gibtsnicht", menge: 1 }]));
  if (ohnePreis) assert.throws(() => rechnen([{ sku: ohnePreis, menge: 1 }]));
  for (const menge of [0, -1, 100, "x"]) assert.throws(() => rechnen([{ sku, menge }]));
  assert.throws(() => rechnen([]));
});

test("Passwort-Hash ist gesalzen und vergleichbar", async () => {
  const a = await passwortHash("sehrgeheim123", "salz1");
  assert.ok(gleich(a, await passwortHash("sehrgeheim123", "salz1")));
  assert.ok(!gleich(a, await passwortHash("sehrgeheim123", "salz2")));
});

test("Gutschein-Rabatt wird vom Warenwert abgezogen, MwSt. auf den reduzierten Betrag", () => {
  const ohne = rechnen([{ sku, menge: 3 }]);
  const mit = rechnen([{ sku, menge: 3 }], 5);
  assert.equal(mit.warenwert, ohne.netto);
  assert.equal(mit.rabatt, Math.round(ohne.netto * 5) / 100);
  assert.equal(mit.netto, Math.round((ohne.netto - mit.rabatt) * 100) / 100);
  assert.equal(mit.brutto, Math.round((mit.netto + mit.mwst) * 100) / 100);
});

test("Preisaktion (Black Week) gilt nur im Zeitraum und auf den Stückpreis", () => {
  if (!AKTION.prozent) return;
  const mitte = (Date.parse(AKTION.von) + Date.parse(AKTION.bis)) / 2;
  const vorher = rechnen([{ sku, menge: 2 }], 0, "DE", false, Date.parse(AKTION.von) - 1000);
  const waehrend = rechnen([{ sku, menge: 2 }], 0, "DE", false, mitte);
  const nachher = rechnen([{ sku, menge: 2 }], 0, "DE", false, Date.parse(AKTION.bis) + 1000);
  const stueck = Math.round(artikel.p * (100 - AKTION.prozent)) / 100;
  assert.equal(vorher.warenwert, Math.round(artikel.p * 2 * 100) / 100);
  assert.equal(nachher.warenwert, vorher.warenwert);
  assert.equal(waehrend.positionen[0].netto, stueck);
  assert.equal(waehrend.positionen[0].netto_vorher, artikel.p);
  assert.equal(waehrend.warenwert, Math.round(stueck * 2 * 100) / 100);
  assert.equal(waehrend.steuer.aktion.prozent, AKTION.prozent);
});
