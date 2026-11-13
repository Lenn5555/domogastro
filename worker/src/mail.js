// E-Mails über Resend (Region EU). Ohne RESEND_API_KEY wird nichts verschickt, nur protokolliert.
import TEXTE from "./texte.json" with { type: "json" };
import { euro } from "./hilfe.js";

export async function senden(env, an, betreff, text, abruf = fetch) {
  if (!env.RESEND_API_KEY) { console.log(`[Mail nicht verschickt, kein RESEND_API_KEY] an ${an}: ${betreff}`); return false; }
  const r = await abruf("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.ABSENDER, to: [an], subject: betreff, text, reply_to: env.BESTELL_EMAIL }),
  });
  if (!r.ok) console.error("Resend:", r.status, await r.text().catch(() => ""));
  return r.ok;
}

const STATUS = {
  eingegangen: "eingegangen", zahlung_offen: "Zahlung offen", bezahlt: "bezahlt", in_bearbeitung: "in Bearbeitung",
  versendet: "versendet", zugestellt: "zugestellt", storniert: "storniert",
};
export const statusText = (s) => STATUS[s] || s;

function posten(b) {
  return b.positionen.map((p) => `  ${p.menge} × ${p.name} (Art.-Nr. ${p.sku})  je ${euro(p.netto)} netto`).join("\n");
}
function summen(b) {
  return `Warenwert netto: ${euro(b.netto)}\nzzgl. 19 % MwSt.: ${euro(b.mwst)}\nVersand (Deutschland): kostenlos\nGesamtbetrag: ${euro(b.brutto)}`;
}
function adresse(k) {
  return [k.firma, k.name, k.strasse, `${k.plz} ${k.ort}`, k.telefon && `Tel. ${k.telefon}`, k.ustid && `USt-IdNr. ${k.ustid}`].filter(Boolean).join("\n");
}

// Eingangsbestätigung an den Kunden. Für Verbraucher mit Widerrufsbelehrung und Muster-Formular (Textform, § 312f BGB).
export function kundenmail(env, b) {
  const privat = b.modus === "privat";
  const zahlung = b.zahlart === "Vorkasse"
    ? `Bitte überweisen Sie ${euro(b.brutto)} innerhalb von 7 Tagen an:\n  ${env.BANK_INHABER}\n  IBAN ${env.BANK_IBAN}\n  Verwendungszweck: ${b.nr}\nWir versenden nach Zahlungseingang.`
    : `Ihre Zahlung über PayPal ist eingegangen. Vielen Dank!`;
  return `Guten Tag ${b.kunde.name},

vielen Dank für Ihre Bestellung bei Domo Gastro. Wir haben sie erhalten und prüfen sie jetzt. Diese E-Mail bestätigt den Eingang Ihrer Bestellung; die Annahme erfolgt nach unseren AGB mit der Auftragsbestätigung bzw. dem Versand.

Bestellnummer: ${b.nr}
Bestellt als: ${privat ? "Privatkunde" : "Gewerbekunde"}

${posten(b)}

${summen(b)}

Zahlart: ${b.zahlart}
${zahlung}

Lieferadresse:
${adresse(b.kunde)}

Status Ihrer Bestellung: ${env.SITE_URL}/bestellung/?nr=${encodeURIComponent(b.nr)}&email=${encodeURIComponent(b.email)}

Freundliche Grüße
Ihr Domo-Gastro-Team
T&S Systemtechnik GmbH · Am Hintergraben 26 · 64319 Pfungstadt · sales@ts-systec.de

————————————————————————————————————————
ALLGEMEINE GESCHÄFTSBEDINGUNGEN
${TEXTE.agb}
${privat ? `
————————————————————————————————————————
${TEXTE.widerruf}` : ""}`;
}

export function vertriebsmail(env, b) {
  return `Neue Bestellung ${b.nr} (${b.modus === "privat" ? "PRIVAT" : "GEWERBE"}) – ${b.zahlart}${b.status === "bezahlt" ? `, BEZAHLT (PayPal ${b.transaktion})` : ", Zahlung offen"}

${posten(b)}

${summen(b)}

Kunde (${b.email}${b.kunde_id ? ", mit Konto" : ", Gast"}):
${adresse(b.kunde)}
${b.kunde.hinweis ? `\nHinweis: ${b.kunde.hinweis}` : ""}

Status ändern: ${env.SITE_URL}/verwaltung/`;
}

export function statusmail(env, b) {
  return `Guten Tag ${b.kunde.name},

der Status Ihrer Bestellung ${b.nr} hat sich geändert: ${statusText(b.status)}.${b.sendung ? `\nSendungsverfolgung: ${b.sendung}` : ""}

Details: ${env.SITE_URL}/bestellung/?nr=${encodeURIComponent(b.nr)}&email=${encodeURIComponent(b.email)}

Freundliche Grüße
Ihr Domo-Gastro-Team`;
}
