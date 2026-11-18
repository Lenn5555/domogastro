// E-Mails über Resend (Region EU). Ohne RESEND_API_KEY wird nichts verschickt, nur protokolliert.
import TEXTE from "./texte.json" with { type: "json" };
import { euro, runden } from "./hilfe.js";

// Jede Mail geht als Text UND als schlichte HTML-Version raus (beides senkt die Spam-Wertung). anhaenge: [{ filename, content (Base64) }]
export async function senden(env, an, betreff, text, { abruf = fetch, anhaenge } = {}) {
  if (!env.RESEND_API_KEY) { console.log(`[Mail nicht verschickt, kein RESEND_API_KEY] an ${an}: ${betreff}${anhaenge ? ` (+${anhaenge.length} Anhang)` : ""}`); return false; }
  const r = await abruf("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.ABSENDER, to: [an], subject: betreff, text, html: alsHtml(text), reply_to: env.BESTELL_EMAIL,
      ...(anhaenge?.length ? { attachments: anhaenge } : {}) }),
  });
  if (!r.ok) console.error("Resend:", r.status, await r.text().catch(() => ""));
  return r.ok;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function alsHtml(text) {
  const inhalt = esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0E7FA0;word-break:break-all">$1</a>')
    .replace(/^ {2,}/gm, (m) => "&nbsp;".repeat(m.length))
    .replace(/\n/g, "<br>");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#EEF2F6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px">
<tr><td style="background:#0A1628;padding:22px 28px;border-radius:10px 10px 0 0;color:#ffffff;font:600 24px Georgia,'Times New Roman',serif">Domo Gastro
<div style="font:600 11px Arial,Helvetica,sans-serif;letter-spacing:2px;color:#B8C4D4;margin-top:6px">ZUHAUSE IN DER GASTRONOMIE</div></td></tr>
<tr><td style="padding:28px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#0A1628">${inhalt}</td></tr>
<tr><td style="padding:16px 28px;background:#F5F7FA;border-radius:0 0 10px 10px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#5A6B80">T&amp;S Systemtechnik GmbH · Am Hintergraben 26 · 64319 Pfungstadt · sales@ts-systec.de</td></tr>
</table></td></tr></table></body></html>`;
}

// Rechtstexte als PDF-Anhang (Textform, § 312f BGB): AGB immer, Widerrufsbelehrung mit Muster-Formular für Verbraucher
export function rechtsAnhaenge(b) {
  const a = [{ filename: "AGB-Domo-Gastro.pdf", content: TEXTE.agb_pdf }];
  if (b.modus === "privat") a.push({ filename: "Widerrufsbelehrung-und-Formular-Domo-Gastro.pdf", content: TEXTE.widerruf_pdf });
  return a;
}

// Eigene kurze Mail mit der Bankverbindung (Vorkasse)
export function zahlungsmail(env, b) {
  return `Guten Tag ${b.kunde.name},

für Ihre Bestellung ${b.nr} bitten wir Sie, ${euro(b.brutto)} innerhalb von 7 Tagen zu überweisen:

  Empfänger: ${env.BANK_INHABER}
  IBAN: ${env.BANK_IBAN}
  Betrag: ${euro(b.brutto)}
  Verwendungszweck: ${b.nr}

Sobald das Geld da ist, versenden wir Ihre Bestellung.

Freundliche Grüße
Ihr Domo-Gastro-Team`;
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
  const g = b.kunde?.gutschein;
  const rabatt = g ? `Warenwert netto: ${euro(runden(b.netto + g.rabatt))}\nGutschein ${g.code} (${g.prozent} %): −${euro(g.rabatt)}\nnach Gutschein netto: ${euro(b.netto)}` : `Warenwert netto: ${euro(b.netto)}`;
  return `${rabatt}\nzzgl. 19 % MwSt.: ${euro(b.mwst)}\nVersand (Deutschland): kostenlos\nGesamtbetrag: ${euro(b.brutto)}`;
}
function adresse(k) {
  return [k.firma, k.name, k.strasse, `${k.plz} ${k.ort}`, k.telefon && `Tel. ${k.telefon}`, k.ustid && `USt-IdNr. ${k.ustid}`].filter(Boolean).join("\n");
}
function lieferadresse(k) {
  const l = k.liefer;
  return l ? [l.firma, l.name, l.strasse, `${l.plz} ${l.ort}`].filter(Boolean).join("\n") : "wie Rechnungsadresse";
}
function adressen(k) {
  return `Rechnungsadresse:\n${adresse(k)}\n\nLieferadresse:\n${lieferadresse(k)}`;
}

// Eingangsbestätigung an den Kunden. Für Verbraucher mit Widerrufsbelehrung und Muster-Formular (Textform, § 312f BGB).
export function kundenmail(env, b) {
  const privat = b.modus === "privat";
  const zahlung = b.zahlart === "Vorkasse"
    ? `Die Bankverbindung für Ihre Überweisung schicken wir Ihnen gleich in einer eigenen E-Mail. Wir versenden nach Zahlungseingang.`
    : `Ihre Zahlung über PayPal ist eingegangen. Vielen Dank!`;
  return `Guten Tag ${b.kunde.name},

vielen Dank für Ihre Bestellung bei Domo Gastro. Wir haben sie erhalten und prüfen sie jetzt. Diese E-Mail bestätigt den Eingang Ihrer Bestellung; die Annahme erfolgt nach unseren AGB mit der Auftragsbestätigung bzw. dem Versand.

Bestellnummer: ${b.nr}
Bestellt als: ${privat ? "Privatkunde" : "Gewerbekunde"}

${posten(b)}

${summen(b)}

Zahlart: ${b.zahlart}
${zahlung}

${adressen(b.kunde)}

Status Ihrer Bestellung: ${env.SITE_URL}/bestellung/?nr=${encodeURIComponent(b.nr)}&email=${encodeURIComponent(b.email)}

Freundliche Grüße
Ihr Domo-Gastro-Team

Im Anhang finden Sie unsere AGB${privat ? " sowie die Widerrufsbelehrung mit Muster-Widerrufsformular" : ""} als PDF.`;
}

export function vertriebsmail(env, b) {
  return `Neue Bestellung ${b.nr} (${b.modus === "privat" ? "PRIVAT" : "GEWERBE"}) – ${b.zahlart}${b.status === "bezahlt" ? `, BEZAHLT (PayPal ${b.transaktion})` : ", Zahlung offen"}

${posten(b)}

${summen(b)}

Kunde (${b.email}${b.kunde_id ? ", mit Konto" : ", Gast"})

${adressen(b.kunde)}
${b.kunde.hinweis ? `\nHinweis: ${b.kunde.hinweis}` : ""}

Status ändern: ${env.SITE_URL}/verwaltung/`;
}

// Dank für die Bewertung mit persönlichem Gutscheincode
export function gutscheinmail(env, name, code, prozent) {
  return `Guten Tag ${name},

vielen Dank für Ihre Bewertung! Als Dankeschön erhalten Sie ${prozent} % Rabatt auf Ihre nächste Bestellung bei Domo Gastro.

Ihr persönlicher Gutscheincode: ${code}

So lösen Sie ihn ein: Geben Sie den Code im Warenkorb unter „Gutscheincode“ ein. Er gilt einmal, für den gesamten Warenwert einer Bestellung, und ist nicht mit anderen Gutscheinen kombinierbar. Eine Barauszahlung ist nicht möglich.

Zum Shop: ${env.SITE_URL}/

Freundliche Grüße
Ihr Domo-Gastro-Team`;
}

// Einmalige Bitte um Bewertung, nur nach Zustimmung beim Bestellen
export function bewertungsmail(env, b, produkte) {
  return `Guten Tag ${b.kunde.name},

Ihre Bestellung ${b.nr} sollte inzwischen bei Ihnen angekommen sein. Wir hoffen, Sie sind zufrieden!

Würden Sie Ihre Artikel kurz bewerten? Ein paar Sterne genügen, ein Kommentar ist freiwillig. Damit helfen Sie anderen Kundinnen und Kunden bei der Auswahl.

${produkte.map((p) => `  ${p.name}\n  ${env.SITE_URL}/produkt/${p.slug}/#bewertungen`).join("\n\n")}

Zum Bewerten melden Sie sich mit Ihrem Kundenkonto an.

Freundliche Grüße
Ihr Domo-Gastro-Team

Sie erhalten diese einmalige E-Mail, weil Sie beim Bestellen zugestimmt haben. Weitere E-Mails dieser Art bekommen Sie zu dieser Bestellung nicht.`;
}

export function statusmail(env, b) {
  return `Guten Tag ${b.kunde.name},

der Status Ihrer Bestellung ${b.nr} hat sich geändert: ${statusText(b.status)}.${b.sendung ? `\nSendungsverfolgung: ${b.sendung}` : ""}

Details: ${env.SITE_URL}/bestellung/?nr=${encodeURIComponent(b.nr)}&email=${encodeURIComponent(b.email)}

Freundliche Grüße
Ihr Domo-Gastro-Team`;
}
