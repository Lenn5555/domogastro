// Domo, das Erdmännchen auf der Startseite: Augen folgen der Maus, reagiert auf Klicks je nach Stelle,
// jagt die Maus, wenn man neben ihn klickt. Koordinaten beziehen sich auf das Bild domo-koch.webp (523 × 1100).
(function () {
  "use strict";
  var figur = document.querySelector(".domo-figur");
  if (!figur) return;
  var bild = figur.querySelector("img"), leinwand = figur.querySelector("canvas"), blase = figur.querySelector(".domo-blase");
  var hero = figur.closest(".hero") || document.body;
  var W = 523, H = 1100;
  var ruhig = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Augen: Öffnung (Ellipse, in der gezeichnet wird) und Iris (Kreis, der verschoben wird)
  var AUGEN = [
    { cx: 215, cy: 215, rx: 23, ry: 18, ix: 216, iy: 214, ir: 21 },
    { cx: 318, cy: 181, rx: 19, ry: 15, ix: 316, iy: 180, ir: 17 },
  ];
  var MAX = 5;  // maximale Verschiebung der Iris in Bildpixeln

  // Stellen zum Anklicken (Bildkoordinaten), von oben nach unten geprüft
  var STELLEN = [
    { name: "nase", x0: 270, x1: 335, y0: 200, y1: 255, text: "Hatschi!", art: "nies" },
    { name: "augen", x0: 180, x1: 345, y0: 160, y1: 240, text: "Hey, nicht in die Augen!", art: "zuck" },
    { name: "muetze", x0: 40, x1: 345, y0: 0, y1: 170, text: "Finger weg von meiner Mütze!", art: "kipp" },
    { name: "gesicht", x0: 100, x1: 400, y0: 150, y1: 330, text: "Hihi!", art: "wackel" },
    { name: "hand", x0: 140, x1: 250, y0: 600, y1: 700, text: "High five!", art: "hops" },
    { name: "hand", x0: 400, x1: 480, y0: 600, y1: 690, text: "High five!", art: "hops" },
    { name: "bauch", x0: 140, x1: 470, y0: 330, y1: 900, text: "Hihi, das kitzelt!", art: "kitzel" },
    { name: "schwanz", x0: 0, x1: 170, y0: 880, y1: 1100, text: "Mein Schwanz!", art: "hops" },
    { name: "fuss", x0: 150, x1: 470, y0: 980, y1: 1100, text: "Autsch, mein Fuß!", art: "hops" },
    { name: "rest", x0: 0, x1: W, y0: 0, y1: H, text: "Hallo! Ich bin Domo.", art: "wackel" },
  ];

  // Bild einmal in eine unsichtbare Leinwand kopieren: für die Iris-Ausschnitte und um zu prüfen, ob ein Klick Domo trifft
  var quelle = document.createElement("canvas"); quelle.width = W; quelle.height = H;
  var qctx = quelle.getContext("2d", { willReadFrequently: true });
  var ctx = leinwand.getContext("2d");
  var bereit = false;
  var blick = { x: 0, y: 0 }, ziel = { x: 0, y: 0 };
  function laden() { qctx.drawImage(bild, 0, 0, W, H); bereit = true; zeichnen(); }
  if (bild.complete && bild.naturalWidth) laden(); else bild.addEventListener("load", laden);

  function zeichnen() {
    if (!bereit) return;
    ctx.clearRect(0, 0, W, H);
    AUGEN.forEach(function (a) {
      ctx.save();
      ctx.beginPath(); ctx.ellipse(a.cx, a.cy, a.rx, a.ry, 0, 0, Math.PI * 2); ctx.clip();
      // Grund: dunkler Augenrand, darüber die verschobene Iris aus dem Originalbild
      ctx.fillStyle = "#2A170B"; ctx.fill();
      ctx.beginPath(); ctx.arc(a.ix + blick.x, a.iy + blick.y, a.ir, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(quelle, a.ix - a.ir, a.iy - a.ir, a.ir * 2, a.ir * 2, a.ix - a.ir + blick.x, a.iy - a.ir + blick.y, a.ir * 2, a.ir * 2);
      ctx.restore();
    });
  }
  function zuBild(clientX, clientY) {
    var r = bild.getBoundingClientRect(), gespiegelt = figur.classList.contains("links");
    var x = (clientX - r.left) / r.width * W;
    return { x: gespiegelt ? W - x : x, y: (clientY - r.top) / r.height * H };
  }
  function schauen(clientX, clientY) {
    var p = zuBild(clientX, clientY);
    var dx = p.x - 265, dy = p.y - 200, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 400);
    ziel.x = dx / d * MAX * k; ziel.y = dy / d * MAX * 0.7 * k;
  }
  window.addEventListener("pointermove", function (e) { schauen(e.clientX, e.clientY); }, { passive: true });

  // Kleine Schleife: Blick weich nachziehen, beim Jagen hinterherhüpfen
  var jagd = null, pos = 0, maus = null;
  window.addEventListener("pointermove", function (e) { maus = e.clientX; }, { passive: true });
  function schleife(t) {
    blick.x += (ziel.x - blick.x) * 0.2; blick.y += (ziel.y - blick.y) * 0.2;
    if (jagd) {
      var heim = t > jagd.bis, r = figur.getBoundingClientRect(), mitte = r.left + r.width / 2 - pos;
      var hr = hero.getBoundingClientRect();
      var wohin = heim ? 0 : Math.max(hr.left + r.width / 2 - mitte, Math.min(hr.right - r.width / 2 - mitte, (maus == null ? mitte : maus) - mitte));
      var schritt = Math.max(-9, Math.min(9, (wohin - pos) * 0.08));
      pos += schritt;
      if (Math.abs(schritt) > 0.4) figur.classList.toggle("links", schritt < 0);
      var hopser = Math.abs(Math.sin(t / 110)) * (Math.abs(wohin - pos) > 4 ? 22 : 0);
      figur.style.transform = "translate(" + pos.toFixed(1) + "px," + (-hopser).toFixed(1) + "px)";
      if (heim && Math.abs(pos) < 1) { pos = 0; jagd = null; figur.style.transform = ""; figur.classList.remove("links"); }
    }
    zeichnen();
    requestAnimationFrame(schleife);
  }
  requestAnimationFrame(schleife);

  var blasenZeit;
  function sagen(text) {
    blase.textContent = text; blase.classList.add("an");
    clearTimeout(blasenZeit); blasenZeit = setTimeout(function () { blase.classList.remove("an"); }, 1800);
  }
  function reagieren(art) {
    if (ruhig) return;
    bild.classList.remove("nies", "zuck", "kipp", "wackel", "hops", "kitzel");
    void bild.offsetWidth;  // Animation neu starten
    bild.classList.add(art);
  }
  bild.addEventListener("animationend", function () { bild.className = ""; });

  function trifftDomo(p) {
    if (!bereit || p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return false;
    return qctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 40;
  }
  hero.addEventListener("click", function (e) {
    if (e.target.closest("a, button, input, label")) return;
    var p = zuBild(e.clientX, e.clientY);
    if (trifftDomo(p)) {
      var s = STELLEN.find(function (s) { return p.x >= s.x0 && p.x < s.x1 && p.y >= s.y0 && p.y < s.y1; });
      sagen(s.text); reagieren(s.art);
    } else if (!ruhig) {
      maus = e.clientX; sagen("Ich krieg dich!"); jagd = { bis: performance.now() + 3500 };
    }
  });
  figur.style.cursor = "pointer";
})();
