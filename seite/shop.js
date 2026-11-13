/* Domo Gastro – Shop-Logik im Browser.
   Preise in den Seiten sind NETTO (data-netto). Der Schalter Privat/Gewerbe zeigt brutto oder netto.
   Warenkorb und Anmeldung liegen im localStorage dieses Browsers (technisch erforderlich, § 25 Abs. 2 Nr. 2 TDDDG),
   keine Cookies, kein Tracking. Server (Konto, Bestellung, Bewertungen): window.DG.api; leer = noch nicht freigeschaltet. */
(function () {
  "use strict";
  var DG = window.DG || {};
  var MWST = DG.mwst || 0.19;
  var B = DG.basis || "";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function lies(k, std) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : std; } catch (e) { return std; } }
  function schreib(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function eur(v) { return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function brutto(n) { return Math.round(n * (1 + MWST) * 100) / 100; }

  /* ---------- Privat / Gewerbe ---------- */
  var modus = lies("dg-modus", DG.modus || "privat");
  function istGewerbe() { return modus === "gewerbe"; }
  function preisText(netto) { return eur(istGewerbe() ? netto : brutto(netto)); }
  function steuerText() { return istGewerbe() ? "zzgl. 19 % MwSt." : "inkl. 19 % MwSt."; }
  // Nur Anzeige aktualisieren, ohne Ereignis (Seiten rufen das in ihrem eigenen Neuzeichnen auf)
  function preiseSetzen() {
    $$(".pr[data-netto]").forEach(function (e) {
      var n = parseFloat(e.dataset.netto);
      if (isNaN(n)) return;
      e.textContent = (e.dataset.ab ? "ab " : "") + preisText(n);
    });
    $$(".steuer").forEach(function (e) { e.textContent = steuerText() + (e.dataset.zusatz || ""); });
    $$(".seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.modus === modus)); });
    $$(".nur-gewerbe").forEach(function (e) { e.hidden = !istGewerbe(); });
    $$(".nur-privat").forEach(function (e) { e.hidden = istGewerbe(); });
    var f = $(".fuss .steuerhinweis");
    if (f) f.textContent = istGewerbe()
      ? "Preisanzeige für Gewerbekunden: alle Preise netto zzgl. 19 % MwSt. Versandkostenfrei innerhalb Deutschlands."
      : "Alle Preise inkl. 19 % MwSt. Versandkostenfrei innerhalb Deutschlands.";
  }
  function preiseZeigen() { preiseSetzen(); document.dispatchEvent(new CustomEvent("dg:modus")); }

  /* ---------- Warenkorb ---------- */
  function korb() { return lies("dg-korb", []); }
  function korbSpeichern(k) { schreib("dg-korb", k); korbZaehler(); }
  function korbZaehler() {
    var n = korb().reduce(function (s, p) { return s + p.menge; }, 0);
    $$(".korb b").forEach(function (b) { b.textContent = n; });
  }
  function inDenKorb(sku, menge) {
    var k = korb(), p = k.filter(function (x) { return x.sku === sku; })[0];
    if (p) p.menge = Math.min(99, p.menge + menge); else k.push({ sku: sku, menge: menge });
    korbSpeichern(k);
    var c = $(".korb"); if (c) { c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
  }

  var indexVersprechen = null;
  function index() {
    if (!indexVersprechen) indexVersprechen = fetch(B + "/produkte-index.json").then(function (r) { return r.json(); });
    return indexVersprechen;
  }

  /* ---------- Server ---------- */
  function sitzung() { var s = lies("dg-sitzung", null); if (s && s.bis < Date.now()) { schreib("dg-sitzung", null); return null; } return s; }
  function api(pfad, daten, methode) {
    if (!DG.api) return Promise.reject(new Error("offline"));
    var s = sitzung(), kopf = { "Content-Type": "application/json" };
    if (s) kopf.Authorization = "Bearer " + s.token;
    return fetch(DG.api + pfad, { method: methode || (daten ? "POST" : "GET"), headers: kopf, body: daten ? JSON.stringify(daten) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && s) { schreib("dg-sitzung", null); kontoKopf(); }
          if (!r.ok) throw new Error(j.fehler || "Der Server ist gerade nicht erreichbar.");
          return j;
        });
      });
  }
  function offlineHinweis(ziel) {
    ziel.innerHTML = '<p class="meldung">Kundenkonto, Bestellverfolgung und Bewertungen werden freigeschaltet, sobald der Shop-Server läuft. ' +
      'Bestellen können Sie trotzdem schon, als Gast über den Warenkorb.</p>';
  }
  function kontoKopf() {
    var s = sitzung();
    $$(".konto-link").forEach(function (a) { a.textContent = s ? "Mein Konto" : "Anmelden | Konto anlegen"; });
  }

  /* ---------- Produktseite ---------- */
  function produktseite() {
    var art = $(".produkt"); if (!art) return;
    var wahl = $(".variante", art);
    function variante() {
      if (!wahl) return null;
      return wahl.options[wahl.selectedIndex];
    }
    function zeigen() {
      var o = variante(); if (!o) return;
      $(".sku", art).textContent = o.value;
      var pr = $(".preis-gross .pr", art);
      if (o.dataset.netto) { pr.dataset.netto = o.dataset.netto; pr.hidden = false; $(".preis-gross .steuer", art).hidden = false; $(".anfrage", art).hidden = true; $(".kaufen", art).disabled = false; }
      else { pr.hidden = true; $(".preis-gross .steuer", art).hidden = true; $(".anfrage", art).hidden = false; $(".kaufen", art).disabled = true; }
      $(".masse", art).textContent = o.dataset.masse || "";
      $(".lieferzeit", art).textContent = o.dataset.lieferzeit || "";
      $(".kaufen", art).dataset.sku = o.value;
      preiseSetzen();
    }
    if (wahl) { wahl.addEventListener("change", zeigen); zeigen(); }
    $$(".daumen button", art).forEach(function (b) {
      b.addEventListener("click", function () {
        $(".gross img", art).src = b.dataset.bild;
        $$(".daumen button", art).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      });
    });
    var k = $(".kaufen", art);
    if (k) k.addEventListener("click", function () {
      var m = Math.max(1, Math.min(99, parseInt($(".kauf input", art).value, 10) || 1));
      inDenKorb(k.dataset.sku, m);
      k.textContent = "Im Warenkorb ✓";
      setTimeout(function () { k.textContent = "In den Warenkorb"; }, 1600);
    });
    bewertungen(art.dataset.slug);
  }

  function sterne(n) { var s = ""; for (var i = 1; i <= 5; i++) s += i <= Math.round(n) ? "★" : "☆"; return s; }
  function bewertungen(slug) {
    var box = $("#bewertungen"); if (!box) return;
    var liste = $(".liste", box), form = $("form", box);
    if (!DG.api) { liste.innerHTML = '<p class="klein">Bewertungen werden freigeschaltet, sobald der Shop-Server läuft.</p>'; form.hidden = true; return; }
    api("/bewertungen?produkt=" + encodeURIComponent(slug)).then(function (d) {
      $(".schnitt", box).textContent = d.anzahl ? sterne(d.schnitt) + " " + d.schnitt.toFixed(1).replace(".", ",") + " von 5 (" + d.anzahl + ")" : "";
      liste.innerHTML = d.liste.length ? d.liste.map(function (b) {
        return '<div class="bewertung"><span class="sterne">' + sterne(b.sterne) + "</span> <b>" + esc(b.titel) + "</b>" +
          (b.verifiziert ? ' <span class="klein">· Verifizierter Kauf</span>' : "") +
          "<p>" + esc(b.text) + '</p><span class="klein">' + esc(b.name) + " am " + new Date(b.datum).toLocaleDateString("de-DE") + "</span></div>";
      }).join("") : '<p class="klein">Noch keine Bewertungen. Kaufen Sie das Produkt, können Sie es als Erste(r) bewerten.</p>';
    }).catch(function () { liste.innerHTML = '<p class="klein">Bewertungen konnten nicht geladen werden.</p>'; });
    if (!sitzung()) { form.innerHTML = '<p class="klein"><a href="' + B + '/konto/">Melden Sie sich an</a>, um ein gekauftes Produkt zu bewerten.</p>'; return; }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(form), st = $(".status", form);
      api("/bewertungen", { produkt: slug, sterne: +f.get("sterne"), titel: f.get("titel"), text: f.get("text") })
        .then(function () { st.className = "status meldung ok"; st.textContent = "Danke! Ihre Bewertung erscheint nach kurzer Prüfung."; form.reset(); })
        .catch(function (err) { st.className = "status meldung fehler"; st.textContent = err.message; });
    });
  }

  /* ---------- Kategorie: Filter und Sortierung ---------- */
  function kategorieseite() {
    var r = $(".raster[data-filter]"); if (!r) return;
    var karten = $$(".p", r), aktiv = "";
    function anwenden() {
      karten.forEach(function (k) { k.hidden = aktiv && k.dataset.unter !== aktiv; });
      $$(".chips button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.unter === aktiv)); });
    }
    $$(".chips button").forEach(function (b) { b.addEventListener("click", function () { aktiv = b.dataset.unter; anwenden(); }); });
    var sort = $("#sortierung");
    if (sort) sort.addEventListener("change", function () {
      var v = sort.value;
      karten.sort(function (a, b) {
        if (v === "name") return a.dataset.name.localeCompare(b.dataset.name, "de");
        var pa = parseFloat(a.dataset.preis) || 1e9, pb = parseFloat(b.dataset.preis) || 1e9;
        return v === "preis-ab" ? pb - pa : pa - pb;
      }).forEach(function (k) { r.appendChild(k); });
    });
    var h = decodeURIComponent(location.hash.slice(1));
    if (h && $$(".chips button").some(function (b) { return b.dataset.unter === h; })) aktiv = h;
    anwenden();
  }

  /* ---------- Suche ---------- */
  function karteHtml(p) {
    return '<a class="p" href="' + B + "/produkt/" + p.s + '/"><div class="ph">' + (p.b ? '<img src="' + esc(p.b) + '" alt="" loading="lazy">' : "") +
      '</div><p class="n">' + esc(p.n) + '</p><span class="t">' + esc(p.h || "") + "</span>" +
      (p.p ? '<div><span class="pr" data-netto="' + p.p + '"' + (p.ab ? ' data-ab="1"' : "") + '></span><span class="steuer"></span></div>' : '<span class="anfrage">Preis auf Anfrage</span>') + "</a>";
  }
  function suchseite() {
    var ziel = $("#treffer"); if (!ziel) return;
    var q = (new URLSearchParams(location.search).get("q") || "").trim();
    $$(".suche input").forEach(function (i) { i.value = q; });
    if (!q) { ziel.innerHTML = '<p class="klein">Bitte einen Suchbegriff eingeben.</p>'; return; }
    index().then(function (ix) {
      var w = q.toLowerCase().split(/\s+/);
      var t = ix.produkte.filter(function (p) {
        var hay = (p.n + " " + p.k + " " + p.u + " " + (p.h || "") + " " + p.skus.join(" ")).toLowerCase();
        return w.every(function (x) { return hay.indexOf(x) >= 0; });
      });
      $("#anzahl").textContent = t.length + " Treffer für „" + q + "“";
      ziel.innerHTML = t.map(karteHtml).join("") || '<p class="klein">Nichts gefunden. Versuchen Sie einen anderen Begriff oder eine Artikelnummer.</p>';
      preiseSetzen();
    });
  }

  /* ---------- Warenkorb und Kasse ---------- */
  function rechnen(ix) {
    var pos = korb().map(function (p) { var a = ix.artikel[p.sku]; return a && a.p ? { sku: p.sku, menge: p.menge, a: a } : null; }).filter(Boolean);
    var netto = pos.reduce(function (s, p) { return s + p.a.p * p.menge; }, 0);
    netto = Math.round(netto * 100) / 100;
    var mwst = Math.round(netto * MWST * 100) / 100;
    return { pos: pos, netto: netto, mwst: mwst, brutto: Math.round((netto + mwst) * 100) / 100 };
  }
  function kasse() {
    var ziel = $("#korb-liste"); if (!ziel) return;
    var form = $("#bestellung"), sum = $("#summe");
    index().then(function (ix) {
      function zeichnen() {
        var r = rechnen(ix);
        // Artikel ohne Preis oder nicht mehr im Sortiment still entfernen
        if (r.pos.length !== korb().length) korbSpeichern(r.pos.map(function (p) { return { sku: p.sku, menge: p.menge }; }));
        if (!r.pos.length) { ziel.innerHTML = '<p>Ihr Warenkorb ist leer. <a href="' + B + '/">Weiter einkaufen</a></p>'; form.hidden = true; sum.hidden = true; return; }
        form.hidden = false; sum.hidden = false;
        ziel.innerHTML = r.pos.map(function (p) {
          return '<div class="posten" data-sku="' + esc(p.sku) + '">' + (p.a.b ? '<img src="' + esc(p.a.b) + '" alt="">' : "<span></span>") +
            '<div><a href="' + B + "/produkt/" + p.a.s + '/">' + esc(p.a.n) + '</a><div class="klein">Art.-Nr. ' + esc(p.sku) + " · Lieferzeit " + esc(p.a.l || "auf Anfrage") + (p.a.sp ? " · Spedition" : "") +
            '</div><div class="menge"><label class="sr" for="m-' + esc(p.sku) + '">Menge</label><input id="m-' + esc(p.sku) + '" type="number" min="1" max="99" value="' + p.menge + '"><button class="weg" type="button">Entfernen</button></div></div>' +
            '<div><span class="pr" data-netto="' + (p.a.p * p.menge).toFixed(2) + '"></span></div></div>';
        }).join("");
        var g = istGewerbe();
        sum.innerHTML = "<div><span>Warenwert " + (g ? "netto" : "inkl. MwSt.") + "</span><b>" + eur(g ? r.netto : r.brutto) + "</b></div>" +
          "<div><span>Versand (Deutschland)</span><b>kostenlos</b></div>" +
          (g ? "<div><span>zzgl. 19 % MwSt.</span><b>" + eur(r.mwst) + "</b></div>" : "<div><span>darin 19 % MwSt.</span><b>" + eur(r.mwst) + "</b></div>") +
          '<div class="gesamt"><span>Gesamtbetrag</span><span>' + eur(r.brutto) + "</span></div>" +
          '<p class="klein">Lieferung nur innerhalb Deutschlands. Speditionsware wird bis Bordsteinkante geliefert.</p>';
        preiseSetzen();
      }
      ziel.addEventListener("change", function (e) {
        if (!e.target.matches("input")) return;
        var sku = e.target.closest(".posten").dataset.sku, k = korb();
        k.forEach(function (p) { if (p.sku === sku) p.menge = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)); });
        korbSpeichern(k); zeichnen();
      });
      ziel.addEventListener("click", function (e) {
        if (!e.target.matches(".weg")) return;
        var sku = e.target.closest(".posten").dataset.sku;
        korbSpeichern(korb().filter(function (p) { return p.sku !== sku; })); zeichnen();
      });
      document.addEventListener("dg:modus", zeichnen);
      zeichnen();

      // Mit Konto: Adresse vorbelegen
      var s = sitzung();
      if (s && DG.api) api("/konto").then(function (d) {
        var k = d.kunde || {};
        ["name", "firma", "ustid", "strasse", "plz", "ort", "telefon", "email"].forEach(function (f) { if (k[f] && form.elements[f] && !form.elements[f].value) form.elements[f].value = k[f]; });
        $("#gast-hinweis").innerHTML = "Sie bestellen als <b>" + esc(k.email) + "</b>. Die Bestellung erscheint in Ihrem Konto.";
      }).catch(function () {});

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var st = $(".status", form), f = new FormData(form), r = rechnen(ix);
        if (istGewerbe() && !f.get("gewerbe_bestaetigt")) { st.className = "status meldung fehler"; st.textContent = "Bitte bestätigen Sie, dass Sie als Unternehmer bestellen, oder wechseln Sie oben auf „Privat“."; return; }
        var daten = {
          modus: modus, positionen: r.pos.map(function (p) { return { sku: p.sku, menge: p.menge }; }),
          kunde: { name: f.get("name"), firma: f.get("firma") || "", ustid: f.get("ustid") || "", strasse: f.get("strasse"), plz: f.get("plz"), ort: f.get("ort"),
                   email: f.get("email"), telefon: f.get("telefon") || "", hinweis: f.get("hinweis") || "" },
          zahlart: f.get("zahlart"), agb: !!f.get("agb"), gesamt_brutto: r.brutto,
          konto_anlegen: !!f.get("konto_anlegen"), passwort: f.get("passwort") || "",
        };
        var knopf = $("button[type=submit]", form);
        if (!DG.api) {
          // Übergangslösung ohne Server: vorbereitete E-Mail
          var zeilen = r.pos.map(function (p) { return p.menge + " × " + p.a.n + " (Art.-Nr. " + p.sku + ") je " + eur(p.a.p) + " netto"; });
          var text = "Bestellung (" + (istGewerbe() ? "Gewerbe" : "Privat") + ")\n\n" + zeilen.join("\n") + "\n\nSumme: " + eur(r.netto) + " netto, " + eur(r.brutto) + " brutto\nZahlart: " + daten.zahlart +
            "\n\n" + [daten.kunde.firma, daten.kunde.name, daten.kunde.strasse, daten.kunde.plz + " " + daten.kunde.ort, daten.kunde.email, daten.kunde.telefon, daten.kunde.ustid, daten.kunde.hinweis].filter(Boolean).join("\n");
          location.href = "mailto:" + DG.mail + "?subject=" + encodeURIComponent("Bestellung Domo Gastro") + "&body=" + encodeURIComponent(text);
          return;
        }
        knopf.disabled = true; st.className = "status meldung"; st.textContent = "Bestellung wird übermittelt …";
        api("/bestellung", daten).then(function (d) {
          if (d.sitzung) schreib("dg-sitzung", d.sitzung);
          if (d.paypal) { schreib("dg-offen", { nr: d.nr, email: daten.kunde.email }); location.href = d.paypal; return; }
          korbSpeichern([]);
          location.href = B + "/bestellung/?nr=" + encodeURIComponent(d.nr) + "&email=" + encodeURIComponent(daten.kunde.email) + "&neu=1";
        }).catch(function (err) { knopf.disabled = false; st.className = "status meldung fehler"; st.textContent = err.message; });
      });
      var ka = form.elements.konto_anlegen;
      if (ka) ka.addEventListener("change", function () { $("#pw-feld").hidden = !ka.checked; form.elements.passwort.required = ka.checked; });
      if (s && ka) ka.closest("label").hidden = true;
    });
  }

  /* ---------- Bestellstatus (Gast und Konto) ---------- */
  var SCHRITTE = [["eingegangen", "Eingegangen"], ["bezahlt", "Bezahlt"], ["in_bearbeitung", "In Bearbeitung"], ["versendet", "Versendet"], ["zugestellt", "Zugestellt"]];
  function statusHtml(b) {
    if (b.status === "storniert") return '<div class="bestellstatus"><span class="an">Storniert</span></div>';
    var i = SCHRITTE.map(function (x) { return x[0]; }).indexOf(b.status);
    return '<div class="bestellstatus">' + SCHRITTE.map(function (x, j) { return '<span class="' + (j <= i ? "an" : "") + '">' + x[1] + "</span>"; }).join("") + "</div>";
  }
  function bestellHtml(b) {
    return '<div class="kasten" style="margin-bottom:14px"><b>Bestellung ' + esc(b.nr) + "</b> vom " + new Date(b.datum).toLocaleDateString("de-DE") + statusHtml(b) +
      "<ul>" + b.positionen.map(function (p) { return "<li>" + p.menge + " × " + esc(p.name) + " (" + esc(p.sku) + ")</li>"; }).join("") + "</ul>" +
      "<p>Gesamt: <b>" + eur(b.brutto) + "</b> inkl. MwSt. · " + esc(b.zahlart) + (b.sendung ? " · Sendung: " + esc(b.sendung) : "") + "</p></div>";
  }
  function bestellseite() {
    var ziel = $("#bestell-ergebnis"); if (!ziel) return;
    var form = $("#bestell-suche"), q = new URLSearchParams(location.search);
    if (!DG.api) { offlineHinweis(ziel); form.hidden = true; return; }
    function laden(nr, email) {
      api("/bestellung/status", { nr: nr, email: email }).then(function (b) {
        ziel.innerHTML = (q.get("neu") ? '<p class="meldung ok">Vielen Dank! Ihre Bestellung ist eingegangen. Eine Bestätigung kommt per E-Mail.' +
          (b.zahlart === "Vorkasse" ? " Die Bankverbindung steht in der E-Mail; Verwendungszweck ist Ihre Bestellnummer." : "") + "</p>" : "") + bestellHtml(b);
      }).catch(function (err) { ziel.innerHTML = '<p class="meldung fehler">' + esc(err.message) + "</p>"; });
    }
    // Rückkehr von PayPal
    if (q.get("token") && q.get("paypal")) {
      var o = lies("dg-offen", {});
      ziel.innerHTML = '<p class="meldung">Zahlung wird abgeschlossen …</p>';
      api("/bezahlen/abschluss", { nr: q.get("paypal"), paypal_id: q.get("token") }).then(function () {
        korbSpeichern([]); schreib("dg-offen", null);
        location.replace(B + "/bestellung/?nr=" + encodeURIComponent(q.get("paypal")) + "&email=" + encodeURIComponent(o.email || "") + "&neu=1");
      }).catch(function (err) { ziel.innerHTML = '<p class="meldung fehler">' + esc(err.message) + "</p>"; });
      return;
    }
    if (q.get("nr")) { form.elements.nr.value = q.get("nr"); form.elements.email.value = q.get("email") || ""; laden(q.get("nr"), q.get("email")); }
    form.addEventListener("submit", function (e) { e.preventDefault(); laden(form.elements.nr.value.trim(), form.elements.email.value.trim()); });
  }

  /* ---------- Konto ---------- */
  function kontoseite() {
    var box = $("#konto"); if (!box) return;
    if (!DG.api) { offlineHinweis($("#konto-meldung")); $$("form", box).forEach(function (f) { f.hidden = true; }); $(".reiter", box).hidden = true; return; }
    var q = new URLSearchParams(location.search);
    function meld(t, ok) { var m = $("#konto-meldung"); m.innerHTML = t ? '<p class="meldung ' + (ok ? "ok" : "fehler") + '">' + esc(t) + "</p>" : ""; }
    function reiter(name) {
      $$(".reiter button", box).forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.ziel === name)); });
      $$("[data-bereich]", box).forEach(function (f) { f.hidden = f.dataset.bereich !== name; });
    }
    $$(".reiter button", box).forEach(function (b) { b.addEventListener("click", function () { meld(""); reiter(b.dataset.ziel); }); });
    function angemeldet() {
      $(".reiter", box).hidden = true;
      $$("[data-bereich]", box).forEach(function (f) { f.hidden = f.dataset.bereich !== "uebersicht"; });
      api("/konto").then(function (d) {
        var k = d.kunde;
        $("#konto-name").textContent = k.name || k.email;
        var pf = $("#profil");
        ["name", "firma", "ustid", "strasse", "plz", "ort", "telefon"].forEach(function (f) { if (pf.elements[f]) pf.elements[f].value = k[f] || ""; });
        $("#meine-bestellungen").innerHTML = d.bestellungen.length ? d.bestellungen.map(bestellHtml).join("") : '<p class="klein">Noch keine Bestellungen.</p>';
      }).catch(function (err) { meld(err.message); });
    }
    function sitzungSetzen(d) { schreib("dg-sitzung", d.sitzung); kontoKopf(); angemeldet(); }
    $("#anmelden").addEventListener("submit", function (e) {
      e.preventDefault(); var f = new FormData(e.target);
      api("/konto/anmelden", { email: f.get("email"), passwort: f.get("passwort") }).then(sitzungSetzen).catch(function (err) { meld(err.message); });
    });
    $("#registrieren").addEventListener("submit", function (e) {
      e.preventDefault(); var f = new FormData(e.target);
      if (f.get("passwort") !== f.get("passwort2")) { meld("Die Passwörter stimmen nicht überein."); return; }
      api("/konto/registrieren", { email: f.get("email"), passwort: f.get("passwort"), name: f.get("name"), datenschutz: !!f.get("datenschutz") })
        .then(function (d) { sitzungSetzen(d); meld("Willkommen! Ihr Konto ist angelegt.", true); }).catch(function (err) { meld(err.message); });
    });
    $("#vergessen").addEventListener("submit", function (e) {
      e.preventDefault(); var f = new FormData(e.target);
      api("/konto/passwort-vergessen", { email: f.get("email") }).then(function () { meld("Falls ein Konto mit dieser Adresse existiert, ist eine E-Mail mit einem Link unterwegs.", true); })
        .catch(function (err) { meld(err.message); });
    });
    $("#neues-passwort").addEventListener("submit", function (e) {
      e.preventDefault(); var f = new FormData(e.target);
      api("/konto/passwort-setzen", { token: q.get("reset"), passwort: f.get("passwort") }).then(function (d) { history.replaceState(null, "", location.pathname); sitzungSetzen(d); meld("Passwort geändert.", true); })
        .catch(function (err) { meld(err.message); });
    });
    $("#profil").addEventListener("submit", function (e) {
      e.preventDefault(); var f = new FormData(e.target), d = {};
      f.forEach(function (v, k) { d[k] = v; });
      api("/konto", d, "PUT").then(function () { meld("Gespeichert.", true); }).catch(function (err) { meld(err.message); });
    });
    $("#abmelden").addEventListener("click", function () { api("/konto/abmelden", {}).catch(function () {}); schreib("dg-sitzung", null); kontoKopf(); location.reload(); });
    $("#loeschen").addEventListener("click", function () {
      if (!confirm("Konto wirklich löschen? Bestellungen bleiben wegen der Aufbewahrungspflicht gespeichert, werden aber vom Konto getrennt.")) return;
      api("/konto", {}, "DELETE").then(function () { schreib("dg-sitzung", null); location.href = B + "/"; }).catch(function (err) { meld(err.message); });
    });
    if (q.get("reset")) reiter("neu");
    else if (sitzung()) angemeldet();
    else reiter("anmelden");
  }

  /* ---------- Start ---------- */
  document.addEventListener("click", function (e) {
    var s = e.target.closest(".seg button");
    if (s) { modus = s.dataset.modus; schreib("dg-modus", modus); preiseZeigen(); return; }
    var a = e.target.closest(".add[data-sku]");
    if (a) { e.preventDefault(); inDenKorb(a.dataset.sku, 1); }
  });
  korbZaehler(); kontoKopf(); preiseZeigen();
  produktseite(); kategorieseite(); suchseite(); kasse(); bestellseite(); kontoseite();
})();
