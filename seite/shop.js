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
  // Lieferland (Auslandsversand, Lenn 2026-11-19): Privatpreise zeigen die MwSt. des Lieferlandes (OSS) bzw. 0 % bei Ausfuhr
  var VERSAND = DG.versand || { laender: [{ c: "DE", n: "Deutschland", eu: true, mwst: 19, zone: null, elektro: true }], zonen: {}, paket_kg: 20, oss: true };
  var landCode = lies("dg-land", "DE");
  if (!window.DGR || !DGR.landVon(VERSAND, landCode)) landCode = "DE";
  function satz() { return window.DGR ? DGR.steuerArt(VERSAND, DGR.landVon(VERSAND, landCode), false).satz : 19; }
  function satzText() { return String(satz()).replace(".", ","); }
  function brutto(n) { return Math.round(n * (1 + satz() / 100) * 100) / 100; }

  /* ---------- Privat / Gewerbe ---------- */
  var modus = lies("dg-modus", DG.modus || "privat");
  function istGewerbe() { return modus === "gewerbe"; }
  function preisText(netto) { return eur(istGewerbe() ? netto : brutto(netto)); }
  function steuerText() {
    if (satz() === 0) return istGewerbe() ? "netto, steuerfreie Ausfuhr" : "ohne MwSt. (Ausfuhr), zzgl. Einfuhrabgaben";
    return (istGewerbe() ? "zzgl. " : "inkl. ") + satzText() + " % MwSt.";
  }
  // Nur Anzeige aktualisieren, ohne Ereignis (Seiten rufen das in ihrem eigenen Neuzeichnen auf)
  function preiseSetzen() {
    var akt = window.DGR && DGR.aktionAktiv(DG.aktion);
    $$(".pr[data-netto]").forEach(function (e) {
      var n = parseFloat(e.dataset.netto);
      if (isNaN(n)) return;
      var ab = e.dataset.ab ? "ab " : "";
      // Preisaktion (Black Week): bisheriger Preis durchgestrichen = niedrigster Preis der letzten 30 Tage (§ 11 PAngV)
      var neu = e.dataset.neu ? parseFloat(e.dataset.neu) : (akt ? DGR.stueckpreis(akt, n) : n);
      if (akt && neu < n) e.innerHTML = '<s class="vorher" title="Niedrigster Preis der letzten 30 Tage">' + esc(preisText(n)) + '</s> <span class="neu">' + esc(ab + preisText(neu)) + '</span> <span class="minus">−' + akt.prozent + ' %</span>';
      else e.textContent = ab + preisText(n);
    });
    $$(".aktion-hinweis").forEach(function (e) {
      e.hidden = !akt;
      if (akt) e.innerHTML = '<span class="a1">' + esc(akt.name + ": " + akt.prozent + " % auf alles, ohne Code, bis " + (akt.bis_text || new Date(akt.bis).toLocaleString("de-DE")) + ".") + '</span> <span class="a2">Nicht mit Gutscheinen kombinierbar. Durchgestrichen: niedrigster Preis der letzten 30 Tage.</span>';
    });
    $$(".steuer").forEach(function (e) { e.textContent = steuerText() + (landCode === "DE" ? (e.dataset.zusatz || "") : ", zzgl. Versand"); });
    $$(".seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.modus === modus)); });
    $$(".nur-gewerbe").forEach(function (e) { e.hidden = !istGewerbe(); });
    $$(".nur-privat").forEach(function (e) { e.hidden = istGewerbe(); });
    var f = $(".fuss .steuerhinweis");
    var ausland = landCode !== "DE" ? " Preise für Lieferung nach " + DGR.landVon(VERSAND, landCode).n + ", Versandkosten siehe Warenkorb." : " Versandkostenfrei innerhalb Deutschlands.";
    if (f) f.textContent = (istGewerbe() ? "Preisanzeige für Gewerbekunden: alle Preise netto " + steuerText() + "." : "Alle Preise " + steuerText() + ".") + ausland;
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

  /* ---------- Einwilligung (Cookie-Banner, Lenn 2026-11-20) ----------
     Notwendig (Warenkorb, Anmeldung, Preisanzeige) braucht keine Einwilligung. Komfort = Verlauf für „Für Sie ausgewählt“.
     Marketing = Google Ads, nur wenn in site.json eine google_ads_id steht; Google lädt erst nach Zustimmung (kein Laden vorher). */
  var EINW_VERSION = 1;
  function einwilligung() { var e = lies("dg-einwilligung", null); return e && e.v === EINW_VERSION ? e : null; }
  function darf(k) { var e = einwilligung(); return !!(e && e[k]); }
  function einwilligungSetzen(komfort, marketing) {
    var vorher = einwilligung();
    schreib("dg-einwilligung", { v: EINW_VERSION, komfort: !!komfort, marketing: !!(marketing && DG.ads), zeit: new Date().toISOString() });
    if (!komfort) { schreib("dg-gesehen", null); schreib("dg-gekauft", null); }
    if (vorher && vorher.marketing && !marketing) {
      // Google-Cookies löschen und neu laden, damit nichts mehr läuft
      document.cookie.split(";").forEach(function (c) {
        var n = c.split("=")[0].trim();
        if (/^(_gcl|_ga|_gid|_gac)/.test(n)) ["", "; domain=" + location.hostname, "; domain=." + location.hostname.replace(/^www\./, "")].forEach(function (dm) {
          document.cookie = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + dm;
        });
      });
      location.reload(); return;
    }
    googleLaden();
    if ($("#auswahl")) startseiteAuswahl();
  }
  function googleLaden() {
    if (!DG.ads || !darf("marketing") || window.gtag) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag("consent", "default", { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "denied" });
    gtag("js", new Date()); gtag("config", DG.ads);
    var s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(DG.ads);
    document.head.appendChild(s);
  }
  function banner(mitEinstellungen) {
    var alt = $(".einw"); if (alt) alt.remove();
    var e = einwilligung() || {};
    var box = document.createElement("div");
    box.className = "einw"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Cookie-Einstellungen");
    function zeile(name, titel, text, an, fest) {
      return '<label class="einw-zeile"><input type="checkbox" name="' + name + '"' + (an ? " checked" : "") + (fest ? " disabled" : "") + '><span><b>' + titel + "</b>" + text + "</span></label>";
    }
    box.innerHTML = '<div class="einw-in"><p><b>Cookies und Speicher</b> Wir speichern in Ihrem Browser nur, was der Shop braucht (Warenkorb, Anmeldung, Preisanzeige). ' +
      "Mit Ihrer Zustimmung merken wir uns zusätzlich, welche Produkte Sie angesehen und gekauft haben, um sie Ihnen auf der Startseite wieder zu zeigen" +
      (DG.ads ? ", und messen mit Google Ads, ob Käufe über unsere Anzeigen kamen" : "") + '. Sie können das jederzeit unter „Cookie-Einstellungen“ unten auf der Seite ändern. ' +
      '<a href="' + B + '/datenschutz/">Datenschutz</a></p>' +
      '<div class="einw-wahl"' + (mitEinstellungen ? "" : " hidden") + ">" +
      zeile("noetig", "Notwendig", "Warenkorb, Anmeldung, Privat/Gewerbe, Lieferland. Immer aktiv.", true, true) +
      zeile("komfort", "Komfort", "Zuletzt angesehene und gekaufte Produkte auf der Startseite. Bleibt nur in Ihrem Browser.", e.komfort) +
      (DG.ads ? zeile("marketing", "Marketing", "Google Ads Conversion-Messung (Google Ireland Ltd.; Übermittlung in die USA möglich).", e.marketing) : "") +
      "</div>" +
      '<div class="einw-knoepfe"><button type="button" class="btn sec" data-a="alle">Alle akzeptieren</button>' +
      '<button type="button" class="btn sec" data-a="noetig">Nur notwendige</button>' +
      '<button type="button" class="btn sec" data-a="' + (mitEinstellungen ? "speichern" : "einst") + '">' + (mitEinstellungen ? "Auswahl speichern" : "Einstellungen") + "</button></div></div>";
    document.body.appendChild(box);
    box.addEventListener("click", function (ev) {
      var k = ev.target.closest("button[data-a]"); if (!k) return;
      var a = k.dataset.a;
      if (a === "einst") { $(".einw-wahl", box).hidden = false; k.dataset.a = "speichern"; k.textContent = "Auswahl speichern"; return; }
      var f = function (n) { var i = $('input[name="' + n + '"]', box); return !!(i && i.checked); };
      box.remove();
      if (a === "alle") einwilligungSetzen(true, true);
      else if (a === "noetig") einwilligungSetzen(false, false);
      else einwilligungSetzen(f("komfort"), f("marketing"));
    });
  }
  document.addEventListener("click", function (ev) {
    if (ev.target.closest(".einw-oeffnen")) { ev.preventDefault(); banner(true); }
  });

  // Verlauf nur im Browser (localStorage), geht nie an den Server; nur mit Einwilligung „Komfort“.
  function verlaufMerken(schluessel, slug) {
    if (!darf("komfort")) return;
    var l = lies(schluessel, []).filter(function (s) { return s !== slug; });
    l.unshift(slug); schreib(schluessel, l.slice(0, 30));
  }
  // Startseite „Ausgewählte Produkte“ (Lenn 2026-11-20): zuerst Gekauftes, dann zuletzt Angesehenes, Rest zufällig
  function startseiteAuswahl() {
    var sek = $("#auswahl"); if (!sek) return;
    var raster = $(".raster", sek), titel = $("h2", sek), ANZAHL = 10;
    index().then(function (ix) {
      var nachSlug = {};
      ix.produkte.forEach(function (p) { if (p.p && p.b) nachSlug[p.s] = p; });
      var eigene = [], drin = {};
      (darf("komfort") ? lies("dg-gekauft", []).concat(lies("dg-gesehen", [])) : []).forEach(function (s) {
        if (nachSlug[s] && !drin[s] && eigene.length < ANZAHL) { eigene.push(nachSlug[s]); drin[s] = 1; }
      });
      var rest = Object.keys(nachSlug).filter(function (s) { return !drin[s]; });
      for (var i = rest.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
      var liste = eigene.concat(rest.slice(0, ANZAHL - eigene.length).map(function (s) { return nachSlug[s]; }));
      raster.innerHTML = liste.map(function (p) {
        var breiten = p.skus && p.skus.length > 1 && /hauben/i.test(p.u) ? " · " + p.skus.length + " Breiten" : "";
        return '<a class="p" href="' + B + "/produkt/" + esc(p.s) + '/"><div class="ph"><img src="' + esc(p.b) + '" alt="" loading="lazy"></div>' +
          '<p class="n">' + esc(p.n) + '</p><span class="t">' + esc(p.h || "") + breiten + "</span>" +
          '<div><span class="pr" data-netto="' + p.p.toFixed(2) + '"' + (p.ab ? " data-ab=1" : "") + '></span><span class="steuer"></span></div></a>';
      }).join("");
      if (eigene.length) {
        titel.innerHTML = 'Für Sie ausgewählt <button type="button" class="verlauf-weg klein">Verlauf löschen</button>';
        $(".verlauf-weg", titel).addEventListener("click", function () {
          var e = einwilligung() || {};
          einwilligungSetzen(false, !!e.marketing);
        });
      } else titel.textContent = "Ausgewählte Produkte";
      preiseSetzen();
    }).catch(function () { /* stehende Auswahl bleibt */ });
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
    $$(".konto-link").forEach(function (a) { a.innerHTML = s ? "Mein Konto" : 'Anmelden<span class="lang"> | Konto anlegen</span>'; });
  }

  /* ---------- Produktseite ---------- */
  function produktseite() {
    var art = $(".produkt"); if (!art) return;
    var m = location.pathname.match(/\/produkt\/([^/]+)\/?$/);
    if (m) verlaufMerken("dg-gesehen", decodeURIComponent(m[1]));
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
    if (wahl) {
      // Link aus Google Shopping: ?v=SKU wählt die Variante vor
      var vor = new URLSearchParams(location.search).get("v");
      if (vor) for (var i = 0; i < wahl.options.length; i++) if (wahl.options[i].value === vor) wahl.selectedIndex = i;
      wahl.addEventListener("change", zeigen); zeigen();
    }
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
    var liste = $(".liste", box), form = $("form", box), hinweis = $(".bew-hinweis", box);
    if (!DG.api) { liste.innerHTML = '<p class="klein">Bewertungen werden freigeschaltet, sobald der Shop-Server läuft.</p>'; return; }
    // Das Formular erscheint nur, wenn der Server bestätigt: angemeldet, gekauft und bezahlt, noch nicht bewertet
    var HINWEIS = {
      anmelden: '<a href="' + B + '/konto/">Melden Sie sich an</a>, um ein gekauftes Produkt zu bewerten.',
      nicht_gekauft: "Bewerten können Sie dieses Produkt, sobald Sie es bei uns gekauft und bezahlt haben.",
      schon_bewertet: "Sie haben dieses Produkt bereits bewertet. Vielen Dank!",
    };
    function laden() {
      return api("/bewertungen?produkt=" + encodeURIComponent(slug)).then(function (d) {
        $(".schnitt", box).textContent = d.anzahl ? sterne(d.schnitt) + " " + d.schnitt.toFixed(1).replace(".", ",") + " von 5 (" + d.anzahl + ")" : "";
        var vt = d.verteilung || {}, balken = d.anzahl ? '<div class="verteilung">' + [5, 4, 3, 2, 1].map(function (k) {
          var n = vt[k] || 0;
          return '<div><span>' + k + ' ★</span><i><b style="width:' + Math.round(n / d.anzahl * 100) + '%"></b></i><span>' + n + (n === 1 ? " Person" : " Personen") + "</span></div>";
        }).join("") + "</div>" : "";
        liste.innerHTML = balken + (d.liste.length ? d.liste.map(function (b) {
          return '<div class="bewertung"><span class="sterne">' + sterne(b.sterne) + "</span>" + (b.titel ? " <b>" + esc(b.titel) + "</b>" : "") +
            (b.verifiziert ? ' <span class="klein">· Verifizierter Kauf</span>' : "") + (b.belohnt ? ' <span class="klein">· mit 5-%-Gutschein bedankt</span>' : "") +
            (b.text ? "<p>" + esc(b.text) + "</p>" : "<br>") + '<span class="klein">' + esc(b.name) + " am " + new Date(b.datum).toLocaleDateString("de-DE") + "</span></div>";
        }).join("") : d.anzahl ? "" : '<p class="klein">Noch keine Bewertungen. Seien Sie die oder der Erste!</p>');
        form.hidden = d.darf !== "ja";
        hinweis.innerHTML = HINWEIS[d.darf] || "";
        // Ohne Bewertungen bleibt der Bereich unsichtbar, außer der Kunde darf gerade bewerten
        var vorher = box.hidden;
        box.hidden = !(d.anzahl || d.darf === "ja");
        if (vorher && !box.hidden && location.hash === "#bewertungen") box.scrollIntoView();
      }).catch(function () { liste.innerHTML = '<p class="klein">Bewertungen konnten nicht geladen werden.</p>'; });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(form), st = $(".status", form);
      api("/bewertungen", { produkt: slug, sterne: +f.get("sterne"), titel: f.get("titel"), text: f.get("text") })
        .then(function () { form.reset(); return laden(); })
        .then(function () { hinweis.textContent = "Danke! Ihre Bewertung ist jetzt sichtbar. Ihren persönlichen 5-%-Gutscheincode haben wir Ihnen per E-Mail geschickt."; })
        .catch(function (err) { st.className = "status meldung fehler"; st.textContent = err.message; });
    });
    laden();
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
  var gutschein = null;  // { code, prozent } nach erfolgreicher Prüfung
  var ustidOk = false;   // Unternehmer mit von der EU bestätigter USt-IdNr. (steuerfreie innergemeinschaftliche Lieferung)
  function r2(x) { return Math.round(x * 100) / 100; }
  function rechnen(ix) {
    var pos = korb().map(function (p) { var a = ix.artikel[p.sku]; return a && a.p ? { sku: p.sku, menge: p.menge, a: a } : null; }).filter(Boolean);
    var g = DGR.gesamtRechnen(VERSAND, landCode, pos, gutschein ? gutschein.prozent : 0, istGewerbe() && ustidOk, DG.aktion);
    g.pos = pos;
    return g;
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
            '<div><span class="pr" data-netto="' + (p.a.p * p.menge).toFixed(2) + '" data-neu="' + (DGR.stueckpreis(DG.aktion, p.a.p) * p.menge).toFixed(2) + '"></span></div></div>';
        }).join("");
        var g = istGewerbe();
        var faktor = g ? 1 : 1 + r.satz / 100;
        var st = String(r.satz).replace(".", ",");
        var de = r.land.c === "DE";
        var versandText = de ? "Versand (Deutschland)" : "Versand nach " + esc(r.land.n);
        var hinweis = { IG: "Steuerfreie innergemeinschaftliche Lieferung: Ihre USt-IdNr. wurde bei der EU bestätigt.",
          AUSFUHR: "Steuerfreie Ausfuhr. Einfuhrumsatzsteuer, Zoll und Gebühren in " + esc(r.land.n) + " zahlen Sie bei der Zustellung.",
          OSS: "Mit der Umsatzsteuer des Lieferlandes (" + st + " %)." }[r.art] || "";
        sum.innerHTML = "<div><span>Warenwert " + (g || r.satz === 0 ? "netto" : "inkl. MwSt.") + "</span><b>" + eur(r2(r.warenwert * faktor)) + "</b></div>" +
          (gutschein ? "<div><span>Gutschein " + esc(gutschein.code) + " (" + gutschein.prozent + " %)</span><b>−" + eur(r2(r.rabatt * faktor)) + "</b></div>" : "") +
          "<div><span>" + versandText + "</span><b>" + (r.versand ? eur(r2(r.versand * faktor)) : "kostenlos") + "</b></div>" +
          (r.satz === 0 ? "<div><span>Umsatzsteuer</span><b>0,00 €</b></div>" :
            g ? "<div><span>zzgl. " + st + " % MwSt.</span><b>" + eur(r.mwst) + "</b></div>" : "<div><span>darin " + st + " % MwSt.</span><b>" + eur(r.mwst) + "</b></div>") +
          '<div class="gesamt"><span>Gesamtbetrag</span><span>' + eur(r.brutto) + "</span></div>" +
          (hinweis ? '<p class="klein">' + hinweis + "</p>" : "") +
          (r.gesperrt.length ? '<p class="meldung fehler">' + esc(r.gesperrt[0].a.n) + " können wir nach " + esc(r.land.n) + " noch nicht liefern.</p>" : "") +
          '<p class="klein">' + (de ? "Speditionsware wird bis Bordsteinkante geliefert." : "Fester Versandpreis je Bestellung. Bei sehr großen Mengen oder schweren und sperrigen Geräten können höhere Versandkosten anfallen. Dann melden wir uns vor dem Versand mit dem Mehrbetrag und einer gesonderten Zahlungsaufforderung; sind Sie nicht einverstanden, können Sie kostenlos stornieren. <a href=\"" + B + "/versand/\">Alle Versandpreise</a>") + "</p>";
        preiseSetzen();
        if (info) zahlungZeigen();
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

      function bestelldaten() {
        var f = new FormData(form), r = rechnen(ix);
        return {
          modus: modus, positionen: r.pos.map(function (p) { return { sku: p.sku, menge: p.menge }; }),
          kunde: { land: landCode, name: f.get("name"), firma: f.get("firma") || "", ustid: f.get("ustid") || "", strasse: f.get("strasse"), plz: f.get("plz"), ort: f.get("ort"),
                   email: f.get("email"), telefon: f.get("telefon") || "", hinweis: f.get("hinweis") || "",
                   liefer: f.get("gleich") ? null : { firma: f.get("l_firma") || "", name: f.get("l_name"), strasse: f.get("l_strasse"), plz: f.get("l_plz"), ort: f.get("l_ort") } },
          zahlart: f.get("zahlart"), agb: !!f.get("agb"), gesamt_brutto: r.brutto, gutschein: gutschein ? gutschein.code : "",
          konto_anlegen: !!f.get("konto_anlegen"), passwort: f.get("passwort") || "", bewertungsmail: !!f.get("bewertungsmail"),
        };
      }
      function gewerbeFehlt() {
        if (istGewerbe() && !form.elements.gewerbe_bestaetigt.checked) {
          var st = $(".status", form); st.className = "status meldung fehler"; st.textContent = "Bitte bestätigen Sie, dass Sie als Unternehmer bestellen, oder wechseln Sie oben auf „Privat“.";
          return true;
        }
        return false;
      }
      function fertig(d, email) {
        if (d.sitzung) schreib("dg-sitzung", d.sitzung);
        index().then(function (ix) {
          korb().forEach(function (p) { var a = ix.artikel[p.sku]; if (a) verlaufMerken("dg-gekauft", a.s); });
        }).catch(function () {}).then(function () { korbSpeichern([]); });
        location.href = B + "/bestellung/?nr=" + encodeURIComponent(d.nr) + "&email=" + encodeURIComponent(d.email || email) + "&neu=1";
      }

      // Kreditkarte und PayPal: wie bei beinundfuss.de erscheinen die PayPal-Knöpfe statt „Zahlungspflichtig bestellen“.
      // Bestellt und gespeichert wird erst, wenn die Zahlung durch ist.
      var info = { aktiv: false }, quelle = null, ppSkript = null;
      function paypalLaden() {
        if (!ppSkript) ppSkript = new Promise(function (ok, nein) {
          var sk = document.createElement("script");
          sk.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(info.client_id) +
            "&currency=EUR&intent=capture&components=buttons&locale=de_DE&enable-funding=card&disable-funding=paylater,sepa";
          sk.onload = function () { ok(window.paypal); };
          sk.onerror = function () { ppSkript = null; nein(new Error("PayPal konnte nicht geladen werden.")); };
          document.head.appendChild(sk);
        });
        return ppSkript;
      }
      function zahlungZeigen() {
        var art = (form.querySelector("input[name=zahlart]:checked") || {}).value;
        var sofort = info.aktiv && (art === "Kreditkarte" || art === "PayPal");
        var knopf = $("button[type=submit]", form), box = $("#sofort"), feld = $("#paypal-knoepfe");
        knopf.hidden = sofort; box.hidden = !sofort;
        if (!sofort) return;
        $(".sofort-summe", box).innerHTML = "Jetzt zu zahlen: <b>" + eur(rechnen(ix).brutto) + "</b>" + (rechnen(ix).satz ? " inkl. MwSt." : "") + (rechnen(ix).versand ? " inkl. Versand." : ", Versand kostenlos.") + "<br>Mit der Zahlung ist Ihre Bestellung verbindlich.";
        var neu = art === "Kreditkarte" ? "card" : "paypal";
        if (quelle === neu) return;
        quelle = neu; feld.textContent = "PayPal wird geladen …";
        paypalLaden().then(function (pp) {
          if (quelle !== neu) return;
          feld.textContent = "";
          pp.Buttons({
            fundingSource: neu === "card" ? pp.FUNDING.CARD : pp.FUNDING.PAYPAL,
            style: { layout: "vertical", label: "pay" },
            onClick: function (_, actions) {
              if (!form.reportValidity() || gewerbeFehlt()) return actions.reject();
              $(".status", form).textContent = "";
              return actions.resolve();
            },
            createOrder: function () { return api("/bezahlen/start", bestelldaten()).then(function (x) { return x.id; }); },
            onApprove: function (d) {
              var st = $(".status", form), x = bestelldaten();
              st.className = "status meldung"; st.textContent = "Zahlung wird abgeschlossen …";
              x.paypal_id = d.orderID;
              return api("/bezahlen/abschluss", x).then(function (r) { fertig(r, x.kunde.email); })
                .catch(function (err) { st.className = "status meldung fehler"; st.textContent = err.message; });
            },
            onCancel: function () { var st = $(".status", form); st.className = "status meldung"; st.textContent = "Zahlung abgebrochen. Es wurde nichts abgebucht."; },
            onError: function (err) {
              var st = $(".status", form); st.className = "status meldung fehler";
              st.textContent = (err && err.message && !/^Fehler$/.test(err.message) ? err.message : "Die Zahlung hat nicht geklappt.") + " Sie können auch „Überweisung (Vorkasse)“ wählen.";
            },
          }).render(feld);
        }).catch(function (err) { feld.textContent = err.message + " Bitte „Überweisung (Vorkasse)“ wählen."; });
      }
      form.addEventListener("change", function (e) { if (e.target.name === "zahlart") zahlungZeigen(); });
      document.addEventListener("dg:modus", zahlungZeigen);
      if (DG.api) api("/bezahlen").then(function (x) {
        info = x || { aktiv: false };
        form.querySelectorAll(".sofort-art").forEach(function (l) { l.hidden = !info.aktiv; });
        zahlungZeigen();
      }).catch(function () {});

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var st = $(".status", form), r = rechnen(ix);
        if (gewerbeFehlt()) return;
        var daten = bestelldaten();
        var knopf = $("button[type=submit]", form);
        if (!DG.api) {
          // Übergangslösung ohne Server: vorbereitete E-Mail
          var zeilen = r.pos.map(function (p) { return p.menge + " × " + p.a.n + " (Art.-Nr. " + p.sku + ") je " + eur(p.a.p) + " netto"; });
          var text = "Bestellung (" + (istGewerbe() ? "Gewerbe" : "Privat") + ")\n\n" + zeilen.join("\n") + "\n\nSumme: " + eur(r.netto) + " netto, " + eur(r.brutto) + " brutto\nZahlart: " + daten.zahlart +
            "\n\n" + [daten.kunde.firma, daten.kunde.name, daten.kunde.strasse, daten.kunde.plz + " " + daten.kunde.ort, daten.kunde.email, daten.kunde.telefon, daten.kunde.ustid, daten.kunde.hinweis].filter(Boolean).join("\n") +
            (daten.kunde.liefer ? "\n\nLieferadresse:\n" + [daten.kunde.liefer.firma, daten.kunde.liefer.name, daten.kunde.liefer.strasse, daten.kunde.liefer.plz + " " + daten.kunde.liefer.ort].filter(Boolean).join("\n") : "");
          location.href = "mailto:" + DG.mail + "?subject=" + encodeURIComponent("Bestellung Domo Gastro") + "&body=" + encodeURIComponent(text);
          return;
        }
        knopf.disabled = true; st.className = "status meldung"; st.textContent = "Bestellung wird übermittelt …";
        api("/bestellung", daten).then(function (d) { fertig(d, daten.kunde.email); }).catch(function (err) { knopf.disabled = false; st.className = "status meldung fehler"; st.textContent = err.message; });
      });
      // Gutscheincode prüfen und Rabatt in der Summe zeigen
      var gs = $("#gutschein-status");
      $("#gutschein-los").addEventListener("click", function () {
        var code = form.elements.gutschein.value.trim();
        if (!code) { gutschein = null; gs.textContent = ""; zeichnen(); return; }
        api("/gutschein/pruefen", { code: code }).then(function (d) {
          gutschein = d; gs.className = "klein ok"; gs.textContent = "Gutschein eingelöst: " + d.prozent + " % Rabatt auf den Warenwert."; zeichnen();
        }).catch(function (err) { gutschein = null; gs.className = "klein fehler"; gs.textContent = err.message; zeichnen(); });
      });
      form.elements.gutschein.addEventListener("input", function () { if (gutschein) { gutschein = null; gs.textContent = ""; zeichnen(); } });
      // Lieferland: bestimmt Versand, Steuer und PLZ-Format; gemerkt für die Preisanzeige auf allen Seiten
      var landWahl = form.elements.land;
      landWahl.innerHTML = VERSAND.laender.map(function (l) { return '<option value="' + l.c + '"' + (l.c === landCode ? " selected" : "") + ">" + esc(l.n) + "</option>"; }).join("");
      var gl = form.elements.gleich;
      function plzMuster() { return landCode === "DE" ? "[0-9]{5}" : "[A-Za-z0-9][A-Za-z0-9 \\-]{2,9}"; }
      function lieferUmschalten() {
        var eigen = !gl.checked;
        $("#liefer").hidden = !eigen;
        ["l_name", "l_strasse", "l_plz", "l_ort"].forEach(function (n) { form.elements[n].required = eigen; });
        form.elements.l_plz.setAttribute("pattern", plzMuster());
        if (eigen) form.elements.plz.removeAttribute("pattern"); else form.elements.plz.setAttribute("pattern", plzMuster());
        form.elements.plz.inputMode = form.elements.l_plz.inputMode = landCode === "DE" ? "numeric" : "text";
      }
      gl.addEventListener("change", lieferUmschalten);
      // USt-IdNr. (Gewerbe, EU-Ausland): bei der EU prüfen, dann ohne MwSt. rechnen
      var us = $("#ustid-status");
      function ustidPruefen() {
        var l = DGR.landVon(VERSAND, landCode), wert = form.elements.ustid.value.trim();
        ustidOk = false; us.textContent = "";
        if (!istGewerbe() || !wert || !l.eu || l.c === "DE" || !DG.api) { zeichnen(); return; }
        us.className = "klein"; us.textContent = "USt-IdNr. wird bei der EU geprüft …";
        api("/ustid/pruefen", { ustid: wert, land: l.c }).then(function (d) {
          ustidOk = !!d.gueltig;
          us.className = "klein " + (d.gueltig ? "ok" : "fehler");
          us.textContent = d.gueltig ? "USt-IdNr. bestätigt" + (d.name && d.name !== "---" ? " (" + d.name + ")" : "") + ": Lieferung ohne MwSt. (innergemeinschaftlich)." : d.fehler;
          zeichnen();
        }).catch(function (err) { us.className = "klein fehler"; us.textContent = err.message; zeichnen(); });
      }
      form.elements.ustid.addEventListener("change", ustidPruefen);
      // Hinweis für Unternehmen im EU-Ausland, die noch im Privat-Modus sind: USt-IdNr. gibt es nur unter „Gewerbe“
      function auslandHinweise() {
        var l = DGR.landVon(VERSAND, landCode);
        $("#land-hinweis").hidden = landCode === "DE";
        $("#gewerbe-tipp").hidden = !(l && l.eu && l.c !== "DE" && !istGewerbe());
      }
      $("#gewerbe-wechsel").addEventListener("click", function () {
        var k = $('.seg button[data-modus="gewerbe"]');
        if (k) k.click();
        setTimeout(function () { if (form.elements.firma) form.elements.firma.focus(); }, 50);
      });
      landWahl.addEventListener("change", function () {
        landCode = landWahl.value; schreib("dg-land", landCode);
        auslandHinweise();
        lieferUmschalten(); preiseSetzen(); ustidPruefen();
      });
      document.addEventListener("dg:modus", function () { auslandHinweise(); if (form.elements.ustid.value) ustidPruefen(); });
      auslandHinweise();
      lieferUmschalten();
      var ka = form.elements.konto_anlegen;
      // Bitte um Bewertung nur mit Konto anbieten
      function bewMail() { $("#bew-mail").hidden = !(s || (ka && ka.checked)); if ($("#bew-mail").hidden) form.elements.bewertungsmail.checked = false; }
      if (ka) ka.addEventListener("change", function () { $("#pw-feld").hidden = !ka.checked; form.elements.passwort.required = ka.checked; bewMail(); });
      bewMail();
      if (s && ka) ka.closest("label").hidden = true;
    });
  }

  /* ---------- Bestellstatus (Gast und Konto) ---------- */
  // Drei Schritte; „in Bearbeitung“ zählt als bezahlt, „zugestellt“ als versendet (Zustellung zeigt die Sendungsverfolgung)
  var SCHRITTE = [["eingegangen", "Eingegangen"], ["bezahlt", "Bezahlt"], ["versendet", "Versendet"]];
  var GLEICH = { zahlung_offen: "eingegangen", in_bearbeitung: "bezahlt", zugestellt: "versendet" };
  // Versand mit GLS (Lenn 2026-11-19): Sendungsnummer wird zum Link auf die GLS-Sendungsverfolgung
  function verfolgen(sendung) {
    return /^https?:\/\//.test(sendung) ? sendung : "https://gls-group.com/DE/de/paketverfolgung?match=" + encodeURIComponent(sendung);
  }
  function statusHtml(b) {
    if (b.status === "storniert") return '<div class="bestellstatus"><span class="an">Storniert</span></div>';
    var i = SCHRITTE.map(function (x) { return x[0]; }).indexOf(GLEICH[b.status] || b.status);
    return '<div class="bestellstatus">' + SCHRITTE.map(function (x, j) { return '<span class="' + (j <= i ? "an" : "") + '">' + x[1] + "</span>"; }).join("") + "</div>";
  }
  var WSTAND = { eingegangen: "Widerruf eingegangen", zurueck: "Ware ist bei uns, Erstattung folgt", erstattet: "erstattet" };
  function widerrufHtml(b) {
    return (b.widerrufe || []).map(function (w) {
      return '<p class="klein">Widerruf vom ' + new Date(w.datum).toLocaleDateString("de-DE") + ": " + w.positionen.map(function (p) { return p.menge + " × " + esc(p.name); }).join(", ") +
        " · <b>" + WSTAND[w.status] + (w.status === "erstattet" ? " (" + eur(w.betrag) + ")" : "") + "</b></p>";
    }).join("");
  }
  function bestellHtml(b, email) {
    return '<div class="kasten" style="margin-bottom:14px"><b>Bestellung ' + esc(b.nr) + "</b> vom " + new Date(b.datum).toLocaleDateString("de-DE") + statusHtml(b) +
      "<ul>" + b.positionen.map(function (p) { return "<li>" + p.menge + " × " + esc(p.name) + " (" + esc(p.sku) + ")</li>"; }).join("") + "</ul>" +
      "<p>Gesamt: <b>" + eur(b.brutto) + "</b> inkl. MwSt. · " + esc(b.zahlart) + (b.sendung ? " · Sendung " + (/^https?:\/\//.test(b.sendung) ? "" : esc(b.sendung) + " ") + '<a href="' + esc(verfolgen(b.sendung)) + '" target="_blank" rel="noopener">bei GLS verfolgen</a>' : "") + "</p>" +
      widerrufHtml(b) +
      (b.status !== "storniert" ? '<p class="klein"><a href="' + B + "/widerrufen/?nr=" + encodeURIComponent(b.nr) + (email ? "&email=" + encodeURIComponent(email) : "") + '">Vertrag widerrufen</a></p>' : "") + "</div>";
  }
  function bestellseite() {
    var ziel = $("#bestell-ergebnis"); if (!ziel) return;
    var form = $("#bestell-suche"), q = new URLSearchParams(location.search);
    if (!DG.api) { offlineHinweis(ziel); form.hidden = true; return; }
    function laden(nr, email) {
      api("/bestellung/status", { nr: nr, email: email }).then(function (b) {
        if (q.get("neu") && window.gtag && DG.ads && DG.adsKauf) {
          var gemeldet = false; try { gemeldet = sessionStorage.getItem("dg-conv-" + b.nr); sessionStorage.setItem("dg-conv-" + b.nr, "1"); } catch (e) {}
          if (!gemeldet) gtag("event", "conversion", { send_to: DG.ads + "/" + DG.adsKauf, value: b.netto || 0, currency: "EUR", transaction_id: b.nr });
        }
        ziel.innerHTML = (q.get("neu") ? '<p class="meldung ok">Vielen Dank! Ihre Bestellung ist eingegangen. Eine Bestätigung kommt per E-Mail.' +
          (b.zahlart === "Vorkasse" ? " Die Bankverbindung kommt in einer eigenen E-Mail; Verwendungszweck ist Ihre Bestellnummer." : " Ihre Zahlung ist eingegangen, wir versenden jetzt.") + "</p>" : "") + bestellHtml(b, email);
      }).catch(function (err) { ziel.innerHTML = '<p class="meldung fehler">' + esc(err.message) + "</p>"; });
    }
    if (q.get("nr")) { form.elements.nr.value = q.get("nr"); form.elements.email.value = q.get("email") || ""; laden(q.get("nr"), q.get("email")); }
    form.addEventListener("submit", function (e) { e.preventDefault(); laden(form.elements.nr.value.trim(), form.elements.email.value.trim()); });
  }

  /* ---------- Widerruf (Widerrufsbutton) ---------- */
  function widerrufseite() {
    var ziel = $("#widerruf-ergebnis"); if (!ziel) return;
    var form = $("#widerruf-suche"), q = new URLSearchParams(location.search);
    if (!DG.api) { ziel.innerHTML = '<p class="meldung">Bitte widerrufen Sie per E-Mail an ' + esc(DG.mail || "") + '.</p>'; form.hidden = true; return; }
    function laden(nr, email) {
      ziel.innerHTML = "";
      api("/bestellung/status", { nr: nr, email: email }).then(function (b) {
        if (b.status === "storniert") { ziel.innerHTML = '<p class="meldung">Diese Bestellung ist bereits storniert.</p>'; return; }
        var schon = {};
        (b.widerrufe || []).forEach(function (w) { w.positionen.forEach(function (p) { schon[p.sku] = (schon[p.sku] || 0) + p.menge; }); });
        var zeilen = b.positionen.map(function (p) {
          var rest = p.menge - (schon[p.sku] || 0);
          return '<div class="w-zeile"><label class="check"><input type="checkbox" name="sku" value="' + esc(p.sku) + '"' + (rest ? " checked" : " disabled") + "> " + esc(p.name) + ' <span class="klein">(' + esc(p.sku) + ")</span></label>" +
            (rest ? (rest > 1 ? '<label class="klein">Stück <input type="number" name="m-' + esc(p.sku) + '" min="1" max="' + rest + '" value="' + rest + '"></label>' : '<input type="hidden" name="m-' + esc(p.sku) + '" value="1">') : '<span class="klein">bereits widerrufen</span>') + "</div>";
        }).join("");
        ziel.innerHTML = widerrufHtml(b) + '<form id="widerruf-form" class="kasten"><p><b>Bestellung ' + esc(b.nr) + "</b> vom " + new Date(b.datum).toLocaleDateString("de-DE") + ". Welche Artikel möchten Sie widerrufen?</p>" + zeilen +
          '<label>Anmerkung (freiwillig) <textarea name="grund" rows="2" maxlength="1000"></textarea></label>' +
          '<button class="btn pri">Widerruf bestätigen</button><p class="status"></p></form>';
        var f = $("#widerruf-form");
        f.addEventListener("submit", function (e) {
          e.preventDefault();
          var pos = $$("input[name=sku]:checked", f).map(function (c) { return { sku: c.value, menge: f.elements["m-" + c.value].value }; });
          var st = $(".status", f);
          if (!pos.length) { st.className = "status meldung fehler"; st.textContent = "Bitte wählen Sie mindestens einen Artikel."; return; }
          var k = $("button", f); k.disabled = true;
          api("/widerruf", { nr: b.nr, email: email, positionen: pos, grund: f.elements.grund.value }).then(function (d) {
            ziel.innerHTML = '<p class="meldung ok">Ihr Widerruf ist am ' + new Date(d.datum).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" }) +
              " Uhr bei uns eingegangen. Die Eingangsbestätigung mit der Rücksendeadresse haben wir Ihnen per E-Mail geschickt.</p>";
          }).catch(function (err) { k.disabled = false; st.className = "status meldung fehler"; st.textContent = err.message; });
        });
      }).catch(function (err) { ziel.innerHTML = '<p class="meldung fehler">' + esc(err.message) + "</p>"; });
    }
    if (q.get("nr")) { form.elements.nr.value = q.get("nr"); form.elements.email.value = q.get("email") || ""; if (q.get("email")) laden(q.get("nr"), q.get("email")); }
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
        $("#meine-bestellungen").innerHTML = d.bestellungen.length ? d.bestellungen.map(function (b) { return bestellHtml(b, k.email); }).join("") : '<p class="klein">Noch keine Bestellungen.</p>';
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


  /* ---------- KI-Berater „Frag Domo“ (Server: POST /beraten) ---------- */
  function berater() {
    if (!DG.api || /\/verwaltung\//.test(location.pathname)) return;
    // Knopf nur zeigen, wenn der Server den Berater eingerichtet hat
    try { if (sessionStorage.getItem("dg-berater-aktiv")) return beraterZeigen(); } catch (e) {}
    api("/beraten").then(function (d) {
      if (!d.aktiv) return;
      try { sessionStorage.setItem("dg-berater-aktiv", "1"); } catch (e) {}
      beraterZeigen();
    }).catch(function () {});
  }
  function beraterZeigen() {
    // Texte, die den Berater erwähnen (z. B. Ratgeber), nur zeigen, wenn er wirklich läuft
    $$(".nur-berater").forEach(function (x) { x.hidden = false; });
    $$(".ohne-berater").forEach(function (x) { x.hidden = true; });
    var stand = (function () { try { return JSON.parse(sessionStorage.getItem("dg-berater")) || {}; } catch (e) { return {}; } })();
    var verlauf = stand.verlauf || [], karten = stand.karten || {}, offen = !!stand.offen;
    function merken() { try { sessionStorage.setItem("dg-berater", JSON.stringify({ verlauf: verlauf, karten: karten, offen: offen })); } catch (e) {} }
    var knopf = document.createElement("button");
    knopf.type = "button"; knopf.className = "ki-knopf"; knopf.setAttribute("aria-expanded", "false"); knopf.setAttribute("aria-controls", "ki-fenster");
    knopf.innerHTML = '<img src="' + B + '/bilder/domo-koch.webp" alt=""><span>Frag Domo</span>';
    var fenster = document.createElement("section");
    fenster.id = "ki-fenster"; fenster.className = "ki-fenster"; fenster.hidden = true; fenster.setAttribute("aria-label", "Produktberater");
    fenster.innerHTML = '<div class="ki-kopf"><img src="' + B + '/bilder/domo-koch.webp" alt=""><div><b>Domo</b><span>Ihr Produktberater</span></div>' +
      '<button type="button" class="ki-neu" title="Neues Gespräch">Neu</button><button type="button" class="ki-zu" aria-label="Schließen">×</button></div>' +
      '<div class="ki-verlauf" aria-live="polite"></div>' +
      '<form class="ki-form"><label class="sr" for="ki-text">Ihre Frage</label><textarea id="ki-text" rows="2" maxlength="1500" placeholder="Was suchen Sie? z. B. Fritteuse für einen Imbiss, 400 V"></textarea><button>Senden</button></form>' +
      '<p class="ki-hinweis">KI-Antworten können Fehler enthalten. Verbindlich sind die Produktseiten. Bitte keine persönlichen Daten eingeben. <a href="' + B + '/datenschutz/#ki-berater">Datenschutz</a></p>';
    document.body.appendChild(knopf); document.body.appendChild(fenster);
    var box = $(".ki-verlauf", fenster), form = $(".ki-form", fenster), feld = $("#ki-text"), senden = $("button", form);
    var VORSCHLAEGE = ["Ich eröffne einen Imbiss. Was brauche ich?", "Abzugshaube für 160 cm Gerätebreite", "Pizzaofen für zu Hause", "Etwas zum Warmhalten am Buffet"];

    function blase(rolle, text) {
      var b = document.createElement("div"); b.className = "ki-blase ki-" + rolle;
      String(text).split(/\n{2,}/).forEach(function (abs) { var p = document.createElement("p"); p.textContent = abs; b.appendChild(p); });
      box.appendChild(b); return b;
    }
    function produkte(slugs) {
      if (!slugs || !slugs.length) return;
      var reihe = document.createElement("div"); reihe.className = "ki-karten";
      box.appendChild(reihe);
      index().then(function (ix) {
        var nach = {}; ix.produkte.forEach(function (p) { nach[p.s] = p; });
        reihe.innerHTML = slugs.map(function (s) { return nach[s] ? karteHtml(nach[s]) : ""; }).join("");
        preiseSetzen(); unten();
      });
    }
    function unten() { box.scrollTop = box.scrollHeight; }
    function begruessen() {
      blase("berater", "Hallo, ich bin Domo. Sagen Sie mir, was Sie vorhaben oder was Sie suchen, dann suche ich passende Geräte aus dem Shop heraus.");
      var c = document.createElement("div"); c.className = "ki-chips";
      VORSCHLAEGE.forEach(function (t) {
        var x = document.createElement("button"); x.type = "button"; x.textContent = t;
        x.addEventListener("click", function () { fragen(t); }); c.appendChild(x);
      });
      box.appendChild(c);
    }
    function zeichnen() {
      box.innerHTML = "";
      if (!verlauf.length) begruessen();
      verlauf.forEach(function (m, i) { blase(m.rolle, m.text); produkte(karten[i]); });
      unten();
    }
    function fragen(text) {
      text = text.trim(); if (!text || senden.disabled) return;
      var c = $(".ki-chips", box); if (c) c.remove();
      verlauf.push({ rolle: "kunde", text: text }); merken();
      blase("kunde", text); feld.value = "";
      var warte = blase("berater", "Domo sucht passende Geräte …"); warte.classList.add("ki-warte");
      senden.disabled = true; unten();
      api("/beraten", { verlauf: verlauf }).then(function (d) {
        warte.remove();
        verlauf.push({ rolle: "berater", text: d.antwort });
        if (d.produkte && d.produkte.length) karten[verlauf.length - 1] = d.produkte;
        merken(); blase("berater", d.antwort); produkte(d.produkte);
      }).catch(function (err) {
        warte.remove(); verlauf.pop(); merken();
        var f = blase("berater", err.message === "offline" ? "Der Berater ist noch nicht freigeschaltet." : err.message); f.classList.add("ki-fehler");
        feld.value = text;
      }).then(function () { senden.disabled = false; unten(); feld.focus(); });
    }
    function auf(o) {
      offen = o; merken();
      fenster.hidden = !offen; knopf.hidden = offen; knopf.setAttribute("aria-expanded", String(offen));
      if (offen) { if (!box.childNodes.length) zeichnen(); feld.focus(); unten(); } else knopf.focus();
    }
    knopf.addEventListener("click", function () { auf(true); });
    $(".ki-zu", fenster).addEventListener("click", function () { auf(false); });
    $(".ki-neu", fenster).addEventListener("click", function () { verlauf = []; karten = {}; merken(); zeichnen(); feld.focus(); });
    fenster.addEventListener("keydown", function (e) { if (e.key === "Escape") auf(false); });
    form.addEventListener("submit", function (e) { e.preventDefault(); fragen(feld.value); });
    feld.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fragen(feld.value); } });
    if (offen) auf(true);
  }

  /* ---------- Start ---------- */
  document.addEventListener("click", function (e) {
    var s = e.target.closest(".seg button");
    if (s) { modus = s.dataset.modus; schreib("dg-modus", modus); preiseZeigen(); return; }
    var a = e.target.closest(".add[data-sku]");
    if (a) { e.preventDefault(); inDenKorb(a.dataset.sku, 1); }
  });
  korbZaehler(); kontoKopf(); preiseZeigen();
  if (!einwilligung()) banner(false); else googleLaden();
  produktseite(); startseiteAuswahl(); kategorieseite(); suchseite(); kasse(); bestellseite(); widerrufseite(); kontoseite(); berater();
})();
