import { test } from "node:test";
import assert from "node:assert/strict";
import { d1 } from "./d1.js";
import * as st from "../src/statistik.js";

test("Statistik: nur Tageszähler je Ereignis und Quelle, Trichter für 7/30 Tage", async () => {
  const env = { DB: d1() };
  await st.zaehlen(env, "einstieg", "google");
  await st.zaehlen(env, "einstieg", "ads");
  await st.zaehlen(env, "einstieg", "erfunden");          // unbekannte Quelle zählt als direkt
  for (let i = 0; i < 5; i++) await st.zaehlen(env, "seite");
  await st.zaehlen(env, "warenkorb");
  await st.zaehlen(env, "bestellung");
  await assert.rejects(st.zaehlen(env, "hack"), /Unbekannt/);
  const spalten = env.DB.roh.prepare("SELECT * FROM statistik LIMIT 1").get();
  assert.deepEqual(Object.keys(spalten).sort(), ["ereignis", "n", "quelle", "tag"]);   // keine IP, keine Kennung
  const v = await st.verwaltungStatistik(env);
  assert.equal(v.summe[7].einstieg, 3); assert.equal(v.summe[30].seite, 5); assert.equal(v.summe[7].bestellung, 1);
  assert.deepEqual(v.quellen[7], { google: 1, ads: 1, direkt: 1 });
  assert.equal(v.tage.length, 1); assert.equal(v.tage[0].warenkorb, 1);
});
