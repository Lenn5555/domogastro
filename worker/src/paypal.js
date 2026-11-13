// PayPal per Weiterleitung (kein PayPal-Skript auf unserer Seite). Muster wie bei beinundfuss.de:
// Betrag entsteht nur auf dem Server, vor dem Einziehen wird geprüft, dass die PayPal-Bestellung genau passt.
// Zugangsdaten: Worker-Secrets PAYPAL_CLIENT_ID, PAYPAL_SECRET. PAYPAL_SANDBOX = "ja" = Testumgebung.

export const aktiv = (env) => Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET);
const basis = (env) => (env.PAYPAL_SANDBOX === "ja" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");
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
  if (!r.ok) throw new Error(`PayPal ${art} ${pfad}: ${r.status} ${d.name || ""}`.trim());
  return d;
}

// Legt die PayPal-Bestellung an und gibt die Adresse zurück, auf die der Kunde weitergeleitet wird
export async function anlegen(env, b, abruf = fetch) {
  const zurueck = `${env.SITE_URL}/bestellung/?paypal=${encodeURIComponent(b.nr)}`;
  const d = await rufen(env, abruf, "/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: b.nr, invoice_id: b.nr, custom_id: b.nr,
      description: `Domo Gastro Bestellung ${b.nr}`.slice(0, 127),
      amount: { currency_code: "EUR", value: wert(b.brutto) },
    }],
    payment_source: { paypal: { experience_context: {
      brand_name: "Domo Gastro", locale: "de-DE", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW",
      return_url: zurueck, cancel_url: `${env.SITE_URL}/warenkorb/`,
    } } },
  });
  const link = (d.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!link) throw new Error("PayPal hat keinen Bezahllink geliefert.");
  return { id: d.id, link: link.href };
}

export async function abschliessen(env, b, id, abruf = fetch) {
  if (!/^[A-Z0-9]{8,40}$/.test(String(id)) || id !== b.paypal_id) return { fehler: "Die Zahlung passt nicht zur Bestellung." };
  const o = await rufen(env, abruf, `/v2/checkout/orders/${id}`, "GET");
  const pu = o.purchase_units?.[0] || {};
  if (pu.invoice_id !== b.nr || pu.amount?.value !== wert(b.brutto) || pu.amount?.currency_code !== "EUR")
    return { fehler: "Die Zahlung passt nicht zur Bestellung. Es wurde nichts abgebucht." };
  const c = await rufen(env, abruf, `/v2/checkout/orders/${id}/capture`, "POST", {}, { "PayPal-Request-Id": `dg-${id}` });
  const cap = c.purchase_units?.[0]?.payments?.captures?.[0];
  if (c.status !== "COMPLETED" || cap?.status !== "COMPLETED")
    return { fehler: "PayPal hat die Zahlung nicht abgeschlossen. Bitte erneut versuchen oder Vorkasse wählen." };
  return { transaktion: cap.id };
}
