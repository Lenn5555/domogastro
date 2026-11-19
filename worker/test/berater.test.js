import { test } from "node:test";
import assert from "node:assert/strict";
import { beraten, verlaufPruefen, produkteZeigen, nachWechsel, NACH_SLUG, SYSTEM } from "../src/berater.js";

const [a, b] = [...NACH_SLUG.keys()];

// nachgebauter Client: gibt nacheinander die vorbereiteten Antworten zurück und merkt sich die Anfragen
function client(antworten) {
  const anfragen = [];
  return { anfragen, beta: { messages: { create: async (x) => { anfragen.push(structuredClone(x)); return antworten.shift(); } } } };
}

test("Katalog steht im Systemtext, ohne Einkaufspreise", () => {
  assert.ok(NACH_SLUG.size > 100);
  assert.ok(SYSTEM.includes(a));
  assert.doesNotMatch(SYSTEM.split("Katalog (")[1], /einkauf|EK-Preis|marge/i);
});

test("verlaufPruefen: letzte Nachricht muss vom Kunden sein", () => {
  assert.equal(verlaufPruefen({ verlauf: [] }), null);
  assert.equal(verlaufPruefen({ verlauf: [{ rolle: "kunde", text: "x" }, { rolle: "berater", text: "y" }] }), null);
  const v = verlaufPruefen({ verlauf: [{ rolle: "hacker", text: "a".repeat(5000) }] });
  assert.equal(v[0].rolle, "kunde");
  assert.equal(v[0].text.length, 1500);
});

test("produkteZeigen trennt bekannte und unbekannte Kennungen", () => {
  assert.deepEqual(produkteZeigen({ kennungen: [a, "gibt-es-nicht", a] }), { slugs: [a], unbekannt: ["gibt-es-nicht"] });
  assert.ok(produkteZeigen({ kennungen: ["nix"] }).fehler);
});

test("beraten: Text und gültige Produkte reichen nach einer Runde", async () => {
  const c = client([
    { stop_reason: "tool_use", content: [{ type: "text", text: "Diese passen gut." }, { type: "tool_use", id: "t1", name: "produkte_zeigen", input: { kennungen: [b, a] } }] },
  ]);
  const r = await beraten(c, [{ rolle: "kunde", text: "Ich brauche etwas" }]);
  assert.deepEqual(r, { antwort: "Diese passen gut.", produkte: [b, a] });
  assert.equal(c.anfragen.length, 1);
});

test("beraten: unbekannte Kennung führt zu zweiter Runde mit Fehlermeldung", async () => {
  const c = client([
    { stop_reason: "tool_use", content: [{ type: "text", text: "Schauen Sie hier." }, { type: "tool_use", id: "t1", name: "produkte_zeigen", input: { kennungen: ["erfunden"] } }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "produkte_zeigen", input: { kennungen: [a] } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Dieses passt." }] },
  ]);
  const r = await beraten(c, [{ rolle: "kunde", text: "x" }]);
  assert.equal(c.anfragen[1].messages[2].content[0].is_error, true);
  assert.deepEqual(r, { antwort: "Dieses passt.", produkte: [a] });
});

test("beraten: Ablehnung ergibt freundlichen Text ohne Produkte", async () => {
  const r = await beraten(client([{ stop_reason: "refusal", content: [] }]), [{ rolle: "kunde", text: "x" }]);
  assert.deepEqual(r.produkte, []);
  assert.match(r.antwort, /nicht helfen/);
});

test("nachWechsel lässt Werkzeugaufrufe vor einem Modellwechsel weg", () => {
  const inhalt = [{ type: "thinking" }, { type: "tool_use", id: "alt" }, { type: "fallback" }, { type: "text", text: "x" }, { type: "tool_use", id: "neu" }];
  assert.deepEqual(nachWechsel(inhalt).map((x) => x.id || x.type), ["fallback", "text", "neu"]);
});
