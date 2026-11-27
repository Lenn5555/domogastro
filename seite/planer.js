/* Domo Gastro – Raumplaner (Lenn 2026-11-27).
   Raum anlegen, Geräte maßstabsgetreu von oben platzieren (mm), drehen, an Wände/Nachbarn einrasten,
   Überschneidungen rot, Liste mit Preisen, alles in den Warenkorb. Der Plan steht nur in der Adresse (#plan=…),
   nichts wird im Browser gespeichert oder an uns geschickt. */
(function () {
  "use strict";
  var DG = window.DG || {}, B = DG.basis || "";
  var box = document.getElementById("planer"); if (!box) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var NS = "http://www.w3.org/2000/svg";
  var RAST = 50, FANG = 120, MIN = 1500, MAX = 30000;
  var TUER = { i: "tuer", n: "Tür (Schwenkbereich)", w: 900, d: 900 };
  var FREI = { i: "frei", n: "Freifläche / Gang", w: 1200, d: 800 };

  var geraete = {}, liste = [];
  var plan = { w: 6000, d: 4000, t: [] }, wahl = -1, naechsteId = 1;
  var svg, zieh = null;

  function lies(k, std) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : std; } catch (e) { return std; } }
  function gewerbe() { return lies("dg-modus", DG.modus || "privat") === "gewerbe"; }
  function preis(netto) {
    var n = window.DGR ? DGR.stueckpreis(DG.aktion, netto) : netto;
    return gewerbe() ? n : n * (1 + (DG.mwst || 0.19));
  }
  function eur(x) { return x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function mm(x) { return Math.round(x).toLocaleString("de-DE") + " mm"; }
  function m(x) { return (x / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " m"; }
  function teilInfo(t) { return t.i === "tuer" ? TUER : t.i === "frei" ? FREI : geraete[t.i]; }
  // Hauben und Lüftung hängen über den Geräten: gestrichelt obenauf, keine Überschneidung mit dem Boden
  function oben(t) { var g = geraete[t.i]; return !!(g && g.k === "Lüftung"); }
  function ebene(t) { return t.i === "tuer" || t.i === "frei" ? 0 : oben(t) ? 2 : 1; }
  function kollidiert(a, b) {
    if (a === b || !ueberschneidet(a, b)) return false;
    var ea = ebene(a), eb = ebene(b);
    return ea === eb ? ea !== 0 : (ea === 0 || eb === 0) ? (ea === 1 || eb === 1) : false;
  }
  function mass(t) { var g = teilInfo(t), q = t.r % 180 !== 0; return { w: q ? g.d : g.w, d: q ? g.w : g.d }; }

  /* ---------- Plan in der Adresse ---------- */
  function kodieren() {
    return "1!" + plan.w + "!" + plan.d + plan.t.map(function (t) { return "!" + [t.i, Math.round(t.x), Math.round(t.y), t.r].join("*"); }).join("");
  }
  function dekodieren(s) {
    var teile = s.split("!"); if (teile[0] !== "1") return null;
    var p = { w: grenze(+teile[1]), d: grenze(+teile[2]), t: [] };
    teile.slice(3).forEach(function (z) {
      var f = z.split("*"); if (f.length !== 4) return;
      if (f[0] !== "tuer" && f[0] !== "frei" && !geraete[f[0]]) return;
      p.t.push({ id: naechsteId++, i: f[0], x: +f[1] || 0, y: +f[2] || 0, r: ((+f[3] || 0) % 360 + 360) % 360 });
    });
    return p;
  }
  function merken() {
    try { history.replaceState(null, "", location.pathname + location.search + "#plan=" + encodeURIComponent(kodieren())); } catch (e) {}
  }
  function grenze(x) { return Math.max(MIN, Math.min(MAX, Math.round((+x || 0) / 10) * 10)); }

  /* ---------- Zeichnen ---------- */
  function el(name, attr, eltern) {
    var e = document.createElementNS(NS, name);
    for (var k in attr) e.setAttribute(k, attr[k]);
    if (eltern) eltern.appendChild(e);
    return e;
  }
  function ueberschneidet(a, b) {
    var ma = mass(a), mb = mass(b);
    return a.x < b.x + mb.w - 1 && b.x < a.x + ma.w - 1 && a.y < b.y + mb.d - 1 && b.y < a.y + ma.d - 1;
  }
  function draussen(t) { var s = mass(t); return t.x < -1 || t.y < -1 || t.x + s.w > plan.w + 1 || t.y + s.d > plan.d + 1; }

  function zeichnen() {
    var rand = Math.max(plan.w, plan.d) * 0.08 + 300;
    svg.setAttribute("viewBox", [-rand, -rand, plan.w + 2 * rand, plan.d + 2 * rand].join(" "));
    svg.innerHTML = "";
    var px = Math.max(plan.w, plan.d) / 600;   // ungefähr 1 Bildschirmpixel in mm
    // Raster
    var g = el("g", { class: "pl-raster" }, svg);
    for (var x = 0; x <= plan.w; x += 500) el("line", { x1: x, y1: 0, x2: x, y2: plan.d, class: x % 1000 ? "fein" : "" }, g);
    for (var y = 0; y <= plan.d; y += 500) el("line", { x1: 0, y1: y, x2: plan.w, y2: y, class: y % 1000 ? "fein" : "" }, g);
    el("rect", { x: 0, y: 0, width: plan.w, height: plan.d, class: "pl-raum", "stroke-width": 6 * px });
    // Raummaße
    var tg = el("text", { x: plan.w / 2, y: -rand / 3, class: "pl-mass", "font-size": 14 * px, "text-anchor": "middle" }, svg); tg.textContent = m(plan.w);
    var tl = el("text", { x: -rand / 3, y: plan.d / 2, class: "pl-mass", "font-size": 14 * px, "text-anchor": "middle", transform: "rotate(-90 " + (-rand / 3) + " " + plan.d / 2 + ")" }, svg); tl.textContent = m(plan.d);
    // Teile: erst Freiflächen/Türen, dann Geräte
    var reihen = plan.t.slice().sort(function (a, b) { return ebene(a) - ebene(b); });
    reihen.forEach(function (t) {
      var s = mass(t), info = teilInfo(t), idx = plan.t.indexOf(t);
      var konflikt = draussen(t) || plan.t.some(function (o) { return kollidiert(o, t); });
      var gr = el("g", { class: "pl-teil" + (t.i === "tuer" ? " tuer" : t.i === "frei" ? " frei" : oben(t) ? " oben" : "") + (idx === wahl ? " gewaehlt" : "") + (konflikt ? " konflikt" : ""), "data-idx": idx }, svg);
      el("rect", { x: t.x, y: t.y, width: s.w, height: s.d, rx: 2 * px, "stroke-width": 2 * px }, gr);
      if (t.i === "tuer") {
        // Türblatt und Schwenkbogen, gedreht um die Mitte
        var cx = t.x + s.w / 2, cy = t.y + s.d / 2, w = TUER.w;
        var gt = el("g", { transform: "rotate(" + t.r + " " + cx + " " + cy + ")" }, gr);
        var ox = cx - w / 2, oy = cy - w / 2;
        el("path", { d: "M" + ox + " " + (oy + w) + " L" + ox + " " + oy + " A" + w + " " + w + " 0 0 1 " + (ox + w) + " " + (oy + w), class: "pl-bogen", "stroke-width": 2 * px }, gt);
      }
      el("title", {}, gr).textContent = info.n + " (" + s.w + " × " + s.d + " mm)";
      // Beschriftung nur, wenn sie in das Teil passt; hochkant, wenn das Teil schmal und tief ist
      var hoch = s.d > s.w * 1.3, lang = hoch ? s.d : s.w, quer = hoch ? s.w : s.d;
      var fs = Math.min(12 * px, quer * 0.42), zeichen = Math.floor((lang - 8 * px) / (fs * 0.6));
      var name = t.i === "tuer" ? "Tür" : t.i === "frei" ? "frei" : info.n.replace(/,.*$/, "");
      if (fs >= 6 * px && zeichen >= 4) {
        if (name.length > zeichen) name = name.slice(0, zeichen - 1) + "…";
        var tx = el("text", { x: t.x + s.w / 2, y: t.y + s.d / 2, "font-size": fs, "text-anchor": "middle", "dominant-baseline": "middle", class: "pl-name" }, gr);
        if (hoch) tx.setAttribute("transform", "rotate(-90 " + (t.x + s.w / 2) + " " + (t.y + s.d / 2) + ")");
        tx.textContent = name;
      }
    });
    // Abstände des gewählten Teils zu den Wänden
    var t = plan.t[wahl];
    if (t) {
      var s = mass(t), a = el("g", { class: "pl-abstand", "font-size": 11 * px }, svg);
      [[t.x, t.y + s.d / 2, 0, t.y + s.d / 2, t.x], [t.x + s.w, t.y + s.d / 2, plan.w, t.y + s.d / 2, plan.w - t.x - s.w],
       [t.x + s.w / 2, t.y, t.x + s.w / 2, 0, t.y], [t.x + s.w / 2, t.y + s.d, t.x + s.w / 2, plan.d, plan.d - t.y - s.d]].forEach(function (l) {
        if (l[4] < 5) return;
        el("line", { x1: l[0], y1: l[1], x2: l[2], y2: l[3], "stroke-width": px, "stroke-dasharray": 4 * px + " " + 3 * px }, a);
        var tt = el("text", { x: (l[0] + l[2]) / 2, y: (l[1] + l[3]) / 2 - 4 * px, "text-anchor": "middle" }, a); tt.textContent = mm(l[4]);
      });
    }
    seite();
    merken();
  }

  /* ---------- Seitenleiste: gewähltes Teil, Liste ---------- */
  function seite() {
    var t = plan.t[wahl], ziel = $(".pl-wahl", box);
    if (!t) { ziel.innerHTML = '<p class="klein">Tippen Sie ein Gerät im Plan an, um es zu drehen, zu kopieren oder zu entfernen. Mit den Pfeiltasten schieben Sie es millimetergenau, mit R drehen Sie es.</p>'; }
    else {
      var g = teilInfo(t), s = mass(t);
      ziel.innerHTML = "<p><b>" + esc(g.n) + "</b><br><span class=\"klein\">" + s.w + " × " + s.d + " mm" + (g.h ? " · Höhe " + g.h + " mm" : "") + (g.p ? " · " + eur(preis(g.p)) : "") + "</span></p>" +
        '<p class="pl-knoepfe"><button type="button" class="btn sec" data-a="drehen">↻ Drehen</button><button type="button" class="btn sec" data-a="kopie">Kopieren</button><button type="button" class="btn sec" data-a="weg">Entfernen</button>' +
        (g.s ? '<a class="btn sec" href="' + B + "/produkt/" + esc(g.s) + '/" target="_blank" rel="noopener">Zum Produkt</a>' : "") + "</p>";
    }
    // Zusammenfassung
    var zaehl = {}, summe = 0;
    plan.t.forEach(function (x) { if (geraete[x.i]) zaehl[x.i] = (zaehl[x.i] || 0) + 1; });
    var zeilen = Object.keys(zaehl).map(function (i) {
      var g = geraete[i], ep = preis(g.p); summe += ep * zaehl[i];
      return '<div class="pl-zeile"><span>' + zaehl[i] + ' ×</span><span>' + esc(g.n) + '<br><span class="klein">Art.-Nr. ' + esc(i) + "</span></span><b>" + eur(ep * zaehl[i]) + "</b></div>";
    }).join("");
    var konflikte = plan.t.filter(function (x) { return geraete[x.i] && (draussen(x) || plan.t.some(function (o) { return kollidiert(o, x); })); }).length;
    $(".pl-liste", box).innerHTML = zeilen
      ? '<div class="pl-tabelle">' + zeilen + '<div class="pl-zeile summe"><span></span><span>Summe ' + (gewerbe() ? "netto zzgl. MwSt." : "inkl. MwSt.") + "</span><b>" + eur(summe) + "</b></div></div>" +
        (konflikte ? '<p class="meldung fehler klein">' + konflikte + (konflikte === 1 ? " Gerät steht" : " Geräte stehen") + " übereinander oder außerhalb des Raums (rot markiert).</p>" : "") +
        '<p class="klein">Preise ohne Versand. Maße laut Hersteller; bitte Anschlüsse, Abstände zu Wänden und Lüftung vor Ort prüfen.</p>'
      : '<p class="klein">Noch keine Geräte im Plan.</p>';
    $(".pl-korb", box).disabled = !zeilen;
  }

  /* ---------- Bedienung ---------- */
  function punkt(ev) {
    var p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function einrasten(t) {
    var s = mass(t), kx = [0, plan.w - s.w], ky = [0, plan.d - s.d];
    plan.t.forEach(function (o) {
      if (o === t) return; var so = mass(o);
      kx.push(o.x + so.w, o.x - s.w, o.x); ky.push(o.y + so.d, o.y - s.d, o.y);
    });
    var bx = null, by = null;
    kx.forEach(function (k) { if (Math.abs(t.x - k) < FANG && (bx === null || Math.abs(t.x - k) < Math.abs(t.x - bx))) bx = k; });
    ky.forEach(function (k) { if (Math.abs(t.y - k) < FANG && (by === null || Math.abs(t.y - k) < Math.abs(t.y - by))) by = k; });
    t.x = bx !== null ? bx : Math.round(t.x / RAST) * RAST;
    t.y = by !== null ? by : Math.round(t.y / RAST) * RAST;
  }
  function freierPlatz(t) {
    // neues Teil an der ersten freien Stelle entlang der Wände, sonst in die Mitte
    var s = mass(t);
    for (var y = 0; y + s.d <= plan.d; y += 100) for (var x = 0; x + s.w <= plan.w; x += 100) {
      t.x = x; t.y = y;
      if (!plan.t.some(function (o) { return kollidiert(o, t); })) return;
    }
    t.x = Math.max(0, (plan.w - s.w) / 2); t.y = Math.max(0, (plan.d - s.d) / 2);
  }
  function hinzufuegen(i) {
    var t = { id: naechsteId++, i: i, x: 0, y: 0, r: 0 };
    plan.t.push(t); freierPlatz(t); wahl = plan.t.length - 1; zeichnen();
    if (window.innerWidth < 900) svg.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function drehen(t) {
    var a = mass(t), cx = t.x + a.w / 2, cy = t.y + a.d / 2;
    t.r = (t.r + 90) % 360;
    var b = mass(t); t.x = Math.round(cx - b.w / 2); t.y = Math.round(cy - b.d / 2);
  }

  function aufbauen() {
    svg = el("svg", { class: "pl-svg", role: "img", "aria-label": "Grundriss des Raums" });
    $(".pl-flaeche", box).appendChild(svg);
    svg.addEventListener("pointerdown", function (ev) {
      var gr = ev.target.closest(".pl-teil");
      if (!gr) { wahl = -1; zeichnen(); return; }
      wahl = +gr.dataset.idx; var t = plan.t[wahl], p = punkt(ev);
      zieh = { t: t, dx: p.x - t.x, dy: p.y - t.y, id: ev.pointerId };
      svg.setPointerCapture(ev.pointerId); ev.preventDefault(); zeichnen();
    });
    svg.addEventListener("pointermove", function (ev) {
      if (!zieh || ev.pointerId !== zieh.id) return;
      var p = punkt(ev); zieh.t.x = p.x - zieh.dx; zieh.t.y = p.y - zieh.dy; einrasten(zieh.t); zeichnen();
    });
    function los() { zieh = null; }
    svg.addEventListener("pointerup", los); svg.addEventListener("pointercancel", los);

    $(".pl-wahl", box).addEventListener("click", function (ev) {
      var a = ev.target.closest("[data-a]"); if (!a || !plan.t[wahl]) return;
      var t = plan.t[wahl];
      if (a.dataset.a === "drehen") drehen(t);
      if (a.dataset.a === "kopie") { var k = { id: naechsteId++, i: t.i, x: t.x, y: t.y, r: t.r }; plan.t.push(k); freierPlatz(k); wahl = plan.t.length - 1; }
      if (a.dataset.a === "weg") { plan.t.splice(wahl, 1); wahl = -1; }
      zeichnen();
    });
    document.addEventListener("keydown", function (ev) {
      var t = plan.t[wahl]; if (!t || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      var d = ev.shiftKey ? 10 : RAST, ok = true;
      if (ev.key === "ArrowLeft") t.x -= d; else if (ev.key === "ArrowRight") t.x += d;
      else if (ev.key === "ArrowUp") t.y -= d; else if (ev.key === "ArrowDown") t.y += d;
      else if (ev.key === "r" || ev.key === "R") drehen(t);
      else if (ev.key === "Delete" || ev.key === "Backspace") { plan.t.splice(wahl, 1); wahl = -1; }
      else ok = false;
      if (ok) { ev.preventDefault(); zeichnen(); }
    });

    // Raum
    var fw = $("[name=raum-b]", box), fd = $("[name=raum-t]", box);
    fw.value = plan.w / 1000; fd.value = plan.d / 1000;
    function raum() { plan.w = grenze(parseFloat(String(fw.value).replace(",", ".")) * 1000); plan.d = grenze(parseFloat(String(fd.value).replace(",", ".")) * 1000); zeichnen(); }
    fw.addEventListener("change", raum); fd.addEventListener("change", raum);

    // Katalog
    var such = $("[name=pl-suche]", box), kat = $("[name=pl-kat]", box), kl = $(".pl-katalog", box);
    var kats = []; liste.forEach(function (g) { if (kats.indexOf(g.k) < 0) kats.push(g.k); });
    kat.innerHTML = '<option value="">Alle Bereiche</option>' + kats.map(function (k) { return "<option>" + esc(k) + "</option>"; }).join("");
    function katalog() {
      var w = such.value.toLowerCase().split(/\s+/).filter(Boolean), k = kat.value;
      var t = liste.filter(function (g) { return (!k || g.k === k) && w.every(function (x) { return (g.n + " " + g.i + " " + g.k).toLowerCase().indexOf(x) >= 0; }); });
      kl.innerHTML = ['<button type="button" class="pl-ger sonder" data-i="tuer"><span class="pl-ico">⌒</span><span><b>Tür</b><span class="klein">Schwenkbereich 900 × 900 mm</span></span></button>',
        '<button type="button" class="pl-ger sonder" data-i="frei"><span class="pl-ico">▭</span><span><b>Freifläche / Gang</b><span class="klein">1200 × 800 mm, z. B. Arbeitsgang</span></span></button>']
        .concat(t.slice(0, 80).map(function (g) {
          return '<button type="button" class="pl-ger" data-i="' + esc(g.i) + '">' + (g.b ? '<img src="' + esc(g.b) + '" alt="" loading="lazy">' : '<span class="pl-ico"></span>') +
            "<span><b>" + esc(g.n) + '</b><span class="klein">' + g.w + " × " + g.d + " mm · " + eur(preis(g.p)) + "</span></span></button>";
        })).join("") + (t.length > 80 ? '<p class="klein">' + (t.length - 80) + " weitere – bitte Suche eingrenzen.</p>" : "") + (!t.length ? '<p class="klein">Nichts gefunden.</p>' : "");
    }
    such.addEventListener("input", katalog); kat.addEventListener("change", katalog); katalog();
    kl.addEventListener("click", function (ev) { var b = ev.target.closest(".pl-ger"); if (b) hinzufuegen(b.dataset.i); });

    // Aktionen
    $(".pl-korb", box).addEventListener("click", function () {
      var korb = lies("dg-korb", []);
      plan.t.forEach(function (t) {
        if (!geraete[t.i]) return;
        var p = korb.filter(function (x) { return x.sku === t.i; })[0];
        if (p) p.menge = Math.min(99, p.menge + 1); else korb.push({ sku: t.i, menge: 1 });
      });
      try { localStorage.setItem("dg-korb", JSON.stringify(korb)); } catch (e) {}
      location.href = B + "/warenkorb/";
    });
    $(".pl-link", box).addEventListener("click", function () {
      var url = location.href, k = this;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { k.textContent = "Link kopiert ✓"; setTimeout(function () { k.textContent = "Link kopieren"; }, 2500); })
        .catch(function () { window.prompt("Link zu Ihrem Plan:", url); });
    });
    $(".pl-druck", box).addEventListener("click", function () { wahl = -1; zeichnen(); window.print(); });
    $(".pl-neu", box).addEventListener("click", function () { if (!plan.t.length || confirm("Plan leeren und neu anfangen?")) { plan.t = []; wahl = -1; zeichnen(); } });
    document.addEventListener("dg:modus", function () { katalog(); seite(); });
  }

  /* ---------- KI-Planung (Server: POST /planen, nur wenn der KI-Berater eingerichtet ist) ---------- */
  function kiAufbauen() {
    var k = $(".pl-ki", box); if (!k || !DG.api) return;
    var feld = $("[name=pl-wunsch]", k), los = $(".pl-ki-los", k), neu = $(".pl-ki-neu", k), aus = $(".pl-ki-antwort", k);
    var vorher = null, sicherung = null;
    fetch(DG.api + "/beraten").then(function (r) { return r.json(); }).then(function (d) {
      if (!d.aktiv) return;
      k.hidden = false;
      [].forEach.call(box.querySelectorAll(".pl-nr"), function (n) { n.textContent = +n.textContent + 1; });
    }).catch(function () {});
    function zustand() {
      los.textContent = vorher ? "Plan ändern lassen" : "Plan erstellen lassen";
      neu.hidden = !vorher;
      feld.placeholder = vorher ? "Was soll Domo ändern? z. B. noch eine Spülmaschine dazu, Kühlung näher an die Tür" : "z. B. Imbiss mit Pommes und Burgern, ca. 80 Portionen am Tag, Tür unten links, Budget 8.000 €";
    }
    neu.addEventListener("click", function () { vorher = null; aus.innerHTML = ""; zustand(); feld.focus(); });
    aus.addEventListener("click", function (ev) {
      if (!ev.target.closest(".pl-ki-zurueck") || !sicherung) return;
      plan = sicherung; sicherung = null; wahl = -1; zeichnen();
      var z = $(".pl-ki-zurueck", aus); if (z) z.remove();
    });
    los.addEventListener("click", function () {
      var text = feld.value.trim();
      if (text.length < 3) { aus.innerHTML = '<p class="meldung fehler klein">Bitte beschreiben Sie kurz, was in den Raum soll.</p>'; feld.focus(); return; }
      los.disabled = true; los.textContent = "Domo plant …";
      aus.innerHTML = '<p class="klein">Das dauert meist 20 bis 60 Sekunden.</p>';
      fetch(DG.api + "/planen", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ b: plan.w, t: plan.d, text: text, vorher: vorher }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.fehler || "Die KI-Planung ist gerade nicht erreichbar."); return j; }); })
        .then(function (d) {
          var html = '<p class="pl-ki-text">' + esc(d.antwort || "").replace(/\n+/g, "<br>") + "</p>";
          if (d.teile && d.teile.length) {
            sicherung = { w: plan.w, d: plan.d, t: plan.t };
            plan = { w: plan.w, d: plan.d, t: d.teile.filter(function (t) { return t.i === "tuer" || geraete[t.i]; })
              .map(function (t) { return { id: naechsteId++, i: t.i, x: t.x, y: t.y, r: t.r }; }) };
            wahl = -1; zeichnen();
            vorher = { text: vorher ? vorher.text + " / " + text : text, reihen: d.plan.reihen, tuer: d.plan.tuer };
            feld.value = "";
            if (d.hinweise && d.hinweise.length) html += '<p class="meldung fehler klein">Nicht alles passte perfekt. Rot markierte Teile bitte von Hand verschieben oder entfernen.</p>';
            if (sicherung.t.length) html += '<p class="klein"><button type="button" class="linkknopf pl-ki-zurueck">Vorherigen Plan zurückholen</button></p>';
            if (window.innerWidth < 900) svg.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          aus.innerHTML = html;
        })
        .catch(function (e) { aus.innerHTML = '<p class="meldung fehler klein">' + esc(e.message) + "</p>"; })
        .then(function () { los.disabled = false; zustand(); });
    });
  }

  fetch(B + "/planer.json").then(function (r) { return r.json(); }).then(function (d) {
    liste = d; liste.forEach(function (g) { geraete[g.i] = g; });
    var h = location.hash.match(/plan=([^&]+)/);
    if (h) { var p = dekodieren(decodeURIComponent(h[1])); if (p) plan = p; }
    aufbauen(); zeichnen(); kiAufbauen();
    box.classList.add("bereit");
  }).catch(function () { $(".pl-flaeche", box).innerHTML = '<p class="meldung fehler">Der Planer konnte nicht geladen werden. Bitte Seite neu laden.</p>'; });
})();
