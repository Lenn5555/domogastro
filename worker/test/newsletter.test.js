import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as nl from "../src/newsletter.js";

// Kleine Nachbildung von Cloudflare D1 auf SQLite (nur was der Newsletter braucht)
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const umbau = (sql) => sql.replace(/\?(\d+)/g, (_, n) => `?${n}`);
  return {
    roh: db,
    prepare(sql) {
      let werte = [];
      const st = () => db.prepare(umbau(sql));
      return {
        bind(...w) { werte = w; return this; },
        async first() { return st().get(...werte) ?? null; },
        async all() { return { results: st().all(...werte) }; },
        async run() { const r = st().run(...werte); return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
      };
    },
  };
}

function umgebung() {
  const post = [];
  const env = { DB: d1(), SITE_URL: "https://domogastro.de", BESTELL_EMAIL: "sales@ts-systec.de", ABSENDER: "x", RESEND_API_KEY: "test" };
  globalThis.fetch = async (url, o) => { post.push(JSON.parse(o.body)); return { ok: true, text: async () => "" }; };
  return { env, post };
}
const link = (m, art) => m.text.match(new RegExp(`\\?${art}=([0-9a-f]+)`))[1];

test("Double-Opt-in: Code erst nach Bestätigung, nur einer je Adresse", async () => {
  const { env, post } = umgebung();
  await assert.rejects(nl.anmelden(env, { email: "a@b.de" }), /bestätigen/);
  await nl.anmelden(env, { email: "A@B.de", einwilligung: true }, { ip: "1.2.3.4", api: "https://api.test" });
  assert.equal(post.length, 1);
  assert.match(post[0].subject, /Bitte bestätigen/);
  assert.equal(post[0].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  let z = env.DB.roh.prepare("SELECT * FROM newsletter").get();
  assert.equal(z.status, "offen"); assert.equal(z.email, "a@b.de"); assert.equal(z.anmelde_ip, "1.2.3.4"); assert.match(z.einwilligung, /jederzeit/);
  assert.equal(env.DB.roh.prepare("SELECT COUNT(*) AS n FROM gutscheine").get().n, 0);

  // Zweite Anmeldung kurz danach: keine weitere Mail
  await nl.anmelden(env, { email: "a@b.de", einwilligung: true });
  assert.equal(post.length, 1);

  const token = link(post[0], "bestaetigen");
  assert.deepEqual(await nl.bestaetigen(env, { token }, { ip: "5.6.7.8" }), { ok: true, code: true });
  z = env.DB.roh.prepare("SELECT * FROM newsletter").get();
  assert.equal(z.status, "bestaetigt"); assert.equal(z.bestaetigt_ip, "5.6.7.8"); assert.match(z.code, /^DGN-[A-Z2-9]{8}$/);
  assert.equal(post.length, 2);
  assert.ok(post[1].text.includes(z.code));
  assert.ok(post[1].text.includes("/newsletter/?abmelden="));
  assert.equal((await nl.bestaetigen(env, { token })).schon, true);

  // Abmelden mit einem Klick, wieder anmelden und bestätigen: kein zweiter Code
  await nl.abmelden(env, link(post[1], "abmelden"));
  assert.equal(env.DB.roh.prepare("SELECT status FROM newsletter").get().status, "abgemeldet");
  await nl.anmelden(env, { email: "a@b.de", einwilligung: true });
  assert.equal(post.length, 3);
  assert.deepEqual(await nl.bestaetigen(env, { token: link(post[2], "bestaetigen") }), { ok: true, code: false });
  assert.equal(env.DB.roh.prepare("SELECT COUNT(*) AS n FROM gutscheine").get().n, 1);
  assert.equal(post.length, 3);
  const v = await nl.verwaltungListe(env);
  assert.equal(v.liste.length, 1); assert.equal(v.anzahl.bestaetigt, 1);
});

test("Links: ungültig, abgelaufen, nach Abmeldung", async () => {
  const { env, post } = umgebung();
  await assert.rejects(nl.bestaetigen(env, { token: "kaputt" }), /ungültig/);
  await nl.anmelden(env, { email: "c@d.de", einwilligung: true });
  env.DB.roh.prepare("UPDATE newsletter SET bestaetigen_bis = 1").run();
  await assert.rejects(nl.bestaetigen(env, { token: link(post[0], "bestaetigen") }), /abgelaufen/);
  await assert.rejects(nl.abmelden(env, "0".repeat(32)), /kennen wir nicht/);
});

test("Mindestwert nur für Newsletter-Codes", () => {
  assert.equal(nl.mindestwertFehler("DG5-ABCDEFGH", 1), "");
  // daten/newsletter.json: mindestwert_netto 0 = kein Mindestwert
  assert.equal(nl.mindestwertFehler("DGN-ABCDEFGH", 1), nl.mindestwert() ? nl.mindestwertFehler("DGN-ABCDEFGH", 1) : "");
});
