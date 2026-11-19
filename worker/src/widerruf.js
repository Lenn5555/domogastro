// Widerruf über die Website (Widerrufsbutton, EU-Richtlinie 2023/2673; Lenn 2026-11-19).
// Kunde: POST /widerruf mit Bestellnummer + E-Mail + Artikeln → sofortige Eingangsbestätigung per Mail.
// Verwaltung: eingegangen → zurueck („Ware ist zurück“) → erstattet (Betrag, Mail an den Kunden). Das Geld überweist Lenn selbst.
import { Fehler, text, jetzt, runden, gleich } from "./hilfe.js";
import { senden, widerrufKunde, widerrufVertrieb, erstattetMail } from "./mail.js";

const SCHRITTE = ["zurueck", "erstattet"];

async function bestellungLesen(env, nr, mail) {
  const z = await env.DB.prepare("SELECT * FROM bestellungen WHERE nr = ?").bind(text(nr, 30).toUpperCase()).first();
  if (!z || !gleich(z.email, String(mail || "").trim().toLowerCase())) throw new Fehler("Keine Bestellung mit dieser Nummer und E-Mail-Adresse gefunden.", 404);
  return { ...z, kunde: JSON.parse(z.kunde), positionen: JSON.parse(z.positionen) };
}

export async function widerrufeVon(env, nr) {
  const r = await env.DB.prepare("SELECT id, positionen, grund, status, vorschlag, betrag, datum FROM widerrufe WHERE nr = ? ORDER BY id").bind(nr).all();
  return r.results.map((w) => ({ ...w, positionen: JSON.parse(w.positionen) }));
}

// Wie viele Stück je Artikel sind schon widerrufen?
function schonWiderrufen(liste) {
  const m = {};
  for (const w of liste) for (const p of w.positionen) m[p.sku] = (m[p.sku] || 0) + p.menge;
  return m;
}

// Anteiliger Bruttobetrag; sind danach alle Artikel widerrufen, der Rest bis zum Gesamtbetrag (keine Rundungscents übrig)
export function vorschlagRechnen(b, pos, vorher) {
  const prozent = b.kunde?.gutschein?.prozent || 0;
  const anteil = (liste) => runden(liste.reduce((s, p) => s + (b.positionen.find((x) => x.sku === p.sku)?.netto || 0) * p.menge, 0) * (1 - prozent / 100) * 1.19);
  const danach = schonWiderrufen([...vorher, { positionen: pos }]);
  const alles = b.positionen.every((p) => (danach[p.sku] || 0) >= p.menge);
  return alles ? runden(b.brutto - vorher.reduce((s, w) => s + w.vorschlag, 0)) : anteil(pos);
}

export async function widerrufen(env, ctx, d) {
  const b = await bestellungLesen(env, d.nr, d.email);
  if (b.status === "storniert") throw new Fehler("Diese Bestellung ist bereits storniert.");
  const vorher = await widerrufeVon(env, b.nr);
  const schon = schonWiderrufen(vorher);
  const wahl = Array.isArray(d.positionen) ? d.positionen : [];
  const pos = [];
  for (const w of wahl.slice(0, 50)) {
    const p = b.positionen.find((x) => x.sku === String(w.sku));
    const menge = parseInt(w.menge, 10);
    if (!p || !(menge >= 1)) continue;
    const rest = p.menge - (schon[p.sku] || 0);
    if (menge > rest) throw new Fehler(rest ? `Von „${p.name}“ können Sie höchstens noch ${rest} Stück widerrufen.` : `„${p.name}“ haben Sie bereits widerrufen.`);
    pos.push({ sku: p.sku, name: p.name, menge });
  }
  if (!pos.length) throw new Fehler("Bitte wählen Sie mindestens einen Artikel.");
  const grund = text(d.grund, 1000);
  const datum = jetzt();
  const vorschlag = vorschlagRechnen(b, pos, vorher);
  const r = await env.DB.prepare("INSERT INTO widerrufe (nr, positionen, grund, status, vorschlag, datum, aktualisiert) VALUES (?, ?, ?, 'eingegangen', ?, ?, ?)")
    .bind(b.nr, JSON.stringify(pos), grund, vorschlag, datum, datum).run();
  const w = { id: r.meta?.last_row_id, positionen: pos, grund, datum, vorschlag };
  // Eingangsbestätigung auf dauerhaftem Datenträger (E-Mail), sofort
  ctx.waitUntil(Promise.all([
    senden(env, b.email, `Eingangsbestätigung: Widerruf zu Ihrer Bestellung ${b.nr}`, widerrufKunde(env, b, w)),
    senden(env, env.BESTELL_EMAIL, `Widerruf ${b.nr} (${b.modus === "privat" ? "Privat" : "GEWERBE"})`, widerrufVertrieb(env, b, w)),
  ]));
  return { ok: true, datum };
}

export async function verwaltungWiderruf(env, ctx, d) {
  if (!SCHRITTE.includes(d.schritt)) throw new Fehler("Unbekannter Schritt.");
  const w = await env.DB.prepare("SELECT * FROM widerrufe WHERE id = ?").bind(parseInt(d.id, 10) || 0).first();
  if (!w) throw new Fehler("Widerruf nicht gefunden.", 404);
  if (w.status === "erstattet") throw new Fehler("Dieser Widerruf ist schon erstattet.");
  if (d.schritt === "zurueck") {
    await env.DB.prepare("UPDATE widerrufe SET status = 'zurueck', aktualisiert = ? WHERE id = ?").bind(jetzt(), w.id).run();
    return { ok: true };
  }
  const betrag = runden(Number(String(d.betrag ?? w.vorschlag).replace(",", ".")));
  if (!(betrag >= 0) || betrag > w.vorschlag + 0.005) throw new Fehler("Der Betrag muss zwischen 0 und dem Kaufpreis der Artikel liegen.");
  await env.DB.prepare("UPDATE widerrufe SET status = 'erstattet', betrag = ?, aktualisiert = ? WHERE id = ?").bind(betrag, jetzt(), w.id).run();
  const z = await env.DB.prepare("SELECT * FROM bestellungen WHERE nr = ?").bind(w.nr).first();
  const b = { ...z, kunde: JSON.parse(z.kunde), positionen: JSON.parse(z.positionen) };
  // Alles widerrufen und erstattet: Bestellung gilt als storniert (ohne weitere Statusmail), Gutschein wieder frei, keine Bitte um Bewertung
  const alle = await widerrufeVon(env, w.nr);
  const schon = schonWiderrufen(alle);
  if (alle.every((x) => x.status === "erstattet") && b.positionen.every((p) => (schon[p.sku] || 0) >= p.menge)) {
    await env.DB.batch([
      env.DB.prepare("UPDATE bestellungen SET status = 'storniert', aktualisiert = ? WHERE nr = ?").bind(jetzt(), w.nr),
      env.DB.prepare("DELETE FROM bewertungsanfragen WHERE nr = ? AND gesendet = ''").bind(w.nr),
      env.DB.prepare("UPDATE gutscheine SET eingeloest_nr = '', eingeloest_am = '' WHERE eingeloest_nr = ?").bind(w.nr),
    ]);
  }
  ctx.waitUntil(senden(env, b.email, `Erstattung zu Ihrer Bestellung ${b.nr}`, erstattetMail(env, b, { ...w, positionen: JSON.parse(w.positionen), betrag })));
  return { ok: true };
}
