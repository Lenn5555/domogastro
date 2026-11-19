import { test } from "node:test";
import assert from "node:assert/strict";
import { vorschlagRechnen } from "../src/widerruf.js";

const b = { brutto: 323.68, kunde: {}, positionen: [{ sku: "a", netto: 87, menge: 2 }, { sku: "b", netto: 98, menge: 1 }] };

test("anteiliger Bruttobetrag, Rest ergibt genau den Gesamtbetrag", () => {
  const erst = vorschlagRechnen(b, [{ sku: "a", menge: 1 }], []);
  assert.equal(erst, 103.53);
  const rest = vorschlagRechnen(b, [{ sku: "a", menge: 1 }, { sku: "b", menge: 1 }], [{ vorschlag: erst, positionen: [{ sku: "a", menge: 1 }] }]);
  assert.equal(Math.round((erst + rest) * 100) / 100, 323.68);
});

test("Gutschein-Rabatt wird anteilig abgezogen", () => {
  assert.equal(vorschlagRechnen({ ...b, kunde: { gutschein: { prozent: 5 } } }, [{ sku: "a", menge: 1 }], []), 98.35);
});
