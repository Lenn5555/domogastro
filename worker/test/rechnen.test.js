import { test } from "node:test";
import assert from "node:assert/strict";
import KATALOG from "../src/katalog.json" with { type: "json" };
import { rechnen } from "../src/shop.js";
import { passwortHash, gleich } from "../src/hilfe.js";

const [sku, artikel] = Object.entries(KATALOG.artikel).find(([, a]) => a.p);

test("Preise kommen aus dem Katalog, nicht aus dem Browser", () => {
  const r = rechnen([{ sku, menge: 2, netto: 0.01 }]);
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
