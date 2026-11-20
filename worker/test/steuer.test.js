import { test } from "node:test";
import assert from "node:assert/strict";
import LAENDER from "../../daten/laender.json" with { type: "json" };
import { gesamtRechnen } from "../src/steuer.js";

const klein = { a: { p: 100, g: 4, sp: false, el: false }, menge: 1 };
const gross = { a: { p: 1000, g: 60, sp: true, el: true }, menge: 1 };

test("Deutschland: versandkostenfrei, 19 %", () => {
  const r = gesamtRechnen(LAENDER, "DE", [klein], 0, false);
  assert.deepEqual([r.versand, r.satz, r.brutto], [0, 19, 119]);
});
test("Österreich privat: Paketpreis; mit OSS 20 %, ohne OSS deutsche 19 %", () => {
  const r = gesamtRechnen({ ...LAENDER, oss: true }, "AT", [klein], 0, false);
  assert.equal(r.versand, 9.95); assert.equal(r.art, "OSS"); assert.equal(r.brutto, Math.round(109.95 * 1.2 * 100) / 100);
  const d = gesamtRechnen({ ...LAENDER, oss: false }, "AT", [klein], 0, false);
  assert.equal(d.satz, 19); assert.equal(d.brutto, Math.round(109.95 * 1.19 * 100) / 100);
});
test("feste Versandkosten je Bestellung, egal wie schwer oder wie viele", () => {
  assert.equal(gesamtRechnen(LAENDER, "AT", [{ ...klein, menge: 6 }], 0, false).versand, 9.95);
  const s = gesamtRechnen(LAENDER, "FR", [klein, { ...gross, menge: 3 }], 0, false);
  assert.equal(s.versand, 13.95);
});
test("Unternehmen mit geprüfter USt-IdNr. und Schweiz: 0 %", () => {
  assert.equal(gesamtRechnen(LAENDER, "NL", [klein], 0, true).art, "IG");
  assert.equal(gesamtRechnen(LAENDER, "CH", [klein], 0, false).mwst, 0);
  assert.equal(gesamtRechnen(LAENDER, "DE", [klein], 0, true).satz, 19);
});
