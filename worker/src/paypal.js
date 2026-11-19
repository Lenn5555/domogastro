// Sofort bezahlen mit PayPal oder Kreditkarte (über PayPal) direkt im Warenkorb, wie bei beinundfuss.de (Lenn 2026-11-19):
// Die PayPal-Knöpfe erscheinen statt „Zahlungspflichtig bestellen“. /bezahlen/start legt die PayPal-Bestellung an,
// /bezahlen/abschluss prüft sie, zieht das Geld ein und speichert erst dann die Bestellung (als „bezahlt“).
// Der Betrag entsteht nur auf dem Server. Ein Fingerabdruck der Bestelldaten liegt bei PayPal (custom_id) und muss beim
// Abschluss zu den gesendeten Daten passen. Zugangsdaten: Worker-Secrets PAYPAL_CLIENT_ID, PAYPAL_SECRET.
// PAYPAL_SANDBOX = "ja" = Testumgebung.

export const aktiv = (env) => Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET);
// PAYPAL_BASIS nur für lokale Tests mit einem nachgebauten PayPal (nie in wrangler.toml setzen)
const basis = (env) => env.PAYPAL_BASIS || (env.PAYPAL_SANDBOX === "ja" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");
const wert = (x) => x.toFixed(2);

async function token(env, abruf) {
  const r = await abruf(`${basis(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal-Anmeldung fehlgeschlagen: ${r.status}`);
  return (await r.json()).access_token;
}

async function rufen(env, abruf, pfad, art, inhalt, extra = {}) {
  const r = await abruf(`${basis(env)}${pfad}`, {
    method: art,
    headers: { Authorization: `Bearer ${await token(env, abruf)}`, "Content-Type": "application/json", ...extra },
    ...(inhalt ? { body: JSON.stringify(inhalt) } : {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal ${art} ${pfad}: ${r.status} ${d.name || ""} ${d.details?.[0]?.issue || ""}`.trim());
  return d;
}

// Fingerabdruck der Bestelldaten (SHA-256 als Hex)
export async function fingerabdruck(teile) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(teile)));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// b: { nr, brutto, abdruck }
export async function anlegen(env, b, abruf = fetch) {
  const d = await rufen(env, abruf, "/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{
      invoice_id: b.nr, custom_id: b.abdruck,
      description: `Domo Gastro Bestellung ${b.nr}`.slice(0, 127),
      amount: { currency_code: "EUR", value: wert(b.brutto) },
    }],
    application_context: { brand_name: "Domo Gastro", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", locale: "de-DE" },
  });
  return { id: d.id };
}

// Prüft die PayPal-Bestellung gegen Betrag und Fingerabdruck, ohne Geld zu bewegen. Gibt die Bestellnummer zurück.
export async function pruefen(env, id, b, abruf = fetch) {
  if (!/^[A-Z0-9]{8,40}$/.test(String(id))) return { fehler: "Ungültige Zahlung." };
  const o = await rufen(env, abruf, `/v2/checkout/orders/${id}`, "GET");
  const pu = o.purchase_units?.[0] || {};
  if (pu.custom_id !== b.abdruck || pu.amount?.value !== wert(b.brutto) || pu.amount?.currency_code !== "EUR" || !/^DG-\d{6}-[A-Z0-9]{4,12}$/.test(pu.invoice_id || ""))
    return { fehler: "Die Zahlung passt nicht zur Bestellung. Es wurde nichts abgebucht." };
  return { nr: pu.invoice_id };
}

export async function einziehen(env, id, abruf = fetch) {
  const c = await rufen(env, abruf, `/v2/checkout/orders/${id}/capture`, "POST", {}, { "PayPal-Request-Id": `dg-${id}` });
  const cap = c.purchase_units?.[0]?.payments?.captures?.[0];
  if (c.status !== "COMPLETED" || cap?.status !== "COMPLETED")
    return { fehler: "PayPal hat die Zahlung nicht abgeschlossen. Bitte erneut versuchen oder Überweisung wählen." };
  return { transaktion: cap.id };
}
