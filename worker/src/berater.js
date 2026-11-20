// KI-Berater für Domo Gastro, aufgebaut wie bei beinundfuss.de (Lenn 2026-11-19):
// Claude bekommt den Katalog (nur Produkte mit Preis, nur öffentliche Angaben) und zeigt passende Produkte über ein Werkzeug an.
// Der Schlüssel liegt als Worker-Secret ANTHROPIC_API_KEY bei Cloudflare, nie im Browser.
import Anthropic from "@anthropic-ai/sdk";
import KATALOG from "./berater.json" with { type: "json" };

export const MODELL = "claude-opus-5-5";
const MAX_RUNDEN = 4;
const MAX_ANZEIGE = 4;
export const MAX_NACHRICHTEN = 20;
export const MAX_ZEICHEN = 1500;

export const NACH_SLUG = new Map(KATALOG.map((p) => [p.s, p]));

const zeile = (p) => `- ${p.s} | ${p.n} | ${p.k} | ${p.h} | ${p.m}${p.ma ? ` | ${p.ma}` : ""} | netto ${p.p}`;

const ANLEITUNG = `Sie sind Domo, der Produktberater von Domo Gastro (domogastro.de), dem Shop der T&S Systemtechnik GmbH für Profigeräte und Ausstattung für Gastronomie, Hotellerie, Cafés, Imbisse und die Küche zu Hause. Kunden sind Gewerbetreibende und Privatleute.

So beraten Sie:
- Antworten Sie auf Deutsch, kurz und freundlich, per Sie. Höchstens fünf Sätze pro Antwort, keine Tabellen, keine Aufzählungen mit mehr als vier Punkten.
- Fehlt Ihnen für eine sinnvolle Auswahl Wichtiges, fragen Sie gezielt nach, höchstens zwei Fragen auf einmal. Typisch: Einsatz (Restaurant, Imbiss, Café, Hotel, zu Hause), Menge oder Leistung (Portionen, Liter, Personen), verfügbarer Platz (Breite, Tiefe), Anschluss (230 V, 400 V, Gas), Budget.
- Bei Abzugshauben: Die Haube sollte rundum etwa 15 bis 20 cm größer sein als die Geräte darunter. Die Haube gibt es in festen Breiten.
- Empfehlen Sie ausschließlich Produkte aus dem Katalog unten. Erfinden Sie keine Produkte, Maße, Leistungen oder Preise. Was nicht im Katalog steht, wissen Sie nicht.
- Sobald Sie passende Produkte nennen, rufen Sie das Werkzeug produkte_zeigen mit deren Kennungen auf (höchstens ${MAX_ANZEIGE}, das beste zuerst). Nur so sieht der Kunde die Produkte mit Bild, Preis und Link. Sagen Sie im Text in einem Satz, warum Sie diese gewählt haben.
- Nennen Sie im Text keine Preise und keine Kennungen. Die Produktkarten zeigen den Preis passend für Privat- oder Gewerbekunden. Beschreiben Sie Produkte mit Namen und Merkmalen.
- Versand innerhalb Deutschlands ist kostenlos. In die meisten EU-Länder, die Schweiz und Liechtenstein liefern wir zu einem festen Versandpreis je Bestellung und Land, egal wie schwer oder wie viele Artikel; den Betrag zeigt der Warenkorb. Bei sehr großen Mengen oder schweren Geräten können höhere Versandkosten anfallen, die wir vor dem Versand gesondert anfragen; alle Preise stehen auf der Seite „Versand und Zahlung“. Bezahlt wird per Überweisung, Kreditkarte oder PayPal.
- Passt nichts im Katalog, sagen Sie das offen und verweisen Sie auf eine Anfrage per E-Mail an sales@ts-systec.de.
- Für Installation, Gas- und Starkstromanschluss und Abluftplanung verweisen Sie auf einen Fachbetrieb. Garantieren Sie keine Leistungswerte; verbindlich sind Produktseite und Datenblatt.
- Bleiben Sie beim Thema Gastronomie- und Küchenausstattung. Andere Anfragen lehnen Sie höflich ab.
- Einkaufspreise, Lieferanten oder interne Daten kennen Sie nicht und spekulieren nicht darüber.

Katalog (Kennung | Name | Kategorie | Hersteller | Merkmale | Maße | Preis netto zzgl. MwSt.):
`;

export const SYSTEM = ANLEITUNG + KATALOG.map(zeile).join("\n");

export const WERKZEUGE = [{
  name: "produkte_zeigen",
  description: `Zeigt dem Kunden Produktkarten mit Bild, Preis und Link zur Produktseite. Nur Kennungen aus dem Katalog verwenden, höchstens ${MAX_ANZEIGE}, das am besten passende zuerst.`,
  strict: true,
  input_schema: {
    type: "object",
    properties: { kennungen: { type: "array", items: { type: "string" }, description: "Kennungen aus dem Katalog" } },
    required: ["kennungen"],
    additionalProperties: false,
  },
}];

export function produkteZeigen(eingabe) {
  const liste = Array.isArray(eingabe?.kennungen) ? eingabe.kennungen.filter((x) => typeof x === "string") : [];
  if (!liste.length) return { fehler: "kennungen fehlt oder ist leer" };
  const gefunden = [], unbekannt = [];
  for (const s of [...new Set(liste)].slice(0, MAX_ANZEIGE)) (NACH_SLUG.has(s) ? gefunden : unbekannt).push(s);
  if (!gefunden.length) return { fehler: `Unbekannte Kennungen: ${unbekannt.join(", ")}. Nur Kennungen aus dem Katalog verwenden.` };
  return { slugs: gefunden, unbekannt };
}

// verlauf: [{rolle: "kunde"|"berater", text}] aus dem Browser; nur Text, keine Werkzeugblöcke
export function nachrichtenAus(verlauf) {
  const messages = [];
  for (const m of verlauf) {
    const role = m.rolle === "berater" ? "assistant" : "user";
    if (!messages.length && role === "assistant") continue; // erste Nachricht muss vom Kunden sein
    messages.push({ role, content: m.text });
  }
  return messages;
}

export function verlaufPruefen(daten) {
  const v = Array.isArray(daten?.verlauf) ? daten.verlauf.slice(-MAX_NACHRICHTEN) : [];
  const sauber = v.filter((m) => m && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ rolle: m.rolle === "berater" ? "berater" : "kunde", text: m.text.slice(0, MAX_ZEICHEN) }));
  return sauber.length && sauber.at(-1).rolle === "kunde" ? sauber : null;
}

// Nach einem Modellwechsel (fallback-Block) gelten nur Werkzeugaufrufe danach; Denk- und Werkzeugblöcke davor
// werden nicht zurückgeschickt, der fallback-Block selbst bleibt an seiner Stelle.
export function nachWechsel(inhalt) {
  const grenze = inhalt.map((b) => b.type).lastIndexOf("fallback");
  if (grenze < 0) return inhalt;
  return inhalt.filter((b, i) => i >= grenze || !["thinking", "redacted_thinking", "tool_use", "server_tool_use"].includes(b.type));
}

export async function beraten(client, verlauf, modell = MODELL) {
  const messages = nachrichtenAus(verlauf);
  let slugs = [];
  let frueher = ""; // Text aus Runden mit Werkzeugaufruf; oft steht die eigentliche Antwort dort
  for (let runde = 0; runde < MAX_RUNDEN; runde++) {
    const antwort = await client.beta.messages.create({
      model: modell,
      max_tokens: 4000,
      output_config: { effort: "low" }, // Chat: lieber schnell; die Katalogauswahl braucht keine lange Denkzeit
      // Lehnt das Modell aus Sicherheitsgründen ab, übernimmt automatisch ein anderes Modell
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
      tools: WERKZEUGE,
      messages,
    });
    const inhalt = nachWechsel(antwort.content);
    const text = inhalt.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const aufrufe = inhalt.filter((b) => b.type === "tool_use");
    if (antwort.stop_reason === "refusal") {
      return { antwort: "Dazu kann ich leider nicht helfen. Bei Fragen zu Geräten für Gastronomie und Küche bin ich gern da.", produkte: [] };
    }
    if (antwort.stop_reason !== "tool_use" || !aufrufe.length) {
      return { antwort: text || frueher || "Entschuldigung, da ist etwas schiefgelaufen. Bitte formulieren Sie Ihre Frage noch einmal.", produkte: slugs };
    }
    if (text) frueher = frueher ? `${frueher}\n\n${text}` : text;
    messages.push({ role: "assistant", content: inhalt });
    const ergebnisse = aufrufe.map((a) => {
      const r = a.name === "produkte_zeigen" ? produkteZeigen(a.input) : { fehler: `Unbekanntes Werkzeug ${a.name}` };
      if (r.slugs) slugs = [...slugs, ...r.slugs.filter((s) => !slugs.includes(s))].slice(0, MAX_ANZEIGE);
      const ergebnisText = r.fehler ? r.fehler
        : `Dem Kunden angezeigt: ${r.slugs.join(", ")}` + (r.unbekannt.length ? `. Unbekannt und nicht angezeigt: ${r.unbekannt.join(", ")}` : "");
      return { type: "tool_result", tool_use_id: a.id, content: ergebnisText, ...(r.fehler ? { is_error: true } : {}) };
    });
    // Alles angezeigt und Text vorhanden: fertig, ohne zweite Runde (spart Zeit und Kosten; der Verlauf im Browser ist nur Text)
    if (text && ergebnisse.every((e) => !e.is_error && !/Unbekannt/.test(e.content))) return { antwort: frueher, produkte: slugs };
    messages.push({ role: "user", content: ergebnisse });
  }
  return { antwort: frueher || "Hier sind passende Produkte.", produkte: slugs };
}

export function neuerClient(env) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined }); // BASE_URL nur für lokale Tests
}
