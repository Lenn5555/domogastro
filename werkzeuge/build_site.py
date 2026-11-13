#!/usr/bin/env python3
"""Baut Domo Gastro als statische Website in den Ordner site/ (GitHub Pages, ohne Datenbank).

Quelle: daten/produkte.json (aus werkzeuge/import_metro.py), daten/site.json, daten/rechtstexte/*.html
Preise in produkte.json sind NETTO. Der Schalter Privat/Gewerbe (seite/shop.js) zeigt brutto oder netto.
Konto, Bestellung, Bewertungen laufen über den Worker (worker/), Adresse in daten/site.json "api".

Aufruf: python3 werkzeuge/build_site.py  ->  site/
"""
import html
import json
import os
import re
import shutil
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site"
CFG = json.loads((ROOT / "daten/site.json").read_text(encoding="utf-8"))
PRODUKTE = json.loads((ROOT / "daten/produkte.json").read_text(encoding="utf-8"))["produkte"]
RECHT = ROOT / "daten/rechtstexte"
BASIS = os.environ.get("SITE_BASIS", "").rstrip("/")
API = os.environ.get("SITE_API", CFG.get("api", "")).rstrip("/")
CNAME = (ROOT / "CNAME").read_text(encoding="utf-8").strip() if (ROOT / "CNAME").exists() else ""
SITE_URL = f"https://{CNAME}" if CNAME else "https://lenn5555.github.io/domogastro"
# Vorschau: für Suchmaschinen gesperrt, mit Hinweisleiste oben (SITE_VORSCHAU=ja)
VORSCHAU = os.environ.get("SITE_VORSCHAU", "") == "ja"
e = html.escape
SEITEN = []

KAT_TEXT = {
    "Lüftung": "Wand-, Kasten- und Deckenhauben nach Maß, Filter und Luftreiniger",
    "Kochen": "Herde, Pizzaöfen, Grillplatten, Fritteusen und Kessel",
    "Warmhalten & Ausgabe": "Tellerstapler, Wärmebrücken, Bain Marie und Buffet",
    "Spülen & Wasser": "Handwaschbecken, Armaturen, Gläser- und Flaschenfüller",
    "Hygiene & Waschraum": "Händetrockner, Spender, Abfall und Waschraum",
    "Möbel & Transport": "Regale, Untergestelle, Wagen und Theken",
    "Bar & Getränke": "Mixer, Eiswürfelbereiter, Zitruspressen und Bar",
    "Terrasse & Raum": "Heizstrahler für Terrasse und Gastraum",
    "Küchenhelfer": "Kleingeräte und Werkzeuge für die Profiküche",
}
KAT_REIHE = list(KAT_TEXT)


def slug(s):
    s = s.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss").replace("&", "und")
    return "-".join("".join(c if c.isalnum() else " " for c in s).split())


def u(pfad):
    return f"{BASIS}{pfad}"


def preise(p):
    if p["varianten"]:
        return [v["preis_netto"] for v in p["varianten"] if v.get("preis_netto")]
    return [p["preis_netto"]] if p.get("preis_netto") else []


def ab_preis(p):
    w = preise(p)
    return min(w) if w else None


def lieferzeit(lz, bestand=None):
    if not lz or not lz[0]:
        return "Lieferzeit auf Anfrage"
    a, b = lz
    t = f"Lieferzeit {a}–{b} Werktage" if b and b != a else f"Lieferzeit {a} Werktage"
    return t if bestand != 0 else t + " (derzeit nicht vorrätig, ggf. länger)"


def masse(m):
    teile = [f"{n} {m[k]} mm" for k, n in (("breite", "B"), ("tiefe", "T"), ("hoehe", "H")) if m.get(k)]
    return " × ".join(teile)


def preis_html(netto, ab=False, gross=False):
    if not netto:
        return '<span class="anfrage">Preis auf Anfrage</span>'
    return (f'<div class="{"preis-gross" if gross else ""}"><span class="pr" data-netto="{netto:.2f}"{" data-ab=1" if ab else ""}></span>'
            f'<span class="steuer"></span></div>')


def kategorien():
    da = {p["kategorie"] for p in PRODUKTE}
    return [k for k in KAT_REIHE if k in da] + sorted(da - set(KAT_REIHE))


def seite(titel, inhalt, pfad, beschreibung="", aktiv="", index=True):
    if index:
        SEITEN.append(pfad)
    nav = "".join(f'<a href="{u("/" + slug(k) + "/")}"{" aria-current=page" if k == aktiv else ""}>{e(k)}</a>' for k in kategorien())
    dg = {"mwst": CFG["mwst"], "modus": CFG["standard_modus"], "api": API, "mail": CFG["anfrage_email"], "basis": BASIS}
    return f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(titel)}</title><meta name="description" content="{e((beschreibung or CFG['claim'])[:160])}">
<link rel="canonical" href="{SITE_URL}{pfad}"><meta name="theme-color" content="#0A1628">
<meta property="og:title" content="{e(titel)}"><meta property="og:locale" content="de_DE">
{'' if index and not VORSCHAU else '<meta name="robots" content="noindex">'}
<link rel="stylesheet" href="{u('/stil.css')}"><link rel="icon" href="{u('/logo.svg')}">
<script>window.DG={json.dumps(dg)}</script><script src="{u('/shop.js')}" defer></script></head>
<body>
{'<div style="background:#F2B84B;color:#0A1628;text-align:center;font:600 14px/1.4 sans-serif;padding:8px 16px">Vorschau – noch kein echter Shop. Bestellungen werden nicht ausgeführt.</div>' if VORSCHAU else ''}
<div class="top g"><div class="in">
<form class="suche" action="{u('/suche/')}" role="search"><label class="sr" for="q">Suche</label><input id="q" name="q" placeholder="Suche nach Artikel, Artikelnummer oder Kategorie"><button>Suchen</button></form>
<div class="r"><a class="konto-link" href="{u('/konto/')}">Anmelden | Konto anlegen</a>
<div class="seg" role="group" aria-label="Preisanzeige"><button type="button" aria-pressed="true" data-modus="privat">Privat</button><button type="button" aria-pressed="false" data-modus="gewerbe">Gewerbe</button></div>
<a class="korb" href="{u('/warenkorb/')}">Warenkorb <b>0</b></a></div></div></div>
<header class="h g"><div class="in">
<svg class="seal" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="#B8C4D4" stroke-width="2"/><circle cx="50" cy="50" r="34" fill="none" stroke="#B8C4D4" stroke-width="1"/><path d="M30 56 L50 40 L70 56" fill="none" stroke="#22C3E6" stroke-width="3"/><text x="50" y="74" text-anchor="middle" font-family="Montserrat" font-size="7" font-weight="600" fill="#B8C4D4">EDELSTAHL</text><text x="50" y="30" text-anchor="middle" font-family="Montserrat" font-size="7" font-weight="600" fill="#B8C4D4">DOMO GASTRO</text></svg>
<div class="mid"><a class="logo" href="{u('/')}"><img src="{u('/logo.svg')}" alt="Domo Gastro – Zuhause in der Gastronomie" width="380" height="140"></a><nav aria-label="Kategorien">{nav}</nav></div>
<div class="rechts">Domo<small>GASTRONOMIE</small></div></div></header>
<main>{inhalt}</main>
<footer class="fuss g"><div class="in"><div class="spalten">
<div><img src="{u('/logo.svg')}" alt="Domo Gastro"><p>Zuhause in der Gastronomie. Profigeräte, Ausstattung und Zubehör für Gastronomie, Hotellerie und alle, die zu Hause wie Profis kochen.</p><p>{e(CFG['betreiber_zeile'])}</p></div>
<div><h3>Shop</h3><ul>{''.join(f'<li><a href="{u("/" + slug(k) + "/")}">{e(k)}</a></li>' for k in kategorien()[:6])}</ul></div>
<div><h3>Service</h3><ul><li><a href="{u('/konto/')}">Kundenkonto</a></li><li><a href="{u('/bestellung/')}">Bestellung verfolgen</a></li><li><a href="{u('/versand/')}">Versand und Zahlung</a></li><li><a href="{u('/kontakt/')}">Kontakt</a></li></ul></div>
<div><h3>Rechtliches</h3><ul><li><a href="{u('/impressum/')}">Impressum</a></li><li><a href="{u('/datenschutz/')}">Datenschutz</a></li><li><a href="{u('/agb/')}">AGB</a></li><li><a href="{u('/widerruf/')}">Widerrufsbelehrung</a></li></ul></div>
</div><p class="steuerhinweis"></p></div></footer>
</body></html>"""


def karte(p):
    b = p["bilder"][0] if p["bilder"] else ""
    pr = ab_preis(p)
    return (f'<a class="p" href="{u("/produkt/" + p["slug"] + "/")}" data-unter="{e(p["unterkategorie"])}" data-name="{e(p["name"])}" data-preis="{pr or ""}">'
            f'<div class="ph">{f"<img src={chr(34)}{e(b)}{chr(34)} alt={chr(34)}{chr(34)} loading=lazy>" if b else ""}</div>'
            f'<p class="n">{e(p["name"])}</p><span class="t">{e(p["hersteller"] or "")}{" · " + str(len(p["varianten"])) + " Breiten" if p["varianten"] else ""}</span>'
            f'{preis_html(pr, bool(p["varianten"]) and len(set(preise(p))) > 1)}</a>')


def produktseite(p):
    gas_strom = any(w in (p["name"] + " " + " ".join(p["merkmale"])).lower() for w in ("gas", "400 v", "400v", "400-v", "drehstrom"))
    if p["varianten"]:
        opts = "".join(
            f'<option value="{e(v["sku"])}" data-netto="{v["preis_netto"] or ""}" data-masse="{e(masse(v["masse_mm"]))}" '
            f'data-lieferzeit="{e(lieferzeit(v.get("lieferzeit_tage"), v.get("bestand")))}">Breite {v["breite_mm"]} mm</option>'
            for v in p["varianten"])
        wahl = f'<label>Breite der Haube <select class="variante">{opts}</select></label>'
        start = next((v for v in p["varianten"] if v["preis_netto"]), p["varianten"][0])
        netto, m, sku, lz = start["preis_netto"], masse(start["masse_mm"]), start["sku"], lieferzeit(start.get("lieferzeit_tage"), start.get("bestand"))
    else:
        wahl, netto, m, sku, lz = "", p.get("preis_netto"), masse(p["masse_mm"]), p["sku"], lieferzeit(p.get("lieferzeit_tage"), p.get("bestand"))
    preis = (f'<div class="preis-gross"><span class="pr" data-netto="{netto or 0:.2f}"{"" if netto else " hidden"}></span><span class="steuer" data-zusatz=", versandkostenfrei (DE)"{"" if netto else " hidden"}></span>'
             f'<span class="anfrage"{" hidden" if netto else ""}>Preis auf Anfrage</span></div>')
    kauf = (f'<div class="kauf"><label class="sr" for="menge">Menge</label><input id="menge" type="number" min="1" max="99" value="1">'
            f'<button class="btn pri kaufen" type="button" data-sku="{e(sku)}"{"" if netto else " disabled"}>In den Warenkorb</button>'
            f'<a class="btn sec" href="mailto:{CFG["anfrage_email"]}?subject={e("Anfrage " + p["name"])}">Anfrage stellen</a></div>')
    bilder = p["bilder"] or [""]
    daumen = "".join(f'<button type="button" data-bild="{e(b)}" aria-pressed="{str(i == 0).lower()}" aria-label="Bild {i + 1}"><img src="{e(b)}" alt="" loading="lazy"></button>'
                     for i, b in enumerate(bilder) if b) if len(bilder) > 1 else ""
    daten = [("Artikelnummer", f'<span class="sku">{e(sku)}</span>'), ("Hersteller", e(p["hersteller"] or "")),
             ("Maße", f'<span class="masse">{e(m)}</span>'), ("Kategorie", e(f'{p["kategorie"]} › {p["unterkategorie"]}'))]
    if p.get("energie"):
        en = p["energie"]
        daten.append(("Energieeffizienz", f'Klasse {e(str(en["klasse"]))}' + (f' · <a href="{e(en["label"])}">Energielabel</a>' if en.get("label") else "")
                      + (f' · <a href="{e(en["datenblatt"])}">Produktdatenblatt</a>' if en.get("datenblatt") else "")))
    if p.get("staffel_netto"):
        daten.append(("Staffelpreise netto", ", ".join(f'ab {n} Stk. {v:.2f} €'.replace(".", ",") for n, v in sorted(p["staffel_netto"].items()))))
    tabelle = "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in daten if v)
    hinweis = ('<p class="hinweis">Gas- und Starkstromgeräte dürfen nur von einem zugelassenen Fachbetrieb angeschlossen werden.</p>' if gas_strom else "")
    if p.get("spedition"):
        hinweis += '<p class="klein">Lieferung per Spedition bis Bordsteinkante. Die Spedition meldet sich vorab telefonisch.</p>'
    text = "".join(f"<p>{e(z)}</p>" for z in p["text"].split("\n"))
    if p.get("sicherheit"):
        text += f"<h3>Sicherheitshinweise</h3><p>{e(p['sicherheit'])}</p>"
    inhalt = f"""<div class="seite g"><div class="in">
<nav class="pfad" aria-label="Pfad"><a href="{u('/')}">Start</a> › <a href="{u('/' + slug(p['kategorie']) + '/')}">{e(p['kategorie'])}</a> › <a href="{u('/' + slug(p['kategorie']) + '/#' + p['unterkategorie'])}">{e(p['unterkategorie'])}</a></nav>
<article class="produkt" data-slug="{e(p['slug'])}">
<div class="bilder"><div class="gross">{f'<img src="{e(bilder[0])}" alt="{e(p["name"])}">' if bilder[0] else ''}</div><div class="daumen">{daumen}</div></div>
<div class="info"><h1>{e(p['name'])}</h1><p class="marke">{e(p['hersteller'] or '')}</p>
{wahl}{preis}
<div class="status-zeile"><span class="lieferzeit">{e(lz)}</span></div>
{kauf}{hinweis}
<ul class="merkmale">{''.join(f'<li>{e(x)}</li>' for x in p['merkmale'])}</ul>
<table class="tabelle">{tabelle}</table></div>
<div class="beschreibung"><h2 class="titel" style="font-size:28px">Beschreibung</h2>{text}</div>
<div class="bewertungen" id="bewertungen"><h2 class="titel" style="font-size:28px">Bewertungen <span class="schnitt sterne"></span></h2>
<p class="klein">Bewerten können nur angemeldete Kundinnen und Kunden, die dieses Produkt bei uns gekauft haben. Wir prüfen jede Bewertung vor der Veröffentlichung auf Echtheit und veröffentlichen positive wie negative Bewertungen.</p>
<div class="liste"></div>
<form class="kasten" style="margin-top:18px"><b>Produkt bewerten</b>
<fieldset class="sternwahl" style="border:0;padding:0"><legend class="sr">Sterne</legend>{''.join(f'<input type="radio" id="s{i}" name="sterne" value="{i}" required><label for="s{i}" title="{i} Sterne">★</label>' for i in range(5, 0, -1))}</fieldset>
<label>Überschrift <input type="text" name="titel" maxlength="80" required></label>
<label>Ihre Erfahrung <textarea name="text" rows="4" maxlength="2000" required></textarea></label>
<button class="btn pri" type="submit">Bewertung senden</button><p class="status" role="status"></p></form></div>
</article></div></div>"""
    return seite(f"{p['name']} | Domo Gastro", inhalt, f"/produkt/{p['slug']}/", p["text"][:155], p["kategorie"])


def startseite(nach_kat):
    ausgewaehlt, gesehen = [], set()
    for k in kategorien():
        for p in sorted((p for uk in nach_kat[k].values() for p in uk), key=lambda p: -(ab_preis(p) or 0)):
            if p["bilder"] and ab_preis(p) and "ts-systemtechnik.de" in p["bilder"][0] and p["unterkategorie"] not in gesehen:
                ausgewaehlt.append(p); gesehen.add(p["unterkategorie"]); break
    kacheln = "".join(
        f'<a class="c" href="{u("/" + slug(k) + "/")}"><div class="ph"><img src="{e(bild)}" alt="" loading="lazy"></div><b>{e(k)}</b><span>{e(KAT_TEXT.get(k, ""))} · {n} Produkte</span></a>'
        for k in kategorien()
        for n, bild in [(sum(len(v) for v in nach_kat[k].values()), next((p["bilder"][0] for v in nach_kat[k].values() for p in v if p["bilder"]), ""))])
    inhalt = f"""<div class="hero g"><div class="in">
<div class="copy"><div class="hand">Gute Gastronomie beginnt mit den richtigen Partnern!</div>
<h1>Alles für Profis mit <em>Geschmack.</em></h1>
<p class="lead">{len(PRODUKTE)} Profigeräte für Restaurant, Hotel, Café, Imbiss und die Küche zu Hause. Versandkostenfrei in ganz Deutschland, mit Preisen für Privat und Gewerbe.</p>
<div class="ctas"><a class="btn pri" href="{u('/' + slug(kategorien()[0]) + '/')}">Jetzt entdecken →</a><a class="btn sec" href="#bereiche">Sortiment ansehen</a></div></div>
<div class="domo"><img src="{u('/bilder/domo-koch.webp')}" alt="Domo, das Erdmännchen von Domo Gastro, als Koch" width="523" height="1100" fetchpriority="high"></div>
</div></div>
<div class="leiste g"><div class="in"><span>Für Restaurants</span><span>Für Hotels</span><span>Für Cafés</span><span>Für Imbisse</span><span>Für Catering</span><span>Für Zuhause</span></div></div>
<section class="g"><div class="in"><div class="sh"><h2>Ausgewählte Produkte</h2></div><div class="raster">{''.join(karte(p) for p in ausgewaehlt[:10])}</div></div></section>
<section class="cats g" id="bereiche"><div class="in"><div class="sh"><h2>Nach Bereich einkaufen</h2></div><div class="cg">{kacheln}</div></div></section>
<div class="ben g"><div class="in">
<div><svg viewBox="0 0 34 34" fill="none" stroke="#22C3E6" stroke-width="2" aria-hidden="true"><rect x="6" y="9" width="22" height="18" rx="2"/><path d="M6 14h22M12 9V6h10v3"/></svg><span>{len(PRODUKTE)} Profi-Artikel</span></div>
<div><svg viewBox="0 0 34 34" fill="none" stroke="#22C3E6" stroke-width="2" aria-hidden="true"><path d="M3 10h17v13H3zM20 15h6l5 5v3H20z"/><circle cx="9" cy="25" r="3"/><circle cx="25" cy="25" r="3"/></svg><span>Versandkostenfrei in Deutschland</span></div>
<div><svg viewBox="0 0 34 34" fill="none" stroke="#22C3E6" stroke-width="2" aria-hidden="true"><path d="M5 17h24M17 5v24"/><circle cx="17" cy="17" r="12"/></svg><span>Preise für Privat und Gewerbe</span></div>
<div><svg viewBox="0 0 34 34" fill="none" stroke="#22C3E6" stroke-width="2" aria-hidden="true"><path d="M6 26c0-6 5-9 11-9s11 3 11 9"/><circle cx="17" cy="10" r="5"/></svg><span>Beratung vom Fachhändler</span></div>
</div></div>"""
    return seite("Domo Gastro – Zuhause in der Gastronomie", inhalt, "/",
                 "Profigeräte für Gastronomie und Zuhause: Abzugshauben, Pizzaöfen, Fritteusen, Wärmetechnik und mehr. Preise für Privat und Gewerbe, versandkostenfrei in Deutschland.")


def kategorieseite(k, uk):
    alle = sorted((p for v in uk.values() for p in v), key=lambda p: (p["unterkategorie"], p["name"]))
    chips = '<button type="button" data-unter="" aria-pressed="true">Alle</button>' + "".join(
        f'<button type="button" data-unter="{e(un)}">{e(un)} ({len(v)})</button>' for un, v in sorted(uk.items()))
    inhalt = f"""<div class="seite g"><div class="in">
<nav class="pfad"><a href="{u('/')}">Start</a> › {e(k)}</nav><h1 class="titel">{e(k)}</h1><p class="klein">{e(KAT_TEXT.get(k, ''))}</p>
<div class="werkzeug"><div class="chips">{chips}</div>
<label style="display:flex;gap:8px;align-items:center;margin-left:auto">Sortieren <select id="sortierung"><option value="name">Name</option><option value="preis-auf">Preis aufsteigend</option><option value="preis-ab">Preis absteigend</option></select></label></div>
<div class="raster" data-filter>{''.join(karte(p) for p in alle)}</div></div></div>"""
    return seite(f"{k} | Domo Gastro", inhalt, f"/{slug(k)}/", f"{k}: {KAT_TEXT.get(k, '')}. Preise für Privat und Gewerbe.", k)


def warenkorb():
    return f"""<div class="seite g"><div class="in"><h1 class="titel">Warenkorb und Kasse</h1>
<div class="kasse" style="margin-top:24px"><div><div id="korb-liste"><p class="klein">Lädt …</p></div>
<form id="bestellung" hidden style="margin-top:28px">
<p class="klein" id="gast-hinweis">Sie bestellen als Gast. Ein Konto ist nicht nötig. <a href="{u('/konto/')}">Anmelden</a></p>
<p class="meldung nur-gewerbe" hidden>Sie bestellen als <b>Gewerbekunde</b>. Preise netto zzgl. MwSt.; es gilt kein Widerrufsrecht.</p>
<fieldset><legend>Rechnungs- und Lieferadresse</legend>
<label class="nur-gewerbe" hidden>Firma <input type="text" name="firma" autocomplete="organization"></label>
<label class="nur-gewerbe" hidden>USt-IdNr. (optional) <input type="text" name="ustid"></label>
<label>Vor- und Nachname <input type="text" name="name" required autocomplete="name"></label>
<label>Straße und Hausnummer <input type="text" name="strasse" required autocomplete="street-address"></label>
<div class="zwei"><label>PLZ <input type="text" name="plz" required pattern="[0-9]{{5}}" autocomplete="postal-code" inputmode="numeric"></label><label>Ort <input type="text" name="ort" required autocomplete="address-level2"></label></div>
<p class="klein">Wir liefern nur innerhalb Deutschlands.</p>
<label>E-Mail <input type="email" name="email" required autocomplete="email"></label>
<label>Telefon (für die Spedition) <input type="tel" name="telefon" autocomplete="tel"></label>
<label>Hinweis zur Bestellung (optional) <textarea name="hinweis" rows="2" maxlength="1000"></textarea></label></fieldset>
<fieldset><legend>Zahlungsart</legend>
<label class="check"><input type="radio" name="zahlart" value="Vorkasse" checked> Vorkasse per Überweisung (Bankverbindung kommt per E-Mail)</label>
<label class="check"><input type="radio" name="zahlart" value="PayPal"> PayPal oder Kreditkarte über PayPal (Sie werden zu PayPal weitergeleitet)</label></fieldset>
<label class="check"><input type="checkbox" name="konto_anlegen"> Kundenkonto anlegen (Bestellungen verfolgen, Produkte bewerten)</label>
<label id="pw-feld" hidden>Passwort für Ihr Konto (mind. 10 Zeichen) <input type="password" name="passwort" minlength="10" autocomplete="new-password"></label>
<label class="check"><input type="checkbox" name="agb" required> Ich habe die <a href="{u('/agb/')}" target="_blank">AGB</a> gelesen und akzeptiere sie. Die <a href="{u('/datenschutz/')}" target="_blank">Datenschutzerklärung</a> habe ich zur Kenntnis genommen.</label>
<p class="klein nur-privat">Als Verbraucher haben Sie ein gesetzliches Widerrufsrecht. Einzelheiten in der <a href="{u('/widerruf/')}" target="_blank">Widerrufsbelehrung</a>.</p>
<label class="check nur-gewerbe" hidden><input type="checkbox" name="gewerbe_bestaetigt"> Ich bestelle als Unternehmer (§ 14 BGB) für mein Gewerbe oder meine selbständige Tätigkeit.</label>
<button class="btn pri" type="submit">Zahlungspflichtig bestellen</button>
<p class="status" role="status"></p></form></div>
<aside id="summe" class="summe" hidden></aside></div></div></div>"""


def konto():
    return f"""<div class="seite g"><div class="in" id="konto" style="max-width:760px"><h1 class="titel">Kundenkonto</h1>
<div id="konto-meldung" style="margin:16px 0"></div>
<div class="reiter"><button type="button" data-ziel="anmelden" aria-pressed="true">Anmelden</button><button type="button" data-ziel="registrieren" aria-pressed="false">Konto anlegen</button><button type="button" data-ziel="vergessen" aria-pressed="false">Passwort vergessen</button></div>
<form id="anmelden" data-bereich="anmelden" class="kasten"><label>E-Mail <input type="email" name="email" required autocomplete="email"></label>
<label>Passwort <input type="password" name="passwort" required autocomplete="current-password"></label><button class="btn pri">Anmelden</button></form>
<form id="registrieren" data-bereich="registrieren" class="kasten" hidden><label>Vor- und Nachname <input type="text" name="name" required autocomplete="name"></label>
<label>E-Mail <input type="email" name="email" required autocomplete="email"></label>
<label>Passwort (mind. 10 Zeichen) <input type="password" name="passwort" minlength="10" required autocomplete="new-password"></label>
<label>Passwort wiederholen <input type="password" name="passwort2" minlength="10" required autocomplete="new-password"></label>
<label class="check"><input type="checkbox" name="datenschutz" required> Ich habe die <a href="{u('/datenschutz/')}">Datenschutzerklärung</a> zur Kenntnis genommen.</label>
<button class="btn pri">Konto anlegen</button><p class="klein">Bestellen geht auch ohne Konto, als Gast im Warenkorb.</p></form>
<form id="vergessen" data-bereich="vergessen" class="kasten" hidden><label>E-Mail <input type="email" name="email" required autocomplete="email"></label><button class="btn pri">Link zum Zurücksetzen senden</button></form>
<form id="neues-passwort" data-bereich="neu" class="kasten" hidden><label>Neues Passwort (mind. 10 Zeichen) <input type="password" name="passwort" minlength="10" required autocomplete="new-password"></label><button class="btn pri">Passwort speichern</button></form>
<div data-bereich="uebersicht" hidden>
<p>Angemeldet als <b id="konto-name"></b>. <button type="button" id="abmelden" class="ob">Abmelden</button></p>
<h2 class="titel" style="font-size:28px;margin-top:28px">Meine Bestellungen</h2><div id="meine-bestellungen"></div>
<h2 class="titel" style="font-size:28px;margin-top:28px">Meine Daten</h2>
<form id="profil" class="kasten"><label>Vor- und Nachname <input type="text" name="name"></label><label>Firma (optional) <input type="text" name="firma"></label>
<label>USt-IdNr. (optional) <input type="text" name="ustid"></label><label>Straße und Hausnummer <input type="text" name="strasse"></label>
<div class="zwei"><label>PLZ <input type="text" name="plz"></label><label>Ort <input type="text" name="ort"></label></div><label>Telefon <input type="tel" name="telefon"></label>
<button class="btn pri">Speichern</button></form>
<p style="margin-top:28px"><button type="button" id="loeschen" class="klein" style="text-decoration:underline">Konto löschen</button></p></div>
</div></div>"""


def bestellung():
    return f"""<div class="seite g"><div class="in" style="max-width:760px"><h1 class="titel">Bestellung verfolgen</h1>
<p class="klein">Ohne Konto: Bestellnummer und E-Mail-Adresse aus der Bestellbestätigung eingeben. Mit Konto sehen Sie alle Bestellungen unter <a href="{u('/konto/')}">Kundenkonto</a>.</p>
<form id="bestell-suche" class="kasten" style="margin:18px 0"><div class="zwei"><label>Bestellnummer <input type="text" name="nr" required placeholder="DG-…"></label><label>E-Mail <input type="email" name="email" required></label></div><button class="btn pri">Status anzeigen</button></form>
<div id="bestell-ergebnis"></div></div></div>"""


def suche():
    return """<div class="seite g"><div class="in"><h1 class="titel">Suche</h1><p id="anzahl" class="klein"></p><div class="raster" id="treffer" style="margin-top:20px"></div></div></div>"""


def textseite(titel, datei, pfad, beschreibung=""):
    inhalt = (RECHT / datei).read_text(encoding="utf-8") if (RECHT / datei).exists() else "<p class='platzhalter'>Text fehlt – so nicht veröffentlichen.</p>"
    return seite(f"{titel} | Domo Gastro", f'<div class="seite g"><div class="in text"><h1 class="titel">{titel}</h1>{inhalt}</div></div>', pfad, beschreibung)


def verwaltung():
    return f"""<div class="seite g"><div class="in" style="max-width:960px"><h1 class="titel">Verwaltung</h1>
<p class="klein">Bestellstatus setzen und Bewertungen freigeben. Zugang nur mit dem Verwaltungsschlüssel.</p>
<div id="verwaltung"></div></div></div><script src="{u('/verwaltung.js')}" defer></script>"""


def klartext(datei):
    """Rechtstext als reiner Text für die Bestätigungsmail (Textform, § 312f BGB)."""
    h = (RECHT / datei).read_text(encoding="utf-8")
    h = re.sub(r"<(h[1-6])[^>]*>(.*?)</\1>", lambda m: "\n\n" + re.sub(r"<[^>]+>", "", m.group(2)).upper() + "\n", h, flags=re.S)
    h = re.sub(r"<li[^>]*>", "\n  - ", h)
    h = re.sub(r"<br\s*/?>", "\n", h)
    h = re.sub(r"</(p|div|ul|ol|table|tr)>", "\n", h)
    h = re.sub(r"<a [^>]*href=\"(mailto:)?([^\"]+)\"[^>]*>(.*?)</a>", lambda m: m.group(3) if m.group(3) in m.group(2) else f"{m.group(3)} ({m.group(2)})", h, flags=re.S)
    h = html.unescape(re.sub(r"<[^>]+>", "", h))
    h = re.sub(r"[ \t]+", " ", h)
    h = re.sub(r" *\n *", "\n", h)
    return re.sub(r"\n{3,}", "\n\n", h).strip() + "\n"


def schreib(pfad, text):
    d = OUT / pfad.strip("/")
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.html").write_text(text, encoding="utf-8")


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT / "seite", OUT)
    if CNAME:
        (OUT / "CNAME").write_text(CNAME + "\n", encoding="utf-8")

    nach_kat = defaultdict(lambda: defaultdict(list))
    for p in PRODUKTE:
        nach_kat[p["kategorie"]][p["unterkategorie"]].append(p)

    (OUT / "index.html").write_text(startseite(nach_kat), encoding="utf-8")
    for k in kategorien():
        schreib(f"/{slug(k)}/", kategorieseite(k, nach_kat[k]))
    for p in PRODUKTE:
        schreib(f"/produkt/{p['slug']}/", produktseite(p))
    schreib("/warenkorb/", seite("Warenkorb | Domo Gastro", warenkorb(), "/warenkorb/", index=False))
    schreib("/konto/", seite("Kundenkonto | Domo Gastro", konto(), "/konto/", index=False))
    schreib("/bestellung/", seite("Bestellung verfolgen | Domo Gastro", bestellung(), "/bestellung/", index=False))
    schreib("/suche/", seite("Suche | Domo Gastro", suche(), "/suche/", index=False))
    schreib("/verwaltung/", seite("Verwaltung | Domo Gastro", verwaltung(), "/verwaltung/", index=False))
    for pfad, titel, datei in [("/impressum/", "Impressum", "impressum.html"), ("/datenschutz/", "Datenschutzerklärung", "datenschutz.html"),
                               ("/agb/", "Allgemeine Geschäftsbedingungen", "agb.html"), ("/widerruf/", "Widerrufsbelehrung", "widerruf.html"),
                               ("/versand/", "Versand und Zahlung", "versand.html"), ("/kontakt/", "Kontakt", "kontakt.html")]:
        schreib(pfad, textseite(titel, datei, pfad))
    (OUT / "404.html").write_text(seite("Seite nicht gefunden | Domo Gastro",
        f'<div class="seite g"><div class="in"><h1 class="titel">Seite nicht gefunden</h1><p><a href="{u("/")}">Zur Startseite</a> oder oben suchen.</p></div></div>', "/404", index=False), encoding="utf-8")

    # Index für Warenkorb und Suche (öffentlich, nur Verkaufspreise netto)
    artikel, liste = {}, []
    for p in PRODUKTE:
        b = p["bilder"][0] if p["bilder"] else ""
        if p["varianten"]:
            for v in p["varianten"]:
                artikel[v["sku"]] = {"n": f'{p["name"]}, Breite {v["breite_mm"]} mm', "p": v["preis_netto"], "s": p["slug"], "b": b,
                                     "l": lieferzeit(v.get("lieferzeit_tage")).replace("Lieferzeit ", ""), "sp": p.get("spedition", False)}
        else:
            artikel[p["sku"]] = {"n": p["name"], "p": p.get("preis_netto"), "s": p["slug"], "b": b,
                                 "l": lieferzeit(p.get("lieferzeit_tage")).replace("Lieferzeit ", ""), "sp": p.get("spedition", False)}
        liste.append({"s": p["slug"], "n": p["name"], "k": p["kategorie"], "u": p["unterkategorie"], "h": p["hersteller"], "p": ab_preis(p),
                      "ab": len(set(preise(p))) > 1, "b": b, "skus": [v["sku"] for v in p["varianten"]] or [p["sku"]]})
    (OUT / "produkte-index.json").write_text(json.dumps({"artikel": artikel, "produkte": liste}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Katalog für den Shop-Server: Preise prüft der Server selbst, nie der Browser
    worker = ROOT / "worker/src"
    katalog = {"artikel": {sku: {"n": a["n"], "p": a["p"], "s": a["s"]} for sku, a in artikel.items()},
               "produkte": {x["s"]: x["skus"] for x in liste}}
    (worker / "katalog.json").write_text(json.dumps(katalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (worker / "texte.json").write_text(json.dumps({"agb": klartext("agb.html"), "widerruf": klartext("widerruf.html")}, ensure_ascii=False, indent=1), encoding="utf-8")

    heute = date.today().isoformat()
    (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "".join(f"<url><loc>{SITE_URL}{p}</loc><lastmod>{heute}</lastmod></url>\n" for p in SEITEN) + "</urlset>\n", encoding="utf-8")
    if VORSCHAU:
        (OUT / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    else:
        (OUT / "robots.txt").write_text(f"User-agent: *\nDisallow: /konto/\nDisallow: /warenkorb/\nDisallow: /bestellung/\nDisallow: /verwaltung/\nSitemap: {SITE_URL}/sitemap.xml\n", encoding="utf-8")
    print(f"site/ gebaut: {len(PRODUKTE)} Produktseiten, {len(kategorien())} Kategorien, {len(artikel)} Artikelnummern, API {'an' if API else 'aus'}")


if __name__ == "__main__":
    main()
