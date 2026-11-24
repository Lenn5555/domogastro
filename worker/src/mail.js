// E-Mails über Resend (Region EU). Ohne RESEND_API_KEY wird nichts verschickt, nur protokolliert.
import TEXTE from "./texte.json" with { type: "json" };
import { euro, runden } from "./hilfe.js";

// Jede Mail geht als Text UND als schlichte HTML-Version raus (beides senkt die Spam-Wertung). anhaenge: [{ filename, content (Base64) }]
export async function senden(env, an, betreff, text, { abruf = fetch, anhaenge, kopf } = {}) {
  if (!env.RESEND_API_KEY) { console.log(`[Mail nicht verschickt, kein RESEND_API_KEY] an ${an}: ${betreff}${anhaenge ? ` (+${anhaenge.length} Anhang)` : ""}`); return false; }
  const r = await abruf("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.ABSENDER, to: [an], subject: betreff, text, html: alsHtml(text), reply_to: env.BESTELL_EMAIL, ...(kopf ? { headers: kopf } : {}),
      attachments: [{ filename: "domo-gastro-logo.png", content: TEXTE.logo_png, content_id: "logo" }, ...(anhaenge || [])] }),
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
<tr><td align="center" style="background:#0A1628;padding:18px 28px;border-radius:10px 10px 0 0;color:#ffffff;font:600 24px Georgia,'Times New Roman',serif"><img src="cid:logo" width="250" height="92" alt="Domo Gastro – Zuhause in der Gastronomie" style="display:block;width:250px;height:auto;border:0;color:#ffffff"></td></tr>
<tr><td style="padding:28px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#0A1628">${inhalt}</td></tr>
<tr><td style="padding:16px 28px;background:#F5F7FA;border-radius:0 0 10px 10px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#5A6B80">T&amp;S Systemtechnik GmbH · Am Hintergraben 26 · 64319 Pfungstadt · sales@ts-systec.de · WEEE-Reg.-Nr. DE 43932288</td></tr>
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
  return b.positionen.map((p) => `  ${p.menge} × ${p.name} (Art.-Nr. ${p.sku})  je ${euro(p.netto)} netto${p.netto_vorher ? ` (statt ${euro(p.netto_vorher)}, ${b.steuer?.aktion?.name || "Aktion"} −${b.steuer?.aktion?.prozent || ""} %)` : ""}`).join("\n");
}
// Steuerhinweis je Art (Lenn 2026-11-19, Auslandsversand)
export function steuerHinweis(st) {
  if (!st) return "";
  if (st.art === "IG") return "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b, § 6a UStG). Den Erwerb versteuern Sie als Empfänger in Ihrem Land.";
  if (st.art === "AUSFUHR") return "Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a, § 6 UStG). Einfuhrumsatzsteuer, Zölle und Gebühren des Empfängerlandes zahlen Sie bei der Zustellung.";
  if (st.art === "OSS") return `Umsatzsteuer des Lieferlandes ${st.landname} (${String(st.satz).replace(".", ",")} %).`;
  return "";
}
const MEHRVERSAND = "Bei sehr großen Mengen oder schweren und sperrigen Geräten können höhere Versandkosten anfallen. Dann melden wir uns vor dem Versand mit dem Mehrbetrag und einer gesonderten Zahlungsaufforderung; sind Sie nicht einverstanden, können Sie kostenlos stornieren.";
function summen(b) {
  const g = b.kunde?.gutschein;
  const st = b.kunde?.steuer;
  const warenwert = st ? st.warenwert : runden(b.netto + (g ? g.rabatt : 0));
  const versand = !st || !st.land || st.land === "DE" ? "Versand (Deutschland): kostenlos"
    : `Versand nach ${st.landname}: ${euro(st.versand)} netto`;
  const satz = st ? String(st.satz).replace(".", ",") : "19";
  const rabatt = g ? `Warenwert netto: ${euro(warenwert)}\nGutschein ${g.code} (${g.prozent} %): −${euro(g.rabatt)}` : `Warenwert netto: ${euro(warenwert)}`;
  const steuer = st && st.satz === 0 ? `Umsatzsteuer: 0,00 € (${steuerHinweis(st)})` : `zzgl. ${satz} % MwSt.: ${euro(b.mwst)}`;
  const mehr = st && st.land && st.land !== "DE" ? `\n${MEHRVERSAND}` : "";
  return `${rabatt}\n${versand}\n${steuer}\nGesamtbetrag: ${euro(b.brutto)}${st?.art === "OSS" ? `\n${steuerHinweis(st)}` : ""}${mehr}`;
}
const landZeile = (k) => k.steuer?.landname && k.steuer.land !== "DE" ? k.steuer.landname.replace(/ \(.*\)$/, "").toUpperCase() : "";
function adresse(k) {
  return [k.firma, k.name, k.strasse, `${k.plz} ${k.ort}`, k.liefer ? "" : landZeile(k), k.telefon && `Tel. ${k.telefon}`, k.ustid && `USt-IdNr. ${k.ustid}`].filter(Boolean).join("\n");
}
function lieferadresse(k) {
  const l = k.liefer;
  return l ? [l.firma, l.name, l.strasse, `${l.plz} ${l.ort}`, landZeile(k)].filter(Boolean).join("\n") : "wie Rechnungsadresse";
}
function adressen(k) {
  return `Rechnungsadresse:\n${adresse(k)}\n\nLieferadresse:\n${lieferadresse(k)}`;
}

// Eingangsbestätigung an den Kunden. Für Verbraucher mit Widerrufsbelehrung und Muster-Formular (Textform, § 312f BGB).
export function kundenmail(env, b) {
  const privat = b.modus === "privat";
  const zahlung = b.zahlart === "Vorkasse"
    ? `Die Bankverbindung für Ihre Überweisung schicken wir Ihnen gleich in einer eigenen E-Mail. Wir versenden nach Zahlungseingang.`
    : `Ihre Zahlung ${b.zahlart === "Kreditkarte" ? "per Kreditkarte (über PayPal)" : "über PayPal"} ist eingegangen. Vielen Dank! Wir versenden Ihre Bestellung jetzt.`;
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

function vertriebSteuer(b) {
  const st = b.kunde?.steuer, u = b.kunde?.ustid_pruefung;
  if (!st || st.art === "DE") return "";
  if (st.art === "IG") return `\n\nAUSLAND EU, GEWERBE: steuerfreie innergemeinschaftliche Lieferung nach ${st.landname}.
USt-IdNr. ${u?.ustid} geprüft bei VIES am ${u?.zeit?.slice(0, 16).replace("T", " ")} (Abfragenummer ${u?.abfrage || "–"}, Name laut VIES: ${u?.name || "–"}).
Rechnung: Hinweis „Steuerfreie innergemeinschaftliche Lieferung“ + beide USt-IdNrn.; in der Zusammenfassenden Meldung angeben; GLS-Sendungsnachweis aufheben.`;
  if (st.art === "AUSFUHR") return `\n\nAUSFUHR nach ${st.landname}: steuerfrei, Handelsrechnung/Zollpapiere für GLS beilegen, Ausfuhrnachweis aufheben.`;
  return `\n\nAUSLAND EU, PRIVAT: ${String(st.satz).replace(".", ",")} % MwSt. ${st.landname} berechnet, über das OSS-Verfahren melden.`;
}

export function vertriebsmail(env, b) {
  return `Neue Bestellung ${b.nr} (${b.modus === "privat" ? "PRIVAT" : "GEWERBE"}) – ${b.zahlart}${b.status === "bezahlt" ? `, BEZAHLT (über PayPal, Transaktion ${b.transaktion})` : ", Zahlung offen"}

${posten(b)}

${summen(b)}

Kunde (${b.email}${b.kunde_id ? ", mit Konto" : ", Gast"})

${adressen(b.kunde)}
${b.kunde.hinweis ? `\nHinweis: ${b.kunde.hinweis}` : ""}${vertriebSteuer(b)}

Status ändern: ${env.SITE_URL}/verwaltung/`;
}

// Dank für die Bewertung mit persönlichem Gutscheincode
export function gutscheinmail(env, name, code, prozent) {
  return `Guten Tag ${name},

vielen Dank für Ihre Bewertung! Als Dankeschön erhalten Sie ${prozent} % Rabatt auf Ihre nächste Bestellung bei Domo Gastro.

Ihr persönlicher Gutscheincode: ${code}

So lösen Sie ihn ein: Geben Sie den Code im Warenkorb unter „Gutscheincode“ ein. Er gilt einmal, für den gesamten Warenwert einer Bestellung, und ist nicht mit anderen Gutscheinen oder laufenden Rabattaktionen kombinierbar. Eine Barauszahlung ist nicht möglich.

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

// Versand mit GLS (Lenn 2026-11-19)
export const verfolgen = (sendung) =>
  /^https?:\/\//.test(sendung) ? sendung : `https://gls-group.com/DE/de/paketverfolgung?match=${encodeURIComponent(sendung)}`;

export function statusmail(env, b) {
  return `Guten Tag ${b.kunde.name},

der Status Ihrer Bestellung ${b.nr} hat sich geändert: ${statusText(b.status)}.${b.sendung ? `\nSendungsverfolgung (GLS): ${verfolgen(b.sendung)}` : ""}

Details: ${env.SITE_URL}/bestellung/?nr=${encodeURIComponent(b.nr)}&email=${encodeURIComponent(b.email)}

Freundliche Grüße
Ihr Domo-Gastro-Team`;
}

/* ---------- Widerruf ---------- */
const stueck = (pos) => pos.map((p) => `  ${p.menge} × ${p.name} (Art.-Nr. ${p.sku})`).join("\n");
const zeit = (iso) => new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long", timeStyle: "short" });
const zahlweg = (b) => b.zahlart === "Vorkasse" ? "per Überweisung auf Ihr Konto (bitte senden Sie uns dazu Ihre IBAN, falls sie von der Zahlung abweicht)" : `über ${b.zahlart === "Kreditkarte" ? "PayPal zurück auf Ihre Kreditkarte" : "PayPal"}`;

export function widerrufKunde(env, b, w) {
  return `Guten Tag ${b.kunde.name},

wir haben Ihren Widerruf am ${zeit(w.datum)} Uhr erhalten. Diese E-Mail bestätigt den Eingang.

Bestellnummer: ${b.nr}
Widerrufene Artikel:
${stueck(w.positionen)}
${w.grund ? `\nIhre Anmerkung: ${w.grund}\n` : ""}
So geht es weiter:
1. Bitte schicken Sie die Ware innerhalb von 14 Tagen an:
   ${env.RUECKSENDE_ADRESSE}
   Legen Sie bitte einen Zettel mit der Bestellnummer ${b.nr} bei. Die Kosten der Rücksendung tragen Sie (siehe Widerrufsbelehrung).
2. Große Geräte, die per Spedition kamen: Antworten Sie bitte einfach auf diese E-Mail. Wir organisieren die Abholung und sagen Ihnen vorher die Kosten.
3. Ist die Ware noch gar nicht bei Ihnen angekommen, müssen Sie nichts zurückschicken. Wir halten den Versand an, soweit das noch geht.

Sobald die Ware bei uns ist oder Sie uns den Versand nachweisen, erstatten wir den Kaufpreis ${zahlweg(b)}, spätestens 14 Tage nach Eingang Ihres Widerrufs. Sie bekommen dann eine E-Mail.

Status Ihrer Bestellung: ${env.SITE_URL}/bestellung/?nr=${encodeURIComponent(b.nr)}&email=${encodeURIComponent(b.email)}

Freundliche Grüße
Ihr Domo-Gastro-Team`;
}

export function widerrufVertrieb(env, b, w) {
  const tage = Math.floor((Date.now() - new Date(b.datum).getTime()) / 86400000);
  return `Widerruf zu Bestellung ${b.nr} (${b.modus === "privat" ? "Privatkunde" : "GEWERBEKUNDE – gesetzliches Widerrufsrecht gilt nicht, bitte prüfen"})
Eingegangen: ${zeit(w.datum)} Uhr, ${tage} Tage nach der Bestellung${tage > 30 ? " (bitte Frist prüfen: 14 Tage ab Erhalt der Ware)" : ""}

${stueck(w.positionen)}
${w.grund ? `\nAnmerkung des Kunden: ${w.grund}\n` : ""}
Anteiliger Kaufpreis (Vorschlag für die Erstattung): ${euro(w.vorschlag)}
Bezahlt per ${b.zahlart}${b.transaktion ? `, PayPal-Transaktion ${b.transaktion}` : ""}
Kunde: ${b.kunde.name}, ${b.email}${b.kunde.telefon ? `, ${b.kunde.telefon}` : ""}

Erledigen: ${env.SITE_URL}/verwaltung/
Erstatten musst du spätestens 14 Tage nach Eingang des Widerrufs; du darfst warten, bis die Ware zurück ist oder der Kunde den Versand nachweist.`;
}

export function erstattetMail(env, b, w) {
  return `Guten Tag ${b.kunde.name},

zu Ihrem Widerruf der Bestellung ${b.nr} haben wir ${euro(w.betrag)} ${zahlweg(b).replace(/^per Überweisung auf Ihr Konto.*$/, "per Überweisung auf Ihr Konto")} erstattet.
${w.betrag < w.vorschlag - 0.005 ? `\nDer Kaufpreis der Artikel betrug ${euro(w.vorschlag)}. Den Unterschied haben wir als Wertersatz bzw. Rücksendekosten abgezogen; bei Fragen antworten Sie einfach auf diese E-Mail.\n` : ""}
Widerrufene Artikel:
${stueck(w.positionen)}

Je nach Bank bzw. PayPal kann es einige Tage dauern, bis der Betrag bei Ihnen sichtbar ist.

Freundliche Grüße
Ihr Domo-Gastro-Team`;
}
