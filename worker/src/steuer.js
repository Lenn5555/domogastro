// Versandkosten und Umsatzsteuer je Lieferland (Lenn 2026-11-19). Reine Rechnung ohne Abhängigkeiten:
// Der Server nutzt diese Datei direkt, build_site.py baut daraus seite/rechnen.js für den Browser. So rechnen beide gleich.
// cfg = daten/laender.json; pos = [{ a: { p: netto je Stück, g: geschätzte kg, sp: Spedition, el: Elektrogerät }, menge }]
export function r2(x) { return Math.round(x * 100) / 100; }

export function landVon(cfg, c) {
  for (var i = 0; i < cfg.laender.length; i++) if (cfg.laender[i].c === c) return cfg.laender[i];
  return null;
}

// Versand: Deutschland kostenlos. Ausland: Paketpreis je angefangene paket_kg (geschätztes Gewicht), auch für große Geräte
// (Lenn 2026-11-19: keine Speditionspauschale; höhere tatsächliche Kosten fordern wir vor dem Versand gesondert an).
export function versandRechnen(cfg, land, pos) {
  if (!land || !land.zone) return { versand: 0, pakete: 0 };
  var z = cfg.zonen[land.zone];
  var kg = pos.reduce(function (s, p) { return s + (p.a.g || 5) * p.menge; }, 0);
  var pakete = Math.max(1, Math.ceil(kg / cfg.paket_kg));
  return { versand: r2(pakete * z.paket), pakete: pakete };
}

// Steuerart: DE (19 %), OSS (Satz des Lieferlands an Privat), IG (steuerfreie innergemeinschaftliche Lieferung an Unternehmen
// mit gültiger USt-IdNr.), AUSFUHR (Schweiz/Liechtenstein, steuerfrei; Einfuhrabgaben zahlt der Empfänger)
export function steuerArt(cfg, land, ustidGueltig) {
  if (!land || land.c === "DE") return { art: "DE", satz: 19 };
  if (!land.eu) return { art: "AUSFUHR", satz: 0 };
  if (ustidGueltig) return { art: "IG", satz: 0 };
  return cfg.oss ? { art: "OSS", satz: land.mwst } : { art: "DE", satz: 19 };
}

export function gesamtRechnen(cfg, landCode, pos, prozent, ustidGueltig) {
  var land = landVon(cfg, landCode || "DE");
  var warenwert = r2(pos.reduce(function (s, p) { return s + p.a.p * p.menge; }, 0));
  var rabatt = r2(warenwert * (prozent || 0) / 100);
  var v = versandRechnen(cfg, land, pos);
  var st = steuerArt(cfg, land, ustidGueltig);
  var netto = r2(warenwert - rabatt + v.versand);
  var mwst = r2(netto * st.satz / 100);
  var gesperrt = land && !land.elektro ? pos.filter(function (p) { return p.a.el; }) : [];
  return { land: land, warenwert: warenwert, rabatt: rabatt, versand: v.versand, pakete: v.pakete,
    art: st.art, satz: st.satz, netto: netto, mwst: mwst, brutto: r2(netto + mwst), gesperrt: gesperrt };
}
