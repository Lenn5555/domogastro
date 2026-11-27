// KI-Raumplanung für den Raumplaner (Lenn 2026-11-27): Kunde nennt Raumgröße und beschreibt die Küche,
// Claude wählt Geräte aus dem Planer-Katalog und ordnet sie Wänden zu. Die genauen Positionen rechnet dieser
// Server selbst aus (Claude rechnet nicht in Koordinaten) und prüft sie; Fehler gehen zur Korrektur an Claude zurück.
// Nur öffentliche Angaben (Name, Bereich, Maße, Netto-Preis). Es wird nichts gespeichert.
import KATALOG from "./planer.json" with { type: "json" };
import { MODELL, nachWechsel } from "./berater.js";

const MAX_RUNDEN = 3;
const MAX_TEILE = 40;
export const MAX_ZEICHEN = 1500;
const GANG_MIN = 900;      // schmalster Arbeitsgang, den wir durchgehen lassen
const TUER = { w: 900, d: 900 };
export const WAENDE = ["oben", "unten", "links", "rechts", "insel"];

export const NACH_SKU = new Map(KATALOG.map((g) => [g.i, g]));
const haube = (g) => g.k === "Lüftung";

const zeile = (g) => `- ${g.i} | ${g.n} | ${g.k} | B ${g.w} × T ${g.d}${g.h ? ` × H ${g.h}` : ""} mm | netto ${g.p.toFixed(2)} €`;

const ANLEITUNG = `Sie sind Domo, der Küchenplaner von Domo Gastro (domogastro.de), dem Shop der T&S Systemtechnik GmbH für Gastronomie-Ausstattung.
Ein Kunde nennt die Größe seines Raums und beschreibt, was er braucht. Sie stellen daraus einen ersten Grundriss mit Geräten aus dem Katalog unten zusammen.

So sieht der Raum aus: Rechteck von oben gesehen. Breite = Wand „oben“ und „unten“, Tiefe = Wand „links“ und „rechts“. Maße in Millimetern.
Sie legen nur fest, welche Geräte in welcher Reihenfolge an welcher Wand stehen. Die genaue Position rechnet das Programm aus:
- „oben“: Geräte stehen nebeneinander an der oberen Wand, von links nach rechts, ab start_mm (Abstand zur linken Wand).
- „unten“: genauso an der unteren Wand, von links nach rechts, ab start_mm.
- „links“ und „rechts“: Geräte stehen an der Seitenwand, von oben nach unten, ab start_mm (Abstand zur oberen Wand). Die Gerätebreite läuft dabei entlang der Wand. Stehen auch oben Geräte, muss start_mm mindestens so groß sein wie die tiefste Gerätetiefe der oberen Reihe, sonst stoßen die Ecken zusammen; entsprechend unten.
- „insel“: eine freistehende Reihe in der Raummitte, von links nach rechts, mittig. start_mm wird ignoriert (0 angeben).
- Jede Wand höchstens einmal. Die Summe der Gerätebreiten einer Reihe plus start_mm darf die Wandlänge nicht überschreiten.
- hauben: Abzugshauben (Bereich Lüftung) hängen über den Geräten derselben Reihe und starten ebenfalls bei start_mm. Sie gehören nie in geraete. Eine Haube sollte über den Koch-, Brat- und Frittiergeräten liegen und möglichst etwas breiter sein als diese (rund 15 bis 20 cm Überstand). An einer Wand Wandhauben, über einer Insel Inselhauben (Zentralhauben), sofern im Katalog.
- tuer: Wand und Abstand (abstand_mm vom linken bzw. oberen Ende der Wand bis zur Tür). Vor der Tür braucht es 900 × 900 mm Schwenkbereich; dort darf kein Gerät stehen.

Gute Planung:
- Zwischen gegenüberliegenden Reihen bleibt ein Arbeitsgang von mindestens 1200 mm, mindestens aber ${GANG_MIN} mm.
- Typischer Ablauf: Anlieferung/Lagerung → Vorbereitung → Kochen → Ausgabe; Spülen nah an der Tür oder getrennt vom Kochbereich.
- Arbeitstische zwischen und neben Kochgeräte als Abstell- und Arbeitsfläche, Kühlung nah an der Vorbereitung.
- Nehmen Sie nur, was der Kunde braucht oder was für seine Beschreibung offensichtlich nötig ist. Lieber übersichtlich als vollgestellt. Höchstens ${MAX_TEILE} Teile.
- Nennt der Kunde ein Budget, halten Sie es mit den Netto-Preisen ein.
- Verwenden Sie ausschließlich Artikelnummern aus dem Katalog. Gibt es etwas Gewünschtes nicht, sagen Sie es in der Antwort, statt etwas Ähnliches zu erfinden.

Rufen Sie immer das Werkzeug plan_erstellen auf. In antwort erklären Sie dem Kunden auf Deutsch, per Sie, in höchstens fünf kurzen Sätzen, wie Sie geplant haben und was er prüfen sollte (z. B. Anschlüsse, Abluft, Maße vor Ort). Keine Preise, keine Artikelnummern im Text.
Meldet das Werkzeug Fehler, korrigieren Sie den Plan und rufen es erneut auf.
Für Gas-, Starkstrom- und Abluftanschluss verweisen Sie auf einen Fachbetrieb. Andere Themen als Küchen- und Gastronomieplanung lehnen Sie höflich ab.

Katalog (Artikelnummer | Name | Bereich | Maße | Preis netto zzgl. MwSt.):
`;

export const SYSTEM = ANLEITUNG + KATALOG.map(zeile).join("\n");

const reihe = {
  type: "object",
  properties: {
    wand: { type: "string", enum: WAENDE },
    start_mm: { type: "integer", description: "Abstand des ersten Geräts vom Wandanfang in mm" },
    geraete: { type: "array", items: { type: "string" }, description: "Artikelnummern in Reihenfolge entlang der Wand" },
    hauben: { type: "array", items: { type: "string" }, description: "Artikelnummern der Hauben über dieser Reihe" },
  },
  required: ["wand", "start_mm", "geraete", "hauben"],
  additionalProperties: false,
};

export const WERKZEUGE = [{
  name: "plan_erstellen",
  description: "Legt den Grundriss an: Geräte je Wand in Reihenfolge, Hauben darüber, Tür. Das Programm rechnet die Positionen aus und meldet Fehler (zu lang, Überschneidung, Gang zu schmal, unbekannte Artikelnummer).",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      antwort: { type: "string", description: "Kurze Erklärung für den Kunden" },
      reihen: { type: "array", items: reihe },
      tuer: {
        type: "object",
        properties: { wand: { type: "string", enum: ["oben", "unten", "links", "rechts"] }, abstand_mm: { type: "integer" } },
        required: ["wand", "abstand_mm"],
        additionalProperties: false,
      },
    },
    required: ["antwort", "reihen", "tuer"],
    additionalProperties: false,
  },
}];

/* ---------- Positionen ausrechnen und prüfen ---------- */
// Teil: {i, x, y, r}; r wie im Planer (0, 90, 180, 270). Bei 90/270 sind Breite und Tiefe vertauscht.
function mass(t) {
  const g = t.i === "tuer" ? TUER : NACH_SKU.get(t.i);
  return t.r % 180 ? { w: g.d, d: g.w } : { w: g.w, d: g.d };
}
function ueberschneidet(a, b) {
  const ma = mass(a), mb = mass(b);
  return a.x < b.x + mb.w - 1 && b.x < a.x + ma.w - 1 && a.y < b.y + mb.d - 1 && b.y < a.y + ma.d - 1;
}
const name = (i) => (i === "tuer" ? "Tür" : NACH_SKU.get(i)?.n || i);

export function anordnen(eingabe, B, T) {
  const fehler = [], teile = [];
  const reihen = Array.isArray(eingabe?.reihen) ? eingabe.reihen : [];
  const gesehen = new Set();
  const rs = {};
  for (const r of reihen) {
    if (!WAENDE.includes(r?.wand)) { fehler.push(`Unbekannte Wand ${r?.wand}.`); continue; }
    if (gesehen.has(r.wand)) { fehler.push(`Wand ${r.wand} kommt mehrmals vor; bitte zu einer Reihe zusammenfassen.`); continue; }
    gesehen.add(r.wand);
    const g = [], h = [];
    for (const i of Array.isArray(r.geraete) ? r.geraete : []) {
      const x = NACH_SKU.get(i);
      if (!x) fehler.push(`Unbekannte Artikelnummer ${i}.`);
      else if (haube(x)) h.push(i); // versehentlich als Gerät: als Haube behandeln
      else g.push(i);
    }
    for (const i of Array.isArray(r.hauben) ? r.hauben : []) {
      const x = NACH_SKU.get(i);
      if (!x) fehler.push(`Unbekannte Artikelnummer ${i}.`);
      else if (!haube(x)) fehler.push(`${x.n} (${i}) ist keine Haube und gehört in geraete.`);
      else h.push(i);
    }
    rs[r.wand] = { start: r.wand === "insel" ? 0 : Math.max(0, Math.round(+r.start_mm || 0)), g, h };
  }
  const anzahl = Object.values(rs).reduce((s, r) => s + r.g.length + r.h.length, 0);
  if (anzahl > MAX_TEILE) fehler.push(`Zu viele Teile (${anzahl}), höchstens ${MAX_TEILE}.`);
  const tiefe = (r) => (r ? Math.max(0, ...r.g.map((i) => NACH_SKU.get(i).d)) : 0);
  const laenge = (l) => l.reduce((s, i) => s + NACH_SKU.get(i).w, 0);

  for (const [wand, r] of Object.entries(rs)) {
    const seite = wand === "links" || wand === "rechts";
    const wandLaenge = seite ? T : B;
    for (const [liste, ebene] of [[r.g, "Geräte"], [r.h, "Hauben"]]) {
      if (!liste.length) continue;
      const L = laenge(liste);
      let pos = wand === "insel" ? Math.round((B - laenge(r.g.length ? r.g : liste)) / 2) : r.start;
      if (wand !== "insel" && r.start + L > wandLaenge) fehler.push(`Wand ${wand}: ${ebene} sind zusammen ${L} mm breit, ab ${r.start} mm passt das nicht an die ${wandLaenge} mm lange Wand.`);
      if (wand === "insel" && L > B) fehler.push(`Insel: ${ebene} sind zusammen ${L} mm breit, der Raum nur ${B} mm.`);
      for (const i of liste) {
        const x = NACH_SKU.get(i);
        let t;
        if (wand === "oben") t = { i, x: pos, y: 0, r: 0 };
        else if (wand === "unten") t = { i, x: pos, y: T - x.d, r: 180 };
        else if (wand === "links") t = { i, x: 0, y: pos, r: 90 };
        else if (wand === "rechts") t = { i, x: B - x.d, y: pos, r: 270 };
        else t = { i, x: pos, y: 0, r: 0, insel: true };
        teile.push({ ...t, oben: ebene === "Hauben" });
        pos += x.w;
      }
    }
  }
  // Insel mittig zwischen oberer und unterer Reihe
  const dO = tiefe(rs.oben), dU = tiefe(rs.unten), dI = tiefe(rs.insel) || Math.max(0, ...(rs.insel?.h || []).map((i) => NACH_SKU.get(i).d));
  if (rs.insel) {
    const y = Math.round(dO + (T - dO - dU - dI) / 2);
    teile.filter((t) => t.insel).forEach((t) => { t.y = y; delete t.insel; });
    if (rs.insel.g.length) {
      const gang = Math.min(y - dO, T - dU - (y + dI));
      if (gang < GANG_MIN) fehler.push(`Insel: Gang zu den Reihen oben/unten nur ${gang} mm, mindestens ${GANG_MIN} mm nötig. Insel kleiner/schmaler planen oder weglassen.`);
    }
  }
  if (rs.oben?.g.length && rs.unten?.g.length && !rs.insel && T - dO - dU < GANG_MIN) fehler.push(`Gang zwischen Reihe oben und unten nur ${T - dO - dU} mm, mindestens ${GANG_MIN} mm nötig.`);
  const dL = tiefe(rs.links), dR = tiefe(rs.rechts);
  if (rs.links?.g.length && rs.rechts?.g.length && B - dL - dR < GANG_MIN) fehler.push(`Gang zwischen Reihe links und rechts nur ${B - dL - dR} mm, mindestens ${GANG_MIN} mm nötig.`);

  // Tür (Schwenkbereich auf dem Boden; Ausrichtung wie im Planer: Öffnung zur Wand)
  const tw = eingabe?.tuer?.wand, ta = Math.max(0, Math.round(+eingabe?.tuer?.abstand_mm || 0));
  if (["oben", "unten", "links", "rechts"].includes(tw)) {
    const seite = tw === "links" || tw === "rechts", max = (seite ? T : B) - TUER.w;
    const a = Math.min(ta, Math.max(0, max));
    if (ta > max) fehler.push(`Tür: Abstand ${ta} mm ist zu groß für die Wand ${tw}, höchstens ${max} mm.`);
    const t = tw === "oben" ? { i: "tuer", x: a, y: 0, r: 180 } : tw === "unten" ? { i: "tuer", x: a, y: T - TUER.d, r: 0 }
      : tw === "links" ? { i: "tuer", x: 0, y: a, r: 90 } : { i: "tuer", x: B - TUER.d, y: a, r: 270 };
    teile.unshift({ ...t, oben: false });
  }
  // Überschneidungen auf dem Boden (Hauben hängen darüber und zählen nicht); jedes Paar nur einmal melden
  const boden = teile.filter((t) => !t.oben);
  for (let a = 0; a < boden.length; a++) for (let b = a + 1; b < boden.length; b++) {
    if (ueberschneidet(boden[a], boden[b])) fehler.push(`Überschneidung: ${name(boden[a].i)} und ${name(boden[b].i)}. Reihenfolge, start_mm oder Tür verschieben, oder ein Gerät weglassen.`);
  }
  for (const t of boden) {
    const m = mass(t);
    if (t.x < -1 || t.y < -1 || t.x + m.w > B + 1 || t.y + m.d > T + 1) fehler.push(`${name(t.i)} ragt aus dem Raum.`);
  }
  if (!teile.some((t) => t.i !== "tuer")) fehler.push("Der Plan enthält keine Geräte.");
  return { teile: teile.map(({ i, x, y, r }) => ({ i, x: Math.round(x), y: Math.round(y), r })), fehler: [...new Set(fehler)].slice(0, 12) };
}

/* ---------- Anfrage ---------- */
export function anfragePruefen(d) {
  const B = Math.round(+d?.b), T = Math.round(+d?.t);
  const text = typeof d?.text === "string" ? d.text.trim().slice(0, MAX_ZEICHEN) : "";
  if (!(B >= 1500 && B <= 30000 && T >= 1500 && T <= 30000)) return null;
  if (text.length < 3) return null;
  // vorheriger Vorschlag, damit der Kunde nachbessern kann („noch eine Spülmaschine dazu“)
  let vorher = null;
  if (d?.vorher && Array.isArray(d.vorher.reihen)) {
    const s = JSON.stringify({ reihen: d.vorher.reihen, tuer: d.vorher.tuer || null });
    if (s.length <= 6000) vorher = { reihen: d.vorher.reihen, tuer: d.vorher.tuer || null, text: String(d.vorher.text || "").slice(0, MAX_ZEICHEN) };
  }
  return { B, T, text, vorher };
}

export async function planen(client, { B, T, text, vorher }, modell = MODELL) {
  const einleitung = `Raum: Breite ${B} mm (Wände oben/unten), Tiefe ${T} mm (Wände links/rechts).`;
  const inhalt = vorher
    ? `${einleitung}\nBisheriger Wunsch des Kunden: ${vorher.text}\nIhr bisheriger Plan: ${JSON.stringify({ reihen: vorher.reihen, tuer: vorher.tuer })}\nÄnderungswunsch des Kunden: ${text}`
    : `${einleitung}\nWunsch des Kunden: ${text}`;
  const messages = [{ role: "user", content: inhalt }];
  let letzter = null;
  for (let runde = 0; runde < MAX_RUNDEN; runde++) {
    const antwort = await client.beta.messages.create({
      model: modell,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
      tools: WERKZEUGE,
      messages,
    });
    const bloecke = nachWechsel(antwort.content);
    const freitext = bloecke.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (antwort.stop_reason === "refusal") return { antwort: "Dabei kann ich leider nicht helfen. Beschreiben Sie gern, was in Ihre Küche soll.", teile: null };
    const aufruf = bloecke.filter((b) => b.type === "tool_use" && b.name === "plan_erstellen").at(-1);
    if (antwort.stop_reason !== "tool_use" || !aufruf) {
      if (letzter) break;
      return { antwort: freitext || "Das konnte ich leider nicht planen. Bitte beschreiben Sie Ihren Wunsch etwas genauer.", teile: null };
    }
    const r = anordnen(aufruf.input, B, T);
    letzter = { antwort: String(aufruf.input?.antwort || freitext || "").slice(0, 2000), teile: r.teile, fehler: r.fehler,
                plan: { reihen: aufruf.input?.reihen || [], tuer: aufruf.input?.tuer || null } };
    if (!r.fehler.length) break;
    messages.push({ role: "assistant", content: bloecke });
    messages.push({ role: "user", content: bloecke.filter((b) => b.type === "tool_use").map((b) => ({
      type: "tool_result", tool_use_id: b.id, is_error: true,
      content: b === aufruf ? `Der Plan hat Fehler, bitte korrigieren:\n- ${r.fehler.join("\n- ")}` : "Unbekanntes Werkzeug.",
    })) });
  }
  return { antwort: letzter.antwort, teile: letzter.teile, hinweise: letzter.fehler, plan: letzter.plan };
}
