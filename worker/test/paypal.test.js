import { test } from "node:test";
import assert from "node:assert/strict";
import { abschliessen } from "../src/paypal.js";

const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_SECRET: "geheim", PAYPAL_SANDBOX: "ja" };
const b = { nr: "DG-261113-ABC123", brutto: 103.53, paypal_id: "5O190127TN364715T" };

function falschesPaypal(order, capture = { status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED" }] } }] }) {
  const aufrufe = [];
  const abruf = async (url, o) => {
    aufrufe.push(`${o.method} ${new URL(url).pathname}`);
    const body = url.endsWith("/token") ? { access_token: "t" } : url.endsWith("/capture") ? capture : order;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { abruf, aufrufe };
}

test("zieht ein, wenn Betrag und Bestellnummer passen", async () => {
  const { abruf, aufrufe } = falschesPaypal({ purchase_units: [{ invoice_id: b.nr, amount: { value: "103.53", currency_code: "EUR" } }] });
  assert.deepEqual(await abschliessen(env, b, b.paypal_id, abruf), { transaktion: "CAP1" });
  assert.ok(aufrufe.some((a) => a.endsWith("/capture")));
});

test("zieht nicht ein, wenn der Betrag abweicht", async () => {
  const { abruf, aufrufe } = falschesPaypal({ purchase_units: [{ invoice_id: b.nr, amount: { value: "1.00", currency_code: "EUR" } }] });
  assert.ok((await abschliessen(env, b, b.paypal_id, abruf)).fehler);
  assert.ok(!aufrufe.some((a) => a.endsWith("/capture")));
});

test("lehnt fremde PayPal-IDs ab, ohne PayPal zu fragen", async () => {
  const { abruf, aufrufe } = falschesPaypal({});
  assert.ok((await abschliessen(env, b, "ANDERE1234567", abruf)).fehler);
  assert.equal(aufrufe.length, 0);
});

test("meldet Fehler, wenn PayPal nicht abschließt", async () => {
  const { abruf } = falschesPaypal({ purchase_units: [{ invoice_id: b.nr, amount: { value: "103.53", currency_code: "EUR" } }] }, { status: "PENDING" });
  assert.ok((await abschliessen(env, b, b.paypal_id, abruf)).fehler);
});
