// Verwaltung: Bestellstatus setzen, Bewertungen freigeben. Schlüssel nur für diese Browser-Sitzung gemerkt.
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

  async function laden() {
    if (!DG.api) { box.innerHTML = `<p class="hinweis">Der Shop-Server ist noch nicht eingerichtet.</p>`; return; }
    if (!schluessel) return anmelden();
    let d;
    try { d = await rufen("/verwaltung"); } catch (err) { schluessel = ""; try { sessionStorage.removeItem("dg-verwaltung"); } catch {} return anmelden(err.message); }
    const bew = d.bewertungen.length ? d.bewertungen.map((b) => `<div class="v-karte"><b>${"★".repeat(b.sterne)}${"☆".repeat(5 - b.sterne)} ${esc(b.titel)}</b>
      <p>${esc(b.text)}</p><p class="klein">${esc(b.name)} · ${esc(b.produkt)} · ${esc(b.datum.slice(0, 10))}</p>
      <button class="btn pri" data-bew="${b.id}" data-ja="1">Freigeben</button> <button class="btn sec" data-bew="${b.id}">Löschen</button></div>`).join("")
      : "<p>Keine offenen Bewertungen.</p>";
    const best = d.bestellungen.length ? d.bestellungen.map((b) => `<div class="v-karte"><b>${esc(b.nr)}</b> · ${esc(b.datum.slice(0, 16).replace("T", " "))} · ${b.modus === "gewerbe" ? "Gewerbe" : "Privat"} · ${esc(b.zahlart)} · <b>${euro(b.brutto)}</b>
      <p class="klein">${esc([b.kunde.firma, b.kunde.name, b.kunde.strasse, `${b.kunde.plz} ${b.kunde.ort}`, b.email, b.kunde.telefon].filter(Boolean).join(" · "))}${b.transaktion ? ` · PayPal ${esc(b.transaktion)}` : ""}</p>
      <p class="klein">${b.positionen.map((p) => `${p.menge} × ${esc(p.name)} (${esc(p.sku)})`).join("<br>")}</p>
      ${b.kunde.hinweis ? `<p class="klein">Hinweis: ${esc(b.kunde.hinweis)}</p>` : ""}
      <form class="v-status" data-nr="${esc(b.nr)}"><select name="status">${Object.entries(STATI).map(([k, t]) => `<option value="${k}"${k === b.status ? " selected" : ""}>${t}</option>`).join("")}</select>
      <input name="sendung" placeholder="Sendungsnummer / Link" value="${esc(b.sendung || "")}">
      <label class="check klein"><input type="checkbox" name="mail" checked> Kunde per E-Mail informieren</label>
      <button class="btn pri">Speichern</button></form></div>`).join("")
      : "<p>Noch keine Bestellungen.</p>";
    box.innerHTML = `<h2>Bewertungen zur Freigabe (${d.bewertungen.length})</h2>${bew}<h2>Bestellungen (${d.bestellungen.length})</h2>${best}
      <p><button class="btn sec" id="v-ab">Abmelden</button></p>`;
    box.querySelectorAll("[data-bew]").forEach((k) => k.addEventListener("click", async () => {
      k.disabled = true;
      try { await rufen("/verwaltung/bewertung", { id: k.dataset.bew, freigeben: Boolean(k.dataset.ja) }); laden(); } catch (err) { alert(err.message); k.disabled = false; }
    }));
    box.querySelectorAll(".v-status").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const k = f.querySelector("button"); k.disabled = true; k.textContent = "…";
      try { await rufen("/verwaltung/status", { nr: f.dataset.nr, status: f.status.value, sendung: f.sendung.value, benachrichtigen: f.mail.checked }); k.textContent = "Gespeichert ✓"; }
      catch (err) { k.textContent = "Speichern"; alert(err.message); }
      k.disabled = false;
    }));
    document.getElementById("v-ab").addEventListener("click", () => { schluessel = ""; try { sessionStorage.removeItem("dg-verwaltung"); } catch {} anmelden(); });
  }
  laden();
})();
