// Domo, das Erdmännchen auf der Startseite (Lenn 2026-11-20: Animation aus Kling-Clips).
// Zwei MP4-Clips (Ruhe als Schleife, Winken beim Anklicken). Jeder Clip enthält oben das Bild und unten die Transparenz
// als Graustufen; WebGL setzt beides zusammen. So ist Domo freigestellt und es läuft überall, auch auf dem iPhone.
// Ohne WebGL, bei „Bewegung reduzieren“ oder wenn das Video nicht startet, bleibt das stehende Bild.
// Klick neben Domo: er jagt kurz der Maus hinterher.
(function () {
  "use strict";
  var figur = document.querySelector(".domo-figur");
  if (!figur) return;
  var bild = figur.querySelector("img"), leinwand = figur.querySelector("canvas");
  var hero = figur.closest(".hero") || document.body;
  var ruhig = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- WebGL: Bild (obere Hälfte) mal Transparenz (untere Hälfte) ---
  var gl = null;
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
        "precision mediump float;uniform sampler2D t;varying vec2 uv;void main(){" +
        "vec3 c=texture2D(t,vec2(uv.x,uv.y*.5)).rgb;float a=texture2D(t,vec2(uv.x,.5+uv.y*.5)).r;" +
        "a=clamp((a-.03)/.94,0.,1.);gl_FragColor=vec4(c*a,a);}"));
      gl.linkProgram(prog); gl.useProgram(prog);
      var puffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (k) { gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE); });
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.clearColor(0, 0, 0, 0);
    } catch (e) { console.warn("Domo:", e.message); gl = null; }
  }

  function clip(src, schleife) {
    var v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = schleife; v.preload = "auto";
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
    v.src = src; figur.appendChild(v);
    return v;
  }
  var ruhe = null, winken = null, aktiv = null, sichtbar = true;
  function zeichnen() {
    if (!gl || !aktiv || aktiv.readyState < 2) return false;
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, aktiv); } catch (e) { return false; }
    gl.viewport(0, 0, leinwand.width, leinwand.height);
    gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
  function abspielen(v) {
    var p = v.play();
    if (p && p.catch) p.catch(function () { /* z. B. Stromsparmodus: stehendes Bild bleibt */ });
  }
  if (gl && !ruhig && figur.dataset.ruhe) {
    ruhe = clip(figur.dataset.ruhe, true); aktiv = ruhe;
    ruhe.addEventListener("playing", function () { if (zeichnen()) figur.classList.add("laeuft"); });
    abspielen(ruhe);
    // Winken erst laden, wenn die Ruhe-Schleife läuft
    ruhe.addEventListener("playing", function () {
      if (winken) return;
      winken = clip(figur.dataset.winken, false);
      winken.addEventListener("ended", function () { ruhe.currentTime = 0; aktiv = ruhe; abspielen(ruhe); });
    }, { once: true });
    // Außer Sicht anhalten (spart Akku)
    if ("IntersectionObserver" in window) new IntersectionObserver(function (e) {
      sichtbar = e[0].isIntersecting;
      if (!sichtbar) { ruhe.pause(); if (winken) winken.pause(); } else abspielen(aktiv);
    }).observe(figur);
  }

  // --- Schleife: Video zeichnen, beim Jagen hinterherhüpfen ---
  var jagd = null, pos = 0, maus = null;
  window.addEventListener("pointermove", function (e) { maus = e.clientX; }, { passive: true });
  function schleife(t) {
    if (aktiv && sichtbar) zeichnen();
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
    requestAnimationFrame(schleife);
  }
  requestAnimationFrame(schleife);

  // Trifft ein Klick Domo? Mit Video: Transparenz des aktuellen Bildes, sonst grob die Mitte des Bildes
  function trifftDomo(clientX, clientY) {
    var r = bild.getBoundingClientRect();
    var x = (clientX - r.left) / r.width, y = (clientY - r.top) / r.height;
    if (figur.classList.contains("links")) x = 1 - x;
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return false;
    if (gl && figur.classList.contains("laeuft")) {
      var px = new Uint8Array(4);
      gl.readPixels(Math.floor(x * leinwand.width), Math.floor((1 - y) * leinwand.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px[3] > 40;
    }
    return x > 0.15 && x < 0.85;
  }
  hero.addEventListener("click", function (e) {
    if (e.target.closest("a, button, input, label")) return;
    if (trifftDomo(e.clientX, e.clientY)) {
      if (winken && aktiv !== winken) {
        winken.currentTime = 0; aktiv = winken; abspielen(winken);
      } else if (ruhe && ruhe.paused) abspielen(ruhe);  // falls der Browser das Abspielen erst nach einem Klick erlaubt
    } else if (!ruhig) {
      maus = e.clientX; jagd = { bis: performance.now() + 3500 };
    }
  });
  figur.style.cursor = "pointer";
})();
