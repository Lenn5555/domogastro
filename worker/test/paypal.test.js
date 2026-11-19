import { test } from "node:test";
import assert from "node:assert/strict";
import { pruefen, einziehen, fingerabdruck } from "../src/paypal.js";

const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_SECRET: "geheim", PAYPAL_SANDBOX: "ja" };
const id = "5O190127TN364715T";
const b = { brutto: 103.53, abdruck: "abc" };
const passend = { purchase_units: [{ invoice_id: "DG-261119-A1B2C3", custom_id: "abc", amount: { value: "103.53", currency_code: "EUR" } }] };

function falschesPaypal(order, capture = { status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED" }] } }] }) {
  const aufrufe = [];
  const abruf = async (url, o) => {
    aufrufe.push(`${o.method} ${new URL(url).pathname}`);
    const body = url.endsWith("/token") ? { access_token: "t" } : url.endsWith("/capture") ? capture : order;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { abruf, aufrufe };
}

test("prüft Betrag und Fingerabdruck und liefert die Bestellnummer", async () => {
  const { abruf, aufrufe } = falschesPaypal(passend);
  assert.deepEqual(await pruefen(env, id, b, abruf), { nr: "DG-261119-A1B2C3" });
  assert.ok(!aufrufe.some((a) => a.endsWith("/capture")));
});

test("lehnt ab, wenn der Betrag abweicht", async () => {
  const { abruf } = falschesPaypal({ purchase_units: [{ ...passend.purchase_units[0], amount: { value: "1.00", currency_code: "EUR" } }] });
  assert.ok((await pruefen(env, id, b, abruf)).fehler);
});

test("lehnt ab, wenn die Bestelldaten geändert wurden", async () => {
  const { abruf } = falschesPaypal(passend);
  assert.ok((await pruefen(env, id, { ...b, abdruck: "anders" }, abruf)).fehler);
});

test("lehnt ungültige PayPal-IDs ab, ohne PayPal zu fragen", async () => {
  const { abruf, aufrufe } = falschesPaypal({});
  assert.ok((await pruefen(env, "x'; DROP", b, abruf)).fehler);
  assert.equal(aufrufe.length, 0);
});

test("einziehen meldet Erfolg und Fehler", async () => {
  assert.deepEqual(await einziehen(env, id, falschesPaypal(passend).abruf), { transaktion: "CAP1" });
  assert.ok((await einziehen(env, id, falschesPaypal(passend, { status: "PENDING" }).abruf)).fehler);
});

test("Fingerabdruck hängt von den Daten ab", async () => {
  assert.equal(await fingerabdruck([1, "a"]), await fingerabdruck([1, "a"]));
  assert.notEqual(await fingerabdruck([1, "a"]), await fingerabdruck([1, "b"]));
});
