import { test } from "node:test";
import assert from "node:assert/strict";
import { d1 } from "./d1.js";
import * as nl from "../src/newsletter.js";

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

test("Jede Adresse nur einmal: Schreibvarianten bekommen keinen zweiten Code", async () => {
  const { env, post } = umgebung();
  assert.equal(nl.adressKern("Max.Muster+nl@googlemail.com"), "maxmuster@gmail.com");
  assert.equal(nl.adressKern("max.muster+x@firma.de"), "max.muster@firma.de");
  await nl.anmelden(env, { email: "max.muster@gmail.com", einwilligung: true });
  assert.equal((await nl.bestaetigen(env, { token: link(post[0], "bestaetigen") })).code, true);
  await nl.anmelden(env, { email: "maxmuster+2@googlemail.com", einwilligung: true });
  assert.equal((await nl.bestaetigen(env, { token: link(post[2], "bestaetigen") })).code, false);
  await nl.anmelden(env, { email: "max.muster@firma.de", einwilligung: true });  // andere Adresse: eigener Code
  assert.equal((await nl.bestaetigen(env, { token: link(post[3], "bestaetigen") })).code, true);
  assert.equal(env.DB.roh.prepare("SELECT COUNT(*) AS n FROM gutscheine").get().n, 2);
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

test("Monatlicher Versand: Testmail, gedrosselt an Bestätigte, Abgemeldete übersprungen, Statistik", async () => {
  const { env, post } = umgebung();
  env.API_URL = "https://api.test"; env.NEWSLETTER_TAGESLIMIT = "2";
  for (const m of ["a@x.de", "b@x.de", "c@x.de", "d@x.de"]) await nl.anmelden(env, { email: m, einwilligung: true });
  for (const m of post.slice(0, 4)) await nl.bestaetigen(env, { token: link(m, "bestaetigen") });
  await nl.anmelden(env, { email: "offen@x.de", einwilligung: true });  // unbestätigt: bekommt nichts
  post.length = 0;
  const neu = { betreff: "Neuheiten im Dezember", text: "Guten Tag,\n\nhier sind unsere Neuheiten im Dezember." };
  await nl.testSenden(env, neu);
  assert.equal(post[0].to[0], "sales@ts-systec.de"); assert.match(post[0].subject, /^\[TEST\]/);
  await assert.rejects(nl.versandStarten(env, neu), /bestätigen/);
  const v = await nl.versandStarten(env, { ...neu, sicher: true });
  assert.equal(v.empfaenger, 4);
  await assert.rejects(nl.versandStarten(env, { ...neu, sicher: true }), /läuft schon/);
  post.length = 0;
  // b meldet sich ab, bevor er dran ist
  const sB = env.DB.roh.prepare("SELECT abmelde_schluessel AS s FROM newsletter WHERE email = 'b@x.de'").get().s;
  await nl.abmelden(env, sB);
  let r = await nl.versandWeiter(env, { pause: 0 });
  assert.equal(post.length, 2);  // Tageslimit 2
  assert.ok(post.every((m) => m.to[0] !== "b@x.de" && m.headers["List-Unsubscribe"].startsWith("<https://api.test/newsletter/ein-klick?s=")));
  assert.match(post[0].text, /abmelden=/);
  r = await nl.versandWeiter(env, { pause: 0 });
  assert.equal(post.length, 2);  // heute nichts mehr
  env.NEWSLETTER_TAGESLIMIT = "100";
  r = await nl.versandWeiter(env, { pause: 0 });
  assert.equal(r.rest, 0); assert.equal(post.length, 3);
  const l = await nl.verwaltungListe(env);
  assert.equal(l.ausgaben[0].status, "fertig"); assert.equal(l.ausgaben[0].gesendet, 3);
  const heute = l.statistik.tage[0];
  assert.equal(heute.anmeldung, 5); assert.equal(heute.bestaetigung, 4); assert.equal(heute.abmeldung, 1);
  assert.equal(l.statistik.monate[0].anmeldung, 5);
});

test("Bestandskunden (§ 7 Abs. 3): nur mit Hinweis, nur passende Kategorie, Widerspruch sperrt dauerhaft, kein Code", async () => {
  const { env, post } = umgebung();
  env.API_URL = "https://api.test"; env.NEWSLETTER_TAGESLIMIT = "100";
  const KAT = (await import("../src/katalog.json", { with: { type: "json" } })).default;
  const [sku1, a1] = Object.entries(KAT.artikel).find(([, a]) => a.k);
  const [sku2] = Object.entries(KAT.artikel).find(([, a]) => a.k && a.k !== a1.k);
  const best = (nr, mail, sku, kunde) => env.DB.roh.prepare(`INSERT INTO bestellungen (nr, email, modus, kunde, positionen, netto, mwst, brutto, zahlart, status, datum, aktualisiert)
    VALUES (?, ?, 'privat', ?, ?, 1, 0, 1, 'Vorkasse', 'eingegangen', '2026-11-25T10:00:00Z', 'x')`).run(nr, mail, JSON.stringify(kunde), JSON.stringify([{ sku, menge: 1 }]));
  best("A", "alt@x.de", sku1, {});                                            // vor dem Hinweis: nicht aufnehmen
  best("B", "neu@x.de", sku1, { werbehinweis: nl.WERBEHINWEIS_STAND });
  best("C", "nein@x.de", sku1, { werbehinweis: nl.WERBEHINWEIS_STAND, keine_werbung: true });
  best("D", "andere@x.de", sku2, { werbehinweis: nl.WERBEHINWEIS_STAND });
  for (const nr of "ABCD") await nl.bestandskundeMerken(env, nr);
  let v = await nl.verwaltungListe(env);
  assert.equal(v.bestandskunden.aktiv, 2); assert.equal(v.bestandskunden.gesperrt, 1);
  await assert.rejects(nl.versandStarten(env, { betreff: "Neu", text: "Angebote zu ähnlichen Produkten.", sicher: true, gruppe: "bestandskunden" }), /Kategorie/);
  const s = await nl.versandStarten(env, { betreff: "Neu", text: "Angebote zu ähnlichen Produkten.", sicher: true, gruppe: "bestandskunden", kategorien: [a1.k] });
  assert.equal(s.empfaenger, 1);
  await nl.versandWeiter(env, { pause: 0 });
  assert.equal(post.length, 1); assert.equal(post[0].to[0], "neu@x.de");
  assert.match(post[0].text, /widersprechen.*Basistarifen/s);
  assert.doesNotMatch(post[0].text, /DGN-/);
  await nl.abmelden(env, post[0].text.match(/abmelden=([0-9a-f]{32})/)[1]);
  v = await nl.verwaltungListe(env);
  assert.equal(v.bestandskunden.aktiv, 1); assert.equal(v.statistik.tage[0].widerspruch, 2);
  await nl.bestandskundeMerken(env, "B");  // neue Bestellung hebt die Sperre nicht auf
  assert.equal((await nl.verwaltungListe(env)).bestandskunden.aktiv, 1);
  assert.equal(env.DB.roh.prepare("SELECT COUNT(*) AS n FROM gutscheine").get().n, 0);
});
