// Domo, das Erdmännchen auf der Startseite (Lenn 2026-11-20: Animation aus Kling-Clips).
// Jeder MP4-Clip enthält oben das Bild und unten die Transparenz als Graustufen; WebGL setzt beides zusammen.
// So ist Domo freigestellt und es läuft überall, auch auf dem iPhone.
// Clips: Ruhe (Schleife), Winken (Klick auf Domo), Lauf-Start (Drehung), Lauf (Schleife), Lauf-Ende (Aufstehen).
// Klick neben Domo: er dreht sich, rennt der Maus hinterher, bleibt bei ihr stehen und läuft später zurück.
// Ohne WebGL, bei „Bewegung reduzieren“ oder wenn das Video nicht startet, bleibt das stehende Bild.
(function () {
  "use strict";
  var figur = document.querySelector(".domo-figur");
  if (!figur) return;
  var bild = figur.querySelector("img"), leinwand = figur.querySelector("canvas");
  var hero = figur.closest(".hero") || document.body;
  var ruhig = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Leinwand 1700 × 1000: Stehen/Winken liegen mittig (552 breit), Laufen nutzt die ganze Breite
  var LW = 1700, STEH = [547 / LW, 0, 552 / LW, 1], GANZ = [0, 0, 1, 1];

  // --- WebGL: Bild (obere Hälfte) mal Transparenz (untere Hälfte), zwei Clips überblendbar ---
  var gl = null, texturen, mixOrt, rechteckOrt, spiegelOrt;
  try { gl = leinwand.getContext("webgl", { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false }); } catch (e) { gl = null; }
  function shader(art, quelle) {
    var s = gl.createShader(art); gl.shaderSource(s, quelle); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  if (gl) {
    try {
      var prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER,
        "attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}"));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER,
        "precision mediump float;uniform sampler2D t0;uniform sampler2D t1;uniform vec4 r0;uniform vec4 r1;uniform float s0;uniform float s1;uniform float m;varying vec2 uv;" +
        "vec4 px(sampler2D t,vec4 r,float s){vec2 w=vec2(s<0.?1.-uv.x:uv.x,uv.y);vec2 q=(w-r.xy)/r.zw;if(q.x<0.||q.y<0.||q.x>1.||q.y>1.)return vec4(0.);" +
        "vec3 c=texture2D(t,vec2(q.x,q.y*.5)).rgb;float a=texture2D(t,vec2(q.x,.5+q.y*.5)).r;" +
        "a=clamp((a-.03)/.94,0.,1.);return vec4(c*a,a);}" +
        "void main(){gl_FragColor=mix(px(t0,r0,s0),px(t1,r1,s1),m);}"));
      gl.linkProgram(prog); gl.useProgram(prog);
      var puffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      texturen = [0, 1].map(function (i) {
        var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
        [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (k) { gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE); });
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.uniform1i(gl.getUniformLocation(prog, "t" + i), i);
        return t;
      });
      mixOrt = gl.getUniformLocation(prog, "m");
      rechteckOrt = [gl.getUniformLocation(prog, "r0"), gl.getUniformLocation(prog, "r1")];
      spiegelOrt = [gl.getUniformLocation(prog, "s0"), gl.getUniformLocation(prog, "s1")];
      gl.clearColor(0, 0, 0, 0);
    } catch (e) { console.warn("Domo:", e.message); gl = null; }
  }

  function clip(src, schleife, rechteck) {
    var v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = schleife; v.preload = "auto";
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
    v.src = src; figur.appendChild(v);
    return { v: v, r: rechteck, s: 1 };
  }
  function bereit(c) { return c && c.v.readyState >= 2; }
  function abspielen(c, vonVorn) {
    if (vonVorn) c.v.currentTime = 0;
    var p = c.v.play();
    if (p && p.catch) p.catch(function () { /* z. B. Stromsparmodus: stehendes Bild bleibt */ });
  }

  var C = {}, aktiv = null, vorher = null, wechselAb = 0, blende = 350, sichtbar = true;
  // Wechsel weich überblenden, damit Domo nicht springt (bei direkt anschließenden Clips kürzer)
  function wechseln(c, ms) { if (c === aktiv) return; vorher = aktiv; wechselAb = performance.now(); blende = ms == null ? 350 : ms; aktiv = c; }
  function hochladen(i, c) {
    gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texturen[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, c.v);
    gl.uniform4fv(rechteckOrt[i], c.r); gl.uniform1f(spiegelOrt[i], c.s);
  }
  function zeichnen() {
    if (!gl || !bereit(aktiv)) return false;
    var m = vorher && blende > 0 ? Math.min(1, (performance.now() - wechselAb) / blende) : 1;
    try {
      hochladen(1, aktiv);
      if (m < 1 && bereit(vorher)) hochladen(0, vorher); else { m = 1; vorher = null; }
    } catch (e) { return false; }
    gl.uniform1f(mixOrt, m * m * (3 - 2 * m));
    gl.viewport(0, 0, leinwand.width, leinwand.height);
    gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  var d = figur.dataset;
  if (gl && !ruhig && d.ruhe) {
    C.ruhe = clip(d.ruhe, true, STEH); aktiv = C.ruhe;
    C.ruhe.v.addEventListener("playing", function () { if (zeichnen()) figur.classList.add("laeuft"); });
    abspielen(C.ruhe);
    // Die anderen Clips erst laden, wenn die Ruhe-Schleife läuft
    C.ruhe.v.addEventListener("playing", function () {
      if (C.winken) return;
      C.winken = clip(d.winken, false, STEH);
      // Kurz vor Schluss zurück in die Ruhe-Schleife überblenden (sie läuft im Hintergrund weiter)
      C.winken.v.addEventListener("timeupdate", function () {
        var v = C.winken.v;
        if (aktiv === C.winken && v.duration && v.currentTime > v.duration - 0.35) { zustand = "ruhe"; wechseln(C.ruhe); }
      });
      if (d.laufStart) {
        C.start = clip(d.laufStart, false, GANZ); C.lauf = clip(d.lauf, true, GANZ); C.ende = clip(d.laufEnde, false, GANZ);
        C.start.v.addEventListener("ended", function () { if (zustand === "drehen") { zustand = "laufen"; abspielen(C.lauf, true); wechseln(C.lauf, 80); } });
        C.ende.v.addEventListener("ended", function () { if (zustand === "aufstehen") angekommen(); });
      }
    }, { once: true });
    // Außer Sicht anhalten (spart Akku)
    if ("IntersectionObserver" in window) new IntersectionObserver(function (e) {
      sichtbar = e[0].isIntersecting;
      Object.keys(C).forEach(function (k) { if (!sichtbar) C[k].v.pause(); });
      if (sichtbar) { abspielen(C.ruhe); if (aktiv !== C.ruhe) abspielen(aktiv); }
    }).observe(figur);
  }

  // --- Jagen ---
  var zustand = "ruhe", pos = 0, richtung = 1, maus = null, heim = false, jagdBis = 0, letzte = 0, zurueck = null;
  var TEMPO = 0.55;  // Pixel je Millisekunde beim Rennen
  window.addEventListener("pointermove", function (e) { maus = e.clientX; }, { passive: true });
  function setzen() {
    figur.style.transform = pos ? "translateX(" + pos.toFixed(1) + "px)" : "";
    ["start", "lauf", "ende"].forEach(function (k) { if (C[k]) C[k].s = richtung; });
  }
  // Beim Rennen ist die Schnauze weit vor der Körpermitte: die soll die Maus erreichen
  function schnauze() { return (1480 - 850) / LW * leinwand.getBoundingClientRect().width; }
  function zielPos() {
    if (heim) return 0;
    var r = bild.getBoundingClientRect(), mitte0 = r.left + r.width / 2 - pos, hr = hero.getBoundingClientRect();
    var x = (maus == null ? mitte0 : maus) - mitte0;
    if (zustand === "laufen") x -= richtung * schnauze();
    return Math.max(hr.left + r.width / 2 - mitte0, Math.min(hr.right - r.width / 2 - mitte0, x));
  }
  function losrennen(nachHause) {
    if (!bereit(C.start) || !bereit(C.lauf) || !bereit(C.ende)) return false;
    clearTimeout(zurueck);
    heim = nachHause; jagdBis = performance.now() + 4500;
    var dx = zielPos() - pos;
    if (Math.abs(dx) < 30) return false;
    richtung = dx < 0 ? -1 : 1; setzen();
    zustand = "drehen"; abspielen(C.start, true); wechseln(C.start, 250);
    return true;
  }
  function anhalten() { zustand = "aufstehen"; abspielen(C.ende, true); wechseln(C.ende, 180); }
  function angekommen() {
    zustand = "ruhe"; abspielen(C.ruhe); wechseln(C.ruhe, 300);
    if (!heim && Math.abs(pos) > 1) zurueck = setTimeout(function () { if (zustand === "ruhe") losrennen(true); }, 1800);
    else if (heim) { pos = 0; richtung = 1; setzen(); }
  }
  function schleife(t) {
    var dt = Math.min(50, t - (letzte || t)); letzte = t;
    if (zustand === "laufen") {
      var dx = zielPos() - pos;
      if (Math.abs(dx) < 12 || (!heim && t > jagdBis)) anhalten();
      else {
        var r = dx < 0 ? -1 : 1;
        if (r !== richtung) richtung = r;  // Maus hat die Seite gewechselt: umdrehen
        pos += r * Math.min(Math.abs(dx), TEMPO * dt);
        setzen();
      }
    }
    if (aktiv && sichtbar) zeichnen();
    requestAnimationFrame(schleife);
  }
  requestAnimationFrame(schleife);

  // Trifft ein Klick Domo? Mit Video: Transparenz des aktuellen Bildes, sonst grob die Mitte des Bildes
  function trifftDomo(clientX, clientY) {
    var r = leinwand.getBoundingClientRect();
    var x = (clientX - r.left) / r.width, y = (clientY - r.top) / r.height;
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return false;
    if (gl && figur.classList.contains("laeuft")) {
      var px = new Uint8Array(4);
      gl.readPixels(Math.floor(x * leinwand.width), Math.floor((1 - y) * leinwand.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px[3] > 40;
    }
    var b = bild.getBoundingClientRect();
    return clientX > b.left + b.width * 0.15 && clientX < b.right - b.width * 0.15 && clientY > b.top && clientY < b.bottom;
  }
  hero.addEventListener("click", function (e) {
    if (e.target.closest("a, button, input, label")) return;
    if (ruhig || zustand !== "ruhe") return;
    if (trifftDomo(e.clientX, e.clientY)) {
      if (C.winken && aktiv !== C.winken && bereit(C.winken)) {
        clearTimeout(zurueck); zustand = "winken";
        abspielen(C.winken, true); wechseln(C.winken);
      } else if (C.ruhe && C.ruhe.v.paused) abspielen(C.ruhe);  // falls der Browser erst nach einem Klick abspielt
    } else {
      maus = e.clientX; losrennen(false);
    }
  });
  figur.style.cursor = "pointer";
})();
