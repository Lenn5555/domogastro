import { test } from "node:test";
import assert from "node:assert/strict";
import { anordnen, anfragePruefen, planen, NACH_SKU, SYSTEM } from "../src/planen.js";

const alle = [...NACH_SKU.values()];
const geraet = alle.find((g) => g.k !== "Lüftung" && g.w >= 600 && g.w <= 1200 && g.d >= 500);
const haube = alle.find((g) => g.k === "Lüftung");

function client(antworten) {
  const anfragen = [];
  return { anfragen, beta: { messages: { create: async (x) => { anfragen.push(structuredClone(x)); return antworten.shift(); } } } };
}
const aufruf = (input, id = "t1") => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name: "plan_erstellen", input }] });

test("Katalog steht im Systemtext, ohne Einkaufspreise", () => {
  assert.ok(NACH_SKU.size > 100);
  assert.ok(SYSTEM.includes(geraet.i));
  assert.doesNotMatch(SYSTEM.split("Katalog (")[1], /einkauf|EK-Preis|marge/i);
});

test("anfragePruefen: Raumgrenzen und Text", () => {
  assert.equal(anfragePruefen({ b: 1000, t: 4000, text: "Imbiss" }), null);
  assert.equal(anfragePruefen({ b: 4000, t: 4000, text: "" }), null);
  const a = anfragePruefen({ b: 6000, t: 4000, text: "x".repeat(5000) });
  assert.equal(a.text.length, 1500);
  assert.equal(a.vorher, null);
});

test("anordnen: Reihe oben, unten, links, rechts mit richtiger Drehung", () => {
  const r = anordnen({ reihen: [
    { wand: "oben", start_mm: 0, geraete: [geraet.i, geraet.i], hauben: [haube.i] },
    { wand: "unten", start_mm: 0, geraete: [geraet.i], hauben: [] },
    { wand: "links", start_mm: 1500, geraete: [geraet.i], hauben: [] },
    { wand: "rechts", start_mm: 1500, geraete: [geraet.i], hauben: [] },
  ], tuer: { wand: "unten", abstand_mm: 4000 } }, 8000, 6000);
  assert.deepEqual(r.fehler, []);
  const [tuer, o1, o2] = r.teile;
  assert.deepEqual(tuer, { i: "tuer", x: 4000, y: 5100, r: 0 });
  assert.deepEqual([o1.x, o1.y, o1.r, o2.x], [0, 0, 0, geraet.w]);
  const unten = r.teile.find((t) => t.r === 180);
  assert.equal(unten.y, 6000 - geraet.d);
  assert.equal(r.teile.find((t) => t.r === 90).x, 0);
  assert.equal(r.teile.find((t) => t.r === 270).x, 8000 - geraet.d);
  assert.ok(r.teile.some((t) => t.i === haube.i)); // Haube überschneidet die Geräte, ist aber kein Fehler
});

test("anordnen: zu lang, Überschneidung, unbekannt, Tür im Weg, Gang zu schmal", () => {
  const viele = Array(20).fill(geraet.i);
  const r = anordnen({ reihen: [
    { wand: "oben", start_mm: 0, geraete: viele, hauben: [] },
    { wand: "links", start_mm: 0, geraete: [geraet.i, "gibts-nicht"], hauben: [geraet.i] },
  ], tuer: { wand: "oben", abstand_mm: 0 } }, 4000, 3000);
  const f = r.fehler.join("\n");
  assert.match(f, /Wand oben: Geräte sind zusammen/);
  assert.match(f, /Unbekannte Artikelnummer gibts-nicht/);
  assert.match(f, /keine Haube/);
  assert.match(f, /Überschneidung: Tür/);
  const g = anordnen({ reihen: [{ wand: "oben", start_mm: 0, geraete: [geraet.i], hauben: [] }, { wand: "unten", start_mm: 0, geraete: [geraet.i], hauben: [] }],
    tuer: { wand: "links", abstand_mm: 0 } }, 4000, geraet.d * 2 + 500);
  assert.match(g.fehler.join("\n"), /Gang zwischen Reihe oben und unten/);
});

test("anordnen: Insel mittig", () => {
  const r = anordnen({ reihen: [{ wand: "insel", start_mm: 0, geraete: [geraet.i], hauben: [] }], tuer: { wand: "unten", abstand_mm: 0 } }, 6000, 6000);
  assert.deepEqual(r.fehler, []);
  const t = r.teile.find((x) => x.i === geraet.i);
  assert.equal(t.x, Math.round((6000 - geraet.w) / 2));
  assert.equal(t.y, Math.round((6000 - geraet.d) / 2));
});

test("planen: Fehler geht zurück an Claude, korrigierter Plan wird genommen", async () => {
  const falsch = { antwort: "a", reihen: [{ wand: "oben", start_mm: 0, geraete: ["erfunden"], hauben: [] }], tuer: { wand: "unten", abstand_mm: 0 } };
  const richtig = { antwort: "So geplant.", reihen: [{ wand: "oben", start_mm: 0, geraete: [geraet.i], hauben: [] }], tuer: { wand: "unten", abstand_mm: 0 } };
  const c = client([aufruf(falsch), aufruf(richtig, "t2")]);
  const r = await planen(c, { B: 5000, T: 4000, text: "Imbiss", vorher: null });
  assert.equal(c.anfragen.length, 2);
  assert.equal(c.anfragen[1].messages[2].content[0].is_error, true);
  assert.match(c.anfragen[1].messages[2].content[0].content, /erfunden/);
  assert.equal(r.antwort, "So geplant.");
  assert.deepEqual(r.hinweise, []);
  assert.equal(r.teile.filter((t) => t.i === geraet.i).length, 1);
  assert.deepEqual(r.plan.reihen, richtig.reihen);
});

test("planen: ohne Werkzeugaufruf kommt nur Text zurück", async () => {
  const c = client([{ stop_reason: "end_turn", content: [{ type: "text", text: "Wie groß ist der Raum?" }] }]);
  const r = await planen(c, { B: 5000, T: 4000, text: "hallo", vorher: null });
  assert.deepEqual(r, { antwort: "Wie groß ist der Raum?", teile: null });
});

test("planen: Änderungswunsch bekommt den bisherigen Plan mit", async () => {
  const p = { antwort: "ok", reihen: [{ wand: "oben", start_mm: 0, geraete: [geraet.i], hauben: [] }], tuer: { wand: "unten", abstand_mm: 0 } };
  const c = client([aufruf(p)]);
  await planen(c, anfragePruefen({ b: 5000, t: 4000, text: "noch eins dazu", vorher: { text: "Imbiss", reihen: p.reihen, tuer: p.tuer } }));
  assert.match(c.anfragen[0].messages[0].content, /Bisheriger Wunsch des Kunden: Imbiss/);
  assert.match(c.anfragen[0].messages[0].content, /Änderungswunsch des Kunden: noch eins dazu/);
});
