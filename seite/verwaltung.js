// Verwaltung: Bestellstatus setzen, Bewertungen löschen. Schlüssel nur für diese Browser-Sitzung gemerkt.
(function () {
  "use strict";
  const DG = window.DG || {};
  const box = document.getElementById("verwaltung");
  if (!box) return;
  const STATI = { eingegangen: "eingegangen", zahlung_offen: "Zahlung offen", bezahlt: "bezahlt", in_bearbeitung: "in Bearbeitung", versendet: "versendet", zugestellt: "zugestellt", storniert: "storniert" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const euro = (x) => Number(x).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  let schluessel = "";
  try { schluessel = sessionStorage.getItem("dg-verwaltung") || ""; } catch {}

  async function rufen(pfad, daten) {
    const r = await fetch(DG.api + pfad, {
      method: daten ? "POST" : "GET",
      headers: { Authorization: `Bearer ${schluessel}`, ...(daten ? { "Content-Type": "application/json" } : {}) },
      ...(daten ? { body: JSON.stringify(daten) } : {}),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.fehler || `Fehler ${r.status}`);
    return d;
  }

  function anmelden(meldung) {
    box.innerHTML = `<form id="v-login" class="kasten" style="max-width:420px"><label>Verwaltungsschlüssel<input type="password" name="s" required autocomplete="current-password"></label>
      <button class="btn pri">Öffnen</button>${meldung ? `<p class="meldung fehler">${esc(meldung)}</p>` : ""}</form>`;
    box.querySelector("form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      schluessel = ev.target.s.value.trim();
      try { sessionStorage.setItem("dg-verwaltung", schluessel); } catch {}
      laden();
    });
  }

  // Pro Bestellung nur der nächste nötige Schritt: Vorkasse → „Zahlung eingegangen“, dann → „Versendet“ (mit Sendungsnummer).
  // Kreditkarte/PayPal sind schon bezahlt. „In Bearbeitung“ und „Zugestellt“ braucht es nicht.
  const offen = (b) => ["eingegangen", "zahlung_offen"].includes(b.status);
  const zuVersenden = (b) => ["bezahlt", "in_bearbeitung"].includes(b.status);
  function aufgabe(b) {
    if (offen(b)) return `<p class="v-aufgabe">⏳ Wartet auf Überweisung von <b>${euro(b.brutto)}</b> (Verwendungszweck ${esc(b.nr)})
      <button class="btn pri" data-schritt="bezahlt" data-nr="${esc(b.nr)}">Zahlung ist eingegangen</button></p>`;
    if (zuVersenden(b)) return `<form class="v-aufgabe v-versand" data-nr="${esc(b.nr)}">📦 Bezahlt, bitte versenden:
      <input name="sendung" placeholder="GLS-Sendungsnummer (optional)"> <button class="btn pri">Als versendet melden</button></form>`;
    if (["versendet", "zugestellt"].includes(b.status)) return `<p class="v-aufgabe">✓ Versendet${b.sendung ? `, Sendung ${esc(b.sendung)}` : ""}. Nichts mehr zu tun.</p>`;
    return `<p class="v-aufgabe">Storniert.</p>`;
  }

  // Widerrufe: eingegangen → „Ware ist zurück“ → „Erstattet“ (Betrag änderbar, z. B. Wertersatz). Das Geld schickt Lenn selbst zurück.
  function widerrufe(b) {
    return (b.widerrufe || []).map((w) => {
      const kopf = `↩︎ <b>Widerruf</b> vom ${esc(w.datum.slice(0, 16).replace("T", " "))}: ${w.positionen.map((p) => `${p.menge} × ${esc(p.name)}`).join(", ")}${w.grund ? ` · „${esc(w.grund)}“` : ""}`;
      if (w.status === "erstattet") return `<p class="v-widerruf">${kopf}<br>✓ ${euro(w.betrag)} erstattet.</p>`;
      const wie = b.zahlart === "Vorkasse" ? "per Überweisung an den Kunden" : `in PayPal bei Transaktion ${esc(b.transaktion || "?")} über „Rückzahlung“`;
      return `<div class="v-widerruf">${kopf}${b.modus === "gewerbe" ? "<br><b>Gewerbekunde:</b> gesetzliches Widerrufsrecht gilt nicht, Kulanz?" : ""}
        <br>Kaufpreis dieser Artikel: <b>${euro(w.vorschlag)}</b>. Zu erstatten ${wie}, spätestens 14 Tage nach Eingang.
        ${w.status === "eingegangen" ? `<br><button class="btn sec" data-wid="${w.id}" data-wschritt="zurueck">Ware ist zurück</button>` : "<br>📦 Ware ist zurück."}
        <form class="v-erstatten" data-wid="${w.id}">Erstattet: <input name="betrag" inputmode="decimal" value="${String(w.vorschlag.toFixed(2)).replace(".", ",")}" style="width:110px"> €
        <button class="btn pri">Als erstattet melden</button></form></div>`;
    }).join("");
  }

  async function laden() {
    if (!DG.api) { box.innerHTML = `<p class="hinweis">Der Shop-Server ist noch nicht eingerichtet.</p>`; return; }
    if (!schluessel) return anmelden();
    let d;
    try { d = await rufen("/verwaltung"); } catch (err) { schluessel = ""; try { sessionStorage.removeItem("dg-verwaltung"); } catch {} return anmelden(err.message); }
    const bew = d.bewertungen.length ? d.bewertungen.map((b) => `<div class="v-karte"><b>${"★".repeat(b.sterne)}${"☆".repeat(5 - b.sterne)} ${esc(b.titel)}</b>
      ${b.text ? `<p>${esc(b.text)}</p>` : ""}<p class="klein">${esc(b.name)} · <a href="${DG.basis || ""}/produkt/${esc(b.produkt)}/">${esc(b.produkt)}</a> · ${esc(b.datum.slice(0, 10))}</p>
      <button class="btn sec" data-bew="${b.id}">Löschen</button></div>`).join("")
      : "<p>Noch keine Bewertungen.</p>";
    const best = d.bestellungen.length ? d.bestellungen.map((b) => `<div class="v-karte"><b>${esc(b.nr)}</b> · ${esc(b.datum.slice(0, 16).replace("T", " "))} · ${b.modus === "gewerbe" ? "Gewerbe" : "Privat"} · ${esc(b.zahlart)} · <b>${euro(b.brutto)}</b>
      <p class="klein">Rechnung: ${esc([b.kunde.firma, b.kunde.name, b.kunde.strasse, `${b.kunde.plz} ${b.kunde.ort}`, b.email, b.kunde.telefon].filter(Boolean).join(" · "))}${b.transaktion ? ` · PayPal ${esc(b.transaktion)}` : ""}</p>
      <p class="klein">Lieferung: ${b.kunde.liefer ? esc([b.kunde.liefer.firma, b.kunde.liefer.name, b.kunde.liefer.strasse, `${b.kunde.liefer.plz} ${b.kunde.liefer.ort}`].filter(Boolean).join(" · ")) : "wie Rechnungsadresse"}</p>
      <p class="klein">${b.positionen.map((p) => `${p.menge} × ${esc(p.name)} (${esc(p.sku)})`).join("<br>")}</p>
      ${b.kunde.gutschein ? `<p class="klein">Gutschein ${esc(b.kunde.gutschein.code)}: −${b.kunde.gutschein.prozent} % (−${euro(b.kunde.gutschein.rabatt)} netto)</p>` : ""}
      ${b.kunde.hinweis ? `<p class="klein">Hinweis: ${esc(b.kunde.hinweis)}</p>` : ""}
      ${aufgabe(b)}
      ${widerrufe(b)}
      <details class="klein"><summary>Status von Hand ändern</summary>
      <form class="v-status" data-nr="${esc(b.nr)}"><select name="status">${Object.entries(STATI).map(([k, t]) => `<option value="${k}"${k === b.status ? " selected" : ""}>${t}</option>`).join("")}</select>
      <input name="sendung" placeholder="Sendungsnummer / Link" value="${esc(b.sendung || "")}">
      <label class="check klein"><input type="checkbox" name="mail" checked> Kunde per E-Mail informieren</label>
      <button class="btn sec">Speichern</button></form></details></div>`).join("")
      : "<p>Noch keine Bestellungen.</p>";
    const g = d.gutscheine;
    const gut = g ? `<div class="v-karte"><b>Bewertungs-Gutscheine (5 %)</b>
      <p>Vergeben: <b>${g.vergeben}</b> · eingelöst: <b>${g.eingeloest}</b>${g.vergeben ? ` (${Math.round(g.eingeloest / g.vergeben * 100)} %)` : ""}</p>
      <p>Bestellungen mit Code: <b>${g.alle.anzahl}</b> · Umsatz <b>${euro(g.alle.brutto)}</b> brutto (${euro(g.alle.netto)} netto) · gewährter Rabatt ${euro(g.alle.rabatt)} netto</p>
      <p class="klein">Davon bezahlt: ${g.bezahlt.anzahl} Bestellungen, ${euro(g.bezahlt.brutto)} brutto (${euro(g.bezahlt.netto)} netto). Stornierte Bestellungen zählen nicht mit.</p></div>` : "";
    const ng = d.newsletter_gutscheine;
    const nlGut = ng ? `<div class="v-karte"><b>Newsletter-Gutscheine (DGN-, einmal je Adresse)</b>
      <p>Vergeben: <b>${ng.vergeben}</b> · eingelöst: <b>${ng.eingeloest}</b>${ng.vergeben ? ` (${Math.round(ng.eingeloest / ng.vergeben * 100)} %)` : ""}</p>
      <p>Bestellungen mit Code: <b>${ng.alle.anzahl}</b> · Umsatz <b>${euro(ng.alle.brutto)}</b> brutto (${euro(ng.alle.netto)} netto) · gewährter Rabatt ${euro(ng.alle.rabatt)} netto</p></div>` : "";
    const nZahlung = d.bestellungen.filter(offen).length, nVersand = d.bestellungen.filter(zuVersenden).length;
    const nWiderruf = d.bestellungen.reduce((n, b) => n + (b.widerrufe || []).filter((w) => w.status !== "erstattet").length, 0);
    const todo = `<div class="v-karte"><b>Zu erledigen</b><p>${nZahlung || nVersand || nWiderruf ? `${nZahlung} Überweisung${nZahlung === 1 ? "" : "en"} abwarten · ${nVersand} Bestellung${nVersand === 1 ? "" : "en"} versenden${nWiderruf ? ` · <b>${nWiderruf} Widerruf${nWiderruf === 1 ? "" : "e"} erstatten</b>` : ""}` : "Alles erledigt."}</p></div>`;
    box.innerHTML = `${todo}<h2>Gutscheine</h2>${gut}${nlGut}<h2 id="v-newsletter">Newsletter</h2><div id="v-nl" class="v-karte">Lädt …</div><h2>Neueste Bewertungen (${d.bewertungen.length})</h2>${bew}<h2 id="v-bestellungen">Bestellungen (${d.bestellungen.length})</h2>${best}
      <p><button class="btn sec" id="v-ab">Abmelden</button></p>`;
    box.querySelectorAll("[data-bew]").forEach((k) => k.addEventListener("click", async () => {
      if (!confirm("Diese Bewertung endgültig löschen?")) return;
      k.disabled = true;
      try { await rufen("/verwaltung/bewertung", { id: k.dataset.bew, freigeben: false }); laden(); } catch (err) { alert(err.message); k.disabled = false; }
    }));
    box.querySelectorAll(".v-status").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const k = f.querySelector("button"); k.disabled = true; k.textContent = "…";
      try { await rufen("/verwaltung/status", { nr: f.dataset.nr, status: f.status.value, sendung: f.sendung.value, benachrichtigen: f.mail.checked }); k.textContent = "Gespeichert ✓"; }
      catch (err) { k.textContent = "Speichern"; alert(err.message); }
      k.disabled = false;
    }));
    box.querySelectorAll("[data-schritt]").forEach((k) => k.addEventListener("click", async () => {
      k.disabled = true;
      try { await rufen("/verwaltung/status", { nr: k.dataset.nr, status: k.dataset.schritt, benachrichtigen: true }); laden(); } catch (err) { alert(err.message); k.disabled = false; }
    }));
    box.querySelectorAll(".v-versand").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const k = f.querySelector("button"); k.disabled = true;
      try { await rufen("/verwaltung/status", { nr: f.dataset.nr, status: "versendet", sendung: f.sendung.value, benachrichtigen: true }); laden(); } catch (err) { alert(err.message); k.disabled = false; }
    }));
    box.querySelectorAll("[data-wschritt]").forEach((k) => k.addEventListener("click", async () => {
      k.disabled = true;
      try { await rufen("/verwaltung/widerruf", { id: k.dataset.wid, schritt: k.dataset.wschritt }); laden(); } catch (err) { alert(err.message); k.disabled = false; }
    }));
    box.querySelectorAll(".v-erstatten").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const betrag = f.betrag.value.trim();
      if (!confirm(`Hast du ${betrag} € wirklich schon zurückgezahlt? Der Kunde bekommt jetzt eine Mail.`)) return;
      const k = f.querySelector("button"); k.disabled = true;
      try { await rufen("/verwaltung/widerruf", { id: f.dataset.wid, schritt: "erstattet", betrag }); laden(); } catch (err) { alert(err.message); k.disabled = false; }
    }));
    newsletterLaden();
    document.getElementById("v-ab").addEventListener("click", () => { schluessel = ""; try { sessionStorage.removeItem("dg-verwaltung"); } catch {} anmelden(); });
  }
  // Newsletter: nur bestätigte Adressen (Double-Opt-in) mit Nachweis; CSV für einen späteren Versanddienst
  const csvFeld = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  async function newsletterLaden() {
    const ziel = document.getElementById("v-nl");
    let n;
    try { n = await rufen("/verwaltung/newsletter"); } catch (err) { ziel.textContent = err.message; return; }
    const a = n.anzahl;
    ziel.innerHTML = `<p>Bestätigt: <b>${a.bestaetigt}</b> · wartet auf Bestätigung: ${a.offen} · abgemeldet: ${a.abgemeldet}
      ${n.mindestwert ? ` · Mindestwert für den Code: ${euro(n.mindestwert)} netto` : " · Code ohne Mindestwert"}</p>
      ${n.liste.length ? `<p><button class="btn sec" id="v-nl-csv">Bestätigte Adressen als CSV herunterladen</button></p>
      <details class="klein"><summary>Liste anzeigen (${n.liste.length})</summary><table class="v-tabelle"><tr><th>E-Mail</th><th>Bestätigt</th><th>Quelle</th><th>Code</th></tr>
      ${n.liste.map((x) => `<tr><td>${esc(x.email)}</td><td>${esc(x.bestaetigt.slice(0, 16).replace("T", " "))}</td><td>${x.quelle === "kasse" ? "Kasse" : "Anmeldefeld"}</td><td>${esc(x.code)}${x.eingeloest_nr ? ` ✓ ${esc(x.eingeloest_nr)}` : ""}</td></tr>`).join("")}</table></details>
      <p class="klein">Die CSV enthält je Adresse den Nachweis der Einwilligung (Zeitpunkt und IP von Anmeldung und Bestätigung, Wortlaut). Bitte sicher aufbewahren und nur für den Newsletter nutzen.</p>` : "<p>Noch keine bestätigten Anmeldungen.</p>"}`;
    const k = document.getElementById("v-nl-csv");
    if (k) k.addEventListener("click", () => {
      const spalten = ["email", "bestaetigt", "bestaetigt_ip", "angemeldet", "anmelde_ip", "quelle", "einwilligung", "code", "eingeloest_nr"];
      const csv = "\ufeff" + [spalten.join(";"), ...n.liste.map((x) => spalten.map((s) => csvFeld(x[s])).join(";"))].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const l = Object.assign(document.createElement("a"), { href: url, download: `newsletter-domogastro-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  laden();
})();
