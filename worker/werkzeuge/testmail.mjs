// Schickt eine Muster-Bestellbestätigung (mit PDF-Anhängen) und die Zahlungsmail über Resend,
// genau so, wie der Shop sie verschickt. Zum Prüfen, ob die Mails im Posteingang statt im Spam landen.
// Aufruf: RESEND_API_KEY=… TESTMAIL_AN=adresse node werkzeuge/testmail.mjs
import { senden, kundenmail, zahlungsmail, rechtsAnhaenge } from "../src/mail.js";
import { readFileSync } from "node:fs";

const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const wert = (k) => (toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m")) || [])[1];
const env = { RESEND_API_KEY: process.env.RESEND_API_KEY, ABSENDER: wert("ABSENDER"), BESTELL_EMAIL: wert("BESTELL_EMAIL"),
  SITE_URL: wert("SITE_URL"), BANK_INHABER: wert("BANK_INHABER"), BANK_IBAN: wert("BANK_IBAN") };
const an = (process.env.TESTMAIL_AN || "").trim() || env.BESTELL_EMAIL;
if (!env.RESEND_API_KEY) { console.error("RESEND_API_KEY fehlt"); process.exit(1); }

const b = {
  nr: "DG-TEST-" + new Date().toISOString().slice(0, 10).replaceAll("-", ""), email: an, modus: "privat", zahlart: "Vorkasse",
  positionen: [{ menge: 1, name: "Stabmixer (Testbestellung)", sku: "TEST-001", netto: 49.9 }],
  netto: 49.9, mwst: 9.48, brutto: 59.38,
  kunde: { name: "Test Kunde", strasse: "Am Hintergraben 26", plz: "64319", ort: "Pfungstadt" },
};
const ok1 = await senden(env, an, `Ihre Bestellung ${b.nr} bei Domo Gastro`, kundenmail(env, b), { anhaenge: rechtsAnhaenge(b) });
const ok2 = await senden(env, an, `Zahlungsinformationen zu Ihrer Bestellung ${b.nr}`, zahlungsmail(env, b));
console.log(`Bestellbestätigung: ${ok1 ? "verschickt" : "FEHLER"}, Zahlungsmail: ${ok2 ? "verschickt" : "FEHLER"}`);
process.exit(ok1 && ok2 ? 0 : 1);
