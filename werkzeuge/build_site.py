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


def _nur_mit_preis(produkte):
    """Artikel ohne Preis kommen nicht in den Shop (Lenn 2026-11-19). Varianten ohne Preis fallen weg,
    Produkte ohne bepreiste Variante ganz. Die Daten bleiben in produkte.json, sobald ein Preis da ist, erscheinen sie wieder."""
    aus = []
    for p in produkte:
        if p.get("varianten"):
            v = [x for x in p["varianten"] if x.get("preis_netto")]
            if v:
                aus.append({**p, "varianten": v})
        elif p.get("preis_netto"):
            aus.append(p)
    return aus


PRODUKTE = _nur_mit_preis(PRODUKTE)
LAENDER = json.loads((ROOT / "daten/laender.json").read_text(encoding="utf-8"))
NEWSLETTER = json.loads((ROOT / "daten/newsletter.json").read_text(encoding="utf-8"))  # Newsletter mit Double-Opt-in (Lenn 2026-11-24)
AKTION = {k: v for k, v in json.loads((ROOT / "daten/aktion.json").read_text(encoding="utf-8")).items() if k != "hinweis"}  # Preisaktion (Black Week)

# Auslandsversand (Lenn 2026-11-19): Gewichte gibt es noch nicht, deshalb grob aus den Außenmaßen geschätzt
# (ca. 120 kg je m³ umbauter Raum, Gastro-Geräte aus Edelstahl). Ohne Maße 5 kg. Sehr lange oder schwere Teile gehen per Spedition (sp, nur Info).
_ELEKTRO = re.compile(r"\b\d[\d.,]*\s*(W|kW|Watt)\b|\d\s*V\b|Volt|\bHz\b|Motor|elektr|Stecker|Leuchtmittel|\bLED|Akku|(?<!misch)batterie|Automatisch|Sensor|Thermostat", re.I)
# Gas- oder Starkstromgerät (Hinweis „nur vom Fachbetrieb anschließen“); „Gastro…“ zählt nicht
_GAS_STROM = re.compile(r"\bgas(?!tro)|erdgas|flüssiggas|propan|\b400\s*-?\s*v\b|drehstrom|starkstrom", re.I)


def versandangaben(p, breite=None):
    m = p.get("masse_mm") or {}
    seiten = [x for x in (breite or m.get("breite"), m.get("tiefe"), m.get("hoehe")) if x]
    if len(seiten) == 3:
        kg = max(0.3, round(seiten[0] * seiten[1] * seiten[2] / 1e6 * 0.12, 1))
    else:
        kg = 5.0
    lang = max(seiten) if seiten else 0
    sp = bool(p.get("spedition")) or kg > 31.5 or lang > 1200
    text = " ".join(p.get("merkmale") or []) + " " + p["name"] + " " + (p.get("text") or "")
    return {"g": kg, "sp": sp, "el": bool(_ELEKTRO.search(text))}


def laender_tabelle():
    """Versandpreise je Land für die Seite „Versand und Zahlung“ (netto und für Privatkunden mit MwSt. des Lieferlandes)."""
    def geld(x):
        return f"{x:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")
    zeilen = []
    for l in LAENDER["laender"]:
        if not l["zone"]:
            continue
        z = LAENDER["zonen"][l["zone"]]
        f = 1 + l["mwst"] / 100 if LAENDER["oss"] else 1.19
        f = 1 if not l["eu"] else f
        zeilen.append(f"<tr><td>{e(l['n'])}</td><td>{geld(z['paket'])}</td><td>{geld(round(z['paket'] * f, 2))}</td></tr>")
    return ("<div style='overflow-x:auto'><table class='tabelle'><thead><tr><th>Lieferland</th><th>je Bestellung, netto</th><th>Privat inkl. MwSt.</th></tr></thead><tbody>"
            + "".join(zeilen) + "</tbody></table></div>")



def shopping_feed():
    """Produktdaten für Google Merchant Center (Google Shopping), Lenn 2026-11-20: site/google-shopping.xml.
    Preise brutto inkl. 19 % (Deutschland), während einer Preisaktion zusätzlich sale_price mit Zeitraum.
    Varianten (Haubenbreiten) als eigene Artikel mit item_group_id; der Link wählt die Variante vor (?v=SKU)."""
    from datetime import datetime, timedelta, timezone
    from xml.sax.saxutils import escape as x
    mwst = CFG["mwst"]
    bis = AKTION.get("bis")
    aktion = AKTION.get("prozent") and bis and datetime.fromisoformat(bis.replace("Z", "+00:00")) > datetime.now(timezone.utc)

    def r2(v):
        return float(f"{v + 1e-9:.2f}")

    def brutto(n):
        return f"{r2(n * (1 + mwst)):.2f} EUR"

    def textfeld(t):
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t or "")).strip()[:4900]

    def marke(h):
        return "T&S Systemtechnik" if h.startswith("T&S") else h

    def eintrag(p, sku, name, netto, bestand, lz, bilder, gtin, gruppe=None):
        if not netto or not bilder:
            return ""
        link = f"{SITE_URL}/produkt/{p['slug']}/" + (f"?v={sku}" if gruppe else "")
        if bestand:
            verf = "<g:availability>in_stock</g:availability>"
        else:
            tage = max(lz) if isinstance(lz, list) and lz else 14
            ab = (date.today() + timedelta(days=int(tage))).isoformat()
            verf = f"<g:availability>backorder</g:availability><g:availability_date>{ab}T12:00:00+01:00</g:availability_date>"
        t = [f"<g:id>{x(sku)}</g:id>", f"<title>{x(name[:150])}</title>",
             f"<description>{x(textfeld(p.get('text')) or name)}</description>",
             f"<link>{x(link)}</link>", f"<g:image_link>{x(bilder[0])}</g:image_link>",
             *[f"<g:additional_image_link>{x(b)}</g:additional_image_link>" for b in bilder[1:10]],
             verf, f"<g:price>{brutto(netto)}</g:price>", "<g:condition>new</g:condition>",
             f"<g:brand>{x(marke(p['hersteller']))}</g:brand>",
             f"<g:product_type>{x(p['kategorie'] + ' > ' + p['unterkategorie'])}</g:product_type>"]
        if aktion and sku in AKTION.get("ohne_streichpreis", []):
            # Preis während der Aktion erhöht: rabattierten Preis als normalen Preis melden, kein sale_price (kein Streichpreis)
            t = [z.replace(f"<g:price>{brutto(netto)}</g:price>", f"<g:price>{brutto(r2(netto * (100 - AKTION['prozent']) / 100))}</g:price>") for z in t]
        elif aktion:
            neu = r2(netto * (100 - AKTION["prozent"]) / 100)
            t += [f"<g:sale_price>{brutto(neu)}</g:sale_price>",
                  f"<g:sale_price_effective_date>{AKTION['von']}/{AKTION['bis']}</g:sale_price_effective_date>"]
        if gtin and str(gtin) not in ("None", ""):
            t.append(f"<g:gtin>{x(str(gtin))}</g:gtin>")
        else:
            t.append("<g:identifier_exists>no</g:identifier_exists>")
        if gruppe:
            t.append(f"<g:item_group_id>{x(gruppe)}</g:item_group_id>")
        if p.get("spedition"):
            t.append("<g:shipping_label>spedition</g:shipping_label>")
        return "<item>" + "".join(t) + "</item>"

    items = []
    for p in PRODUKTE:
        if p["varianten"]:
            for v in p["varianten"]:
                items.append(eintrag(p, v["sku"], f'{p["name"]}, Breite {v["breite_mm"]} mm', v.get("preis_netto"), v.get("bestand"),
                                     v.get("lieferzeit_tage"), v.get("bilder") or p["bilder"], None, gruppe=p["sku"]))
        else:
            items.append(eintrag(p, p["sku"], p["name"], p.get("preis_netto"), p.get("bestand"), p.get("lieferzeit_tage"), p["bilder"], p.get("gtin")))
    gesehen, eindeutig = set(), []  # manche Artikelnummern stehen in zwei Produkten: nur einmal melden
    for i in items:
        k = re.search(r"<g:id>(.*?)</g:id>", i)
        if k and k.group(1) not in gesehen:
            gesehen.add(k.group(1)); eindeutig.append(i)
    items = eindeutig
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>'
           f'<title>{x(CFG["name"])}</title><link>{SITE_URL}/</link><description>{x(CFG["claim"])}</description>\n'
           + "\n".join(items) + "\n</channel></rss>\n")
    (OUT / "google-shopping.xml").write_text(xml, encoding="utf-8")
    return len(items)

def rechnen_js():
    """seite/rechnen.js für den Browser aus worker/src/steuer.js (gleiche Rechnung wie auf dem Server)."""
    q = (ROOT / "worker/src/steuer.js").read_text(encoding="utf-8").replace("export function", "function")
    namen = re.findall(r"^function (\w+)", q, re.M)
    (ROOT / "seite/rechnen.js").write_text(f"/* erzeugt von build_site.py aus worker/src/steuer.js, nicht von Hand ändern */\nwindow.DGR = (function () {{\n{q}\nreturn {{ {', '.join(namen)} }};\n}})();\n", encoding="utf-8")
RECHT = ROOT / "daten/rechtstexte"
BASIS = os.environ.get("SITE_BASIS", "").rstrip("/")
API = (os.environ.get("SITE_API") or CFG.get("api", "")).rstrip("/")
CNAME = (ROOT / "CNAME").read_text(encoding="utf-8").strip() if (ROOT / "CNAME").exists() else ""
SITE_URL = f"https://{CNAME}" if CNAME else "https://lenn5555.github.io/domogastro"
# Vorschau: für Suchmaschinen gesperrt, mit Hinweisleiste oben (SITE_VORSCHAU=ja)
VORSCHAU = os.environ.get("SITE_VORSCHAU", "") == "ja"
e = html.escape
SEITEN = []

KAT_TEXT = {
    "Lüftung": "Wand-, Kasten- und Deckenhauben nach Maß, Filter und Luftreiniger",
    "Kochen": "Herde, Pizzaöfen, Grillplatten und Fritteusen",
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


def uv(pfad):
    """Wie u(), aber mit Inhalts-Prüfsumme, damit Browser nach Änderungen nicht die alte Datei aus dem Cache nehmen."""
    import hashlib
    datei = ROOT / "seite" / pfad.lstrip("/")
    return f"{u(pfad)}?v={hashlib.sha1(datei.read_bytes()).hexdigest()[:8]}" if datei.exists() else u(pfad)


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


BF_TITEL = "Stellfüße & Einschlagfüße"


def stellfuesse():
    """Eigene Seite für den Spezialshop beinundfuss.de (Menüpunkt und Kachel bei „Nach Bereich einkaufen“)."""
    return f"""<div class="seite g"><div class="in" style="max-width:1100px">
<nav class="pfad" aria-label="Pfad"><a href="{u('/')}">Start</a> › {e(BF_TITEL)}</nav>
<p class="kicker">Unser Spezialshop</p><h1 class="titel">Stellfüße und Einschlagfüße</h1>
<a class="bf-bild" href="https://beinundfuss.de/" target="_blank" rel="noopener"><img src="{u('/bilder/beinundfuss-fuesse.webp')}" alt="Stellfüße, Edelstahl-Stellbeine und Einschlagfüße von Beinundfuß" width="1344" height="390"></a>
<div class="bf-text">
<p>Gerätefüße gibt es bei uns in einem eigenen Shop: <b>beinundfuss.de</b>. Dort finden Sie Stellfüße, Einschlagfüße, Maschinenfüße und Edelstahl-Stellbeine für Gastro-Geräte, Kühlmöbel, Arbeitstische und Maschinen.</p>
<ul class="merkmale"><li>Stellfüße mit Gewinde, höhenverstellbar, aus Edelstahl oder verzinktem Stahl</li><li>Einschlagfüße und Rohrstopfen für Rund- und Vierkantrohre</li><li>Ein Berater findet den passenden Fuß nach Gewinde, Last und Boden</li><li>Feste Nettopreise, direkt bestellen</li></ul>
<p class="klein">Beinundfuß verkauft an Gewerbekunden und ist wie Domo Gastro ein Shop der T&amp;S Systemtechnik GmbH.</p>
<a class="btn pri" href="https://beinundfuss.de/" target="_blank" rel="noopener">Zu beinundfuss.de</a></div></div></div>"""


# Lenn 2026-11-23: Google zeigte das transparente Logo.svg (dunkel auf Karo) als Bild/Kleinbild. Darum eigenes Icon auf Navy + Logo-Angabe für Google.
LD_START = '<script type="application/ld+json">' + json.dumps([
    {"@context": "https://schema.org", "@type": "WebSite", "name": "Domo Gastro", "url": SITE_URL + "/"},
    {"@context": "https://schema.org", "@type": "Organization", "name": "Domo Gastro", "url": SITE_URL + "/", "logo": SITE_URL + "/icon-512.png", "image": SITE_URL + "/logo-teilen.png"},
], ensure_ascii=False) + '</script>'


def seite(titel, inhalt, pfad, beschreibung="", aktiv="", index=True):
    if index:
        SEITEN.append(pfad)
    nav = "".join(f'<a href="{u("/" + slug(k) + "/")}"{" aria-current=page" if k == aktiv else ""}>{e(k)}</a>' for k in kategorien())
    nav += f'<a href="{u("/stellfuesse/")}"{" aria-current=page" if aktiv == BF_TITEL else ""}>{e(BF_TITEL)}</a>'
    dg = {"mwst": CFG["mwst"], "modus": CFG["standard_modus"], "api": API, "mail": CFG["anfrage_email"], "basis": BASIS, "versand": LAENDER, "ads": CFG.get("google_ads_id", ""), "adsKauf": CFG.get("google_ads_kauf_label", ""), "aktion": AKTION}
    return f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(titel)}</title><meta name="description" content="{e((beschreibung or CFG['claim'])[:160])}">
<link rel="canonical" href="{SITE_URL}{pfad}"><meta name="theme-color" content="#0A1628">
<meta property="og:title" content="{e(titel)}"><meta property="og:locale" content="de_DE">
{'' if index and not VORSCHAU else '<meta name="robots" content="noindex">'}
<meta property="og:type" content="website"><meta property="og:site_name" content="Domo Gastro"><meta property="og:url" content="{SITE_URL}{pfad}"><meta property="og:image" content="{SITE_URL}/logo-teilen.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<link rel="stylesheet" href="{uv('/stil.css')}"><link rel="icon" href="{u('/favicon.ico')}" sizes="48x48"><link rel="icon" href="{u('/favicon.svg')}" type="image/svg+xml"><link rel="apple-touch-icon" href="{u('/apple-touch-icon.png')}"><link rel="manifest" href="{u('/site.webmanifest')}">
{LD_START if pfad == "/" else ""}
<script>window.DG={json.dumps(dg)}</script><script src="{uv('/rechnen.js')}" defer></script><script src="{uv('/shop.js')}" defer></script></head>
<body>
{'<div style="background:#F2B84B;color:#0A1628;text-align:center;font:600 14px/1.4 sans-serif;padding:8px 16px">Vorschau – noch kein echter Shop. Bestellungen werden nicht ausgeführt.</div>' if VORSCHAU else ''}
<p class="aktion-band aktion-hinweis" hidden></p>
<div class="top g"><div class="in">
<form class="suche" action="{u('/suche/')}" role="search"><label class="sr" for="q">Suche</label><input id="q" name="q" placeholder="Suche nach Artikel, Artikelnummer oder Kategorie"><button>Suchen</button></form>
<div class="r"><a class="konto-link" href="{u('/konto/')}">Anmelden | Konto anlegen</a>
<div class="seg" role="group" aria-label="Preisanzeige"><button type="button" aria-pressed="true" data-modus="privat">Privat</button><button type="button" aria-pressed="false" data-modus="gewerbe">Gewerbe</button></div>
<a class="korb" href="{u('/warenkorb/')}">Warenkorb <b>0</b></a></div></div></div>
<header class="h g"><div class="in">
<div class="mid"><a class="logo" href="{u('/')}"><img src="{u('/logo.svg')}" alt="Domo Gastro – Zuhause in der Gastronomie" width="380" height="140"></a><nav aria-label="Kategorien">{nav}</nav></div></div></header>
<main>{inhalt}</main>
<footer class="fuss g"><div class="in">{newsletter_fuss()}<div class="spalten">
<div><img src="{u('/logo.svg')}" alt="Domo Gastro"><p>Zuhause in der Gastronomie. Profigeräte, Ausstattung und Zubehör für Gastronomie, Hotellerie und alle, die zu Hause wie Profis kochen.</p><p>{e(CFG['betreiber_zeile'])}</p><p class="klein">WEEE-Reg.-Nr. {e(CFG['weee'])}</p></div>
<div><h3>Shop</h3><ul>{''.join(f'<li><a href="{u("/" + slug(k) + "/")}">{e(k)}</a></li>' for k in kategorien()[:6])}</ul></div>
<div><h3>Service</h3><ul><li><a href="{u('/konto/')}">Kundenkonto</a></li><li><a href="{u('/bestellung/')}">Bestellung verfolgen</a></li><li><a href="{u('/widerrufen/')}">Vertrag widerrufen</a></li><li><a href="{u('/versand/')}">Versand und Zahlung</a></li><li><a href="{u('/kontakt/')}">Kontakt</a></li><li><a href="{u('/newsletter/')}">Newsletter</a></li><li><a href="{u('/karriere/')}">Karriere</a></li><li><a href="#" class="einw-oeffnen">Cookie-Einstellungen</a></li></ul></div>
<div><h3>Rechtliches</h3><ul><li><a href="{u('/impressum/')}">Impressum</a></li><li><a href="{u('/datenschutz/')}">Datenschutz</a></li><li><a href="{u('/agb/')}">AGB</a></li><li><a href="{u('/widerruf/')}">Widerrufsbelehrung</a></li><li><a href="{u('/entsorgung/')}">Entsorgung und Batterien</a></li></ul></div>
</div><p class="steuerhinweis"></p></div></footer>
</body></html>"""


def nl_einwilligung():
    """Wortlaut der Einwilligung (wird bei jeder Anmeldung gespeichert), mit Link zur Datenschutzerklärung."""
    return e(NEWSLETTER["einwilligung"]).replace("Datenschutzerklärung", f'<a href="{u("/datenschutz/#newsletter")}">Datenschutzerklärung</a>')


def nl_mindestwert():
    m = NEWSLETTER.get("mindestwert_netto") or 0
    return f" (ab {m:.2f} € Warenwert netto)".replace(".", ",") if m else ""


def nl_formular(klasse=""):
    return (f'<form class="nl-form {klasse}"><label class="sr" for="nl-email-{klasse or "f"}">E-Mail-Adresse</label>'
            f'<input id="nl-email-{klasse or "f"}" type="email" name="email" required autocomplete="email" placeholder="Ihre E-Mail-Adresse">'
            f'<button class="btn pri">Anmelden</button></form>'
            f'<p class="klein nl-text">Mit „Anmelden“ erklären Sie: {nl_einwilligung()}</p><p class="nl-status klein" role="status"></p>')


def newsletter_fuss():
    p = NEWSLETTER["prozent"]
    return (f'<div class="nl-fuss"><div><h3>Newsletter: {p} % Willkommensrabatt</h3>'
            f'<p>Angebote, Neuheiten und Tipps für Ihre Gastronomie, {e(NEWSLETTER["haeufigkeit"])}. Nach der Bestätigung per E-Mail bekommen Sie einmalig '
            f'einen persönlichen {p}-%-Gutscheincode{nl_mindestwert()}. Abmelden jederzeit mit einem Klick.</p></div>'
            f'<div>{nl_formular()}</div></div>')


def newsletter_seite():
    p = NEWSLETTER["prozent"]
    return (f'<div class="seite g"><div class="in" style="max-width:760px"><h1 class="titel">Newsletter</h1>'
            f'<div id="nl-seite"></div>'
            f'<div class="nl-info"><p>Mit unserem Newsletter erfahren Sie zuerst von Angeboten, neuen Geräten und Aktionen und bekommen Tipps rund um die Gastronomie-Ausstattung, '
            f'{e(NEWSLETTER["haeufigkeit"])}.</p>'
            f'<p><b>{p} % Willkommensrabatt:</b> Nach der Anmeldung schicken wir Ihnen eine E-Mail mit einem Bestätigungslink. Erst nach Ihrem Klick sind Sie eingetragen und bekommen '
            f'einmalig einen persönlichen {p}-%-Gutscheincode für Ihre nächste Bestellung{nl_mindestwert()}. Der Code gilt einmal, nur einer je E-Mail-Adresse, und ist nicht mit anderen Gutscheinen oder laufenden Rabattaktionen kombinierbar.</p>'
            f'<p><b>Abmelden</b> können Sie sich jederzeit mit einem Klick über den Link unten in jeder E-Mail.</p>'
            f'<div class="kasten" style="margin-top:18px">{nl_formular("seite")}</div></div></div></div>')


def karriere_seite():
    mail = CFG["anfrage_email"]
    betreff = "Bewerbung bei Domo Gastro"
    link = f"mailto:{mail}?subject=" + betreff.replace(" ", "%20")
    return (f'<div class="seite g"><div class="in karriere" style="max-width:860px">'
            f'<div class="karriere-kopf"><div><h1 class="titel">Karriere bei Domo Gastro</h1>'
            f'</div>'
            f'<img src="{u("/bilder/domo-start.webp")}" alt="Domo, das Erdmännchen von Domo Gastro" width="138" height="250" loading="lazy"></div>'
            f'<h2>Offene Stellen</h2>'
            f'<p>Gerade schreiben wir keine feste Stelle aus.</p>'
            f'<div class="kasten karriere-trotzdem"><h2>Keine passende Stelle dabei? Bewirb dich trotzdem!</h2>'
            f'<p>Gute Leute finden bei uns immer ihren Platz. Wenn du Lust auf Gastronomie, Technik oder Onlinehandel hast, wollen wir dich kennenlernen.</p><ul>'
            f'<li><b>Echte Verantwortung:</b> Bei uns zählt, was du anpackst.</li>'
            f'<li><b>Kurze Wege:</b> Entscheidungen fallen schnell und direkt.</li>'
            f'<li><b>Raum für Ideen:</b> Wir probieren gern Neues aus.</li>'
            f'<li><b>Zusammenhalt:</b> Ein Team, das füreinander da ist.</li></ul>'
            f'<p>Schick uns ein paar Zeilen über dich und deinen Lebenslauf.</p>'
            f'<p><a class="btn pri" href="{e(link)}">Jetzt bewerben</a></p>'
            f'<p class="klein">Per E-Mail an {e(mail)}. Wir freuen uns über jede Bewerbung (m/w/d), unabhängig von Herkunft, Geschlecht, Alter, Religion, Behinderung oder sexueller Identität. '
            f'Wie wir mit deinen Daten umgehen, steht in unserer <a href="{u("/datenschutz/#bewerbungen")}">Datenschutzerklärung</a>.</p></div>'
            f'</div></div>')


def karte(p):
    b = p["bilder"][0] if p["bilder"] else ""
    pr = ab_preis(p)
    return (f'<a class="p" href="{u("/produkt/" + p["slug"] + "/")}" data-unter="{e(p["unterkategorie"])}" data-name="{e(p["name"])}" data-preis="{pr or ""}">'
            f'<div class="ph">{f"<img src={chr(34)}{e(b)}{chr(34)} alt={chr(34)}{chr(34)} loading=lazy>" if b else ""}</div>'
            f'<p class="n">{e(p["name"])}</p><span class="t">{e(p["hersteller"] or "")}{" · " + str(len(p["varianten"])) + " Breiten" if p["varianten"] else ""}</span>'
            f'{preis_html(pr, bool(p["varianten"]) and len(set(preise(p))) > 1)}</a>')


def produktseite(p):
    gas_strom = bool(_GAS_STROM.search(p["name"] + " " + " ".join(p["merkmale"])))
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
             f'<span class="anfrage"{" hidden" if netto else ""}>Preis auf Anfrage</span></div><p class="klein aktion-hinweis" hidden></p>')
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
<div class="liste"></div>
<p class="klein bew-hinweis" style="margin-top:18px"></p>
<form class="kasten" hidden style="margin-top:18px"><b>Bewertung schreiben</b>
<p class="klein bew-verifiziert" hidden>Sie kommen über den Link aus unserer E-Mail: Ihre Bewertung wird als „Verifizierter Kauf“ gekennzeichnet.</p>
<fieldset class="sternwahl" style="border:0;padding:0"><legend style="font-weight:600;font-size:14px;margin-bottom:2px;width:100%">Gesamtbewertung *</legend>{''.join(f'<input type="radio" id="s{i}" name="sterne" value="{i}" required><label for="s{i}" title="{i} Sterne">★</label>' for i in range(5, 0, -1))}</fieldset>
<div class="bew-gast"><label>Vorname * <input type="text" name="name" maxlength="40" autocomplete="given-name"></label>
<label class="bew-mail-feld">E-Mail (freiwillig, wird nicht veröffentlicht) <input type="email" name="email" autocomplete="email"><span class="klein" style="font-weight:400">Nur nötig, wenn Sie den Newsletter möchten oder wir Sie bei Rückfragen zu Ihrer Bewertung erreichen dürfen. Das Zeichen „Verifizierter Kauf“ gibt es über Ihr Kundenkonto oder den Link in unserer E-Mail nach der Lieferung.</span></label></div>
<label class="hp" aria-hidden="true">Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
<label>Zusammenfassung (optional) <input type="text" name="titel" maxlength="80"></label>
<label>Ihre Erfahrung (optional) <textarea name="text" rows="4" maxlength="2000"></textarea></label>
<label class="check nl-kasse nl-bew" hidden><input type="checkbox" name="newsletter"> <span>Newsletter (freiwillig, mit {NEWSLETTER['prozent']} % Willkommensrabatt): {nl_einwilligung()} Sie bekommen zuerst eine E-Mail zur Bestätigung.</span></label>
<button class="btn pri" type="submit">Bewertung abschicken</button><p class="status" role="status"></p>
<p class="klein bew-gast">oder <a href="{u('/konto/')}">mit Ihrem Konto anmelden</a></p></form>
<details class="klein bew-echtheit" style="margin-top:14px"><summary>Wie prüfen wir Bewertungen?</summary>
<p>Bewerten kann jede Person, ohne Kauf, ohne Kundenkonto und auf Wunsch ohne E-Mail-Adresse. Bewertungen erscheinen sofort. Das Zeichen „Verifizierter Kauf“ erhalten nur Bewertungen, bei denen wir den Kauf dieses Produkts bei uns geprüft haben: über das Kundenkonto, mit dem das Produkt gekauft und bezahlt wurde, oder über den persönlichen Link in unserer E-Mail nach der Lieferung. Bei allen anderen Bewertungen prüfen wir nicht, ob die Person das Produkt gekauft oder genutzt hat. Die E-Mail-Adresse veröffentlichen wir nicht. Wir zeigen positive wie negative Bewertungen und löschen nur Beiträge, die gegen unsere Regeln verstoßen oder erkennbar gefälscht sind. Für Bewertungen gewähren wir keine Gegenleistung; ältere Bewertungen, für die wir uns bis zum 24.11.2026 mit einem Gutschein bedankt haben, sind gekennzeichnet.</p></details></div>
</article></div></div>"""
    return seite(f"{p['name']} | Domo Gastro", inhalt, f"/produkt/{p['slug']}/", p["text"][:155], p["kategorie"])


def startseite(nach_kat):
    ausgewaehlt, gesehen = [], set()
    for k in kategorien():
        for p in sorted((p for uk in nach_kat[k].values() for p in uk), key=lambda p: -(ab_preis(p) or 0)):
            if p["bilder"] and ab_preis(p) and p["unterkategorie"] not in gesehen:
                ausgewaehlt.append(p); gesehen.add(p["unterkategorie"]); break
    kacheln = "".join(
        f'<a class="c" href="{u("/" + slug(k) + "/")}"><div class="ph"><img src="{e(bild)}" alt="" loading="lazy"></div><b>{e(k)}</b><span>{e(KAT_TEXT.get(k, ""))}</span></a>'
        for k in kategorien()
        for n, bild in [(sum(len(v) for v in nach_kat[k].values()), next((p["bilder"][0] for v in nach_kat[k].values() for p in v if p["bilder"]), ""))])
    kacheln += (f'<a class="c" href="{u("/stellfuesse/")}"><div class="ph"><img src="{u("/bilder/stellfuesse-drei.webp")}" alt="" loading="lazy"></div>'
                f'<b>{e(BF_TITEL)}</b><span>Unser Spezialshop beinundfuss.de</span></a>')
    inhalt = f"""<div class="hero g"><div class="in">
<div class="copy"><div class="hand">Gute Gastronomie beginnt mit den richtigen Partnern!</div>
<h1>Alles für Profis mit <em>Geschmack.</em></h1>
<p class="lead">Profigeräte für Restaurant, Hotel, Café, Imbiss und die Küche zu Hause. Versandkostenfrei in ganz Deutschland, mit Preisen für Privat und Gewerbe.</p>
<div class="ctas"><a class="btn pri" href="{u('/' + slug(kategorien()[0]) + '/')}">Jetzt entdecken →</a><a class="btn sec" href="#bereiche">Sortiment ansehen</a></div></div>
<div class="domo"><div class="domo-figur" data-ruhe="{u('/bilder/domo-ruhe.mp4')}" data-winken="{u('/bilder/domo-winken.mp4')}" data-lauf-start="{u('/bilder/domo-lauf-start.mp4')}" data-lauf="{u('/bilder/domo-lauf.mp4')}" data-lauf-ende="{u('/bilder/domo-lauf-ende.mp4')}"><img src="{u('/bilder/domo-start.webp')}" alt="Domo, das Erdmännchen von Domo Gastro, als Koch" width="552" height="1000" fetchpriority="high"><canvas width="1700" height="1000" aria-hidden="true"></canvas></div></div>
<script src="{uv('/domo.js')}" defer></script>
</div></div>
<div class="leiste g"><div class="in"><span>Für Restaurants</span><span>Für Hotels</span><span>Für Cafés</span><span>Für Imbisse</span><span>Für Catering</span><span>Für Zuhause</span></div></div>
<section class="g" id="auswahl"><div class="in"><div class="sh"><h2>Ausgewählte Produkte</h2></div><div class="raster">{''.join(karte(p) for p in ausgewaehlt[:10])}</div></div></section>
<section class="cats g" id="bereiche"><div class="in"><div class="sh"><h2>Nach Bereich einkaufen</h2></div><div class="cg">{kacheln}</div></div></section>
<div class="ben g"><div class="in">
<div><svg viewBox="0 0 34 34" fill="none" stroke="#22C3E6" stroke-width="2" aria-hidden="true"><rect x="6" y="9" width="22" height="18" rx="2"/><path d="M6 14h22M12 9V6h10v3"/></svg><span>Profi-Qualität für Küche und Gastronomie</span></div>
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
{ratgeber_hinweis(k)}
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
<label class="lieferland">Lieferland <select name="land" autocomplete="shipping country"><option value="DE">Deutschland</option></select></label>
<p class="klein" id="land-hinweis" hidden>Versand ins Ausland: fester Versandpreis je Bestellung und Land. <a href="{u('/versand/')}">Alle Versandpreise</a></p>
<div class="meldung" id="gewerbe-tipp" hidden><p><strong>Bestellen Sie als Unternehmen?</strong> Mit einer gültigen USt-IdNr. aus dem Lieferland liefern wir ohne Umsatzsteuer (steuerfreie innergemeinschaftliche Lieferung). Schalten Sie dazu auf Gewerbe und geben Sie Firma und USt-IdNr. ein; wir prüfen die Nummer sofort bei der EU.</p><button class="btn sec" type="button" id="gewerbe-wechsel">Als Unternehmen bestellen</button></div>
<div class="adressen">
<fieldset><legend>Rechnungsadresse</legend>
<label class="nur-gewerbe" hidden>Firma <input type="text" name="firma" autocomplete="billing organization"></label>
<label class="nur-gewerbe" hidden>USt-IdNr. (optional; im EU-Ausland für Lieferung ohne MwSt.) <input type="text" name="ustid" autocomplete="off" spellcheck="false"></label>
<p class="klein nur-gewerbe" id="ustid-status" role="status" hidden></p>
<label>Vor- und Nachname <input type="text" name="name" required autocomplete="billing name"></label>
<label>Straße und Hausnummer <input type="text" name="strasse" required autocomplete="billing street-address"></label>
<div class="zwei"><label>PLZ <input type="text" name="plz" required pattern="[0-9]{{5}}" autocomplete="billing postal-code" inputmode="numeric"></label><label>Ort <input type="text" name="ort" required autocomplete="billing address-level2"></label></div>
<label>E-Mail (Pflicht, für die Bestellbestätigung) <input type="email" name="email" required autocomplete="email"></label>
<p class="klein werbehinweis">Wir nutzen Ihre E-Mail-Adresse auch, um Ihnen Angebote zu ähnlichen Produkten aus unserem Shop zu senden. Sie können dem jederzeit widersprechen, z. B. per Abmeldelink in jeder Mail oder an <a href="mailto:{e(CFG['anfrage_email'])}">{e(CFG['anfrage_email'])}</a>, ohne dass andere als die Übermittlungskosten nach den Basistarifen entstehen.</p>
<label class="check klein"><input type="checkbox" name="keine_werbung"> Ich möchte keine Angebote per E-Mail erhalten.</label>
<label>Telefon (für Spedition und Paketdienst) <input type="tel" name="telefon" autocomplete="tel"></label></fieldset>
<fieldset><legend>Lieferadresse</legend>
<label class="check"><input type="checkbox" name="gleich" checked> Lieferadresse ist gleich Rechnungsadresse</label>
<div id="liefer" class="liefer" hidden>
<label>Firma (optional) <input type="text" name="l_firma" autocomplete="shipping organization"></label>
<label>Vor- und Nachname <input type="text" name="l_name" autocomplete="shipping name"></label>
<label>Straße und Hausnummer <input type="text" name="l_strasse" autocomplete="shipping street-address"></label>
<div class="zwei"><label>PLZ <input type="text" name="l_plz" pattern="[0-9]{{5}}" autocomplete="shipping postal-code" inputmode="numeric"></label><label>Ort <input type="text" name="l_ort" autocomplete="shipping address-level2"></label></div></div>
</fieldset></div>
<label style="display:block;margin-top:14px">Hinweis zur Bestellung (optional) <textarea name="hinweis" rows="2" maxlength="1000"></textarea></label>
<div class="gutschein"><label>Gutscheincode (optional) <input type="text" name="gutschein" autocomplete="off" spellcheck="false" style="text-transform:uppercase"></label><button class="btn sec" type="button" id="gutschein-los">Einlösen</button></div>
<p class="klein" id="gutschein-status" role="status"></p>
<fieldset><legend>Zahlungsart</legend>
<label class="check zahlart"><input type="radio" name="zahlart" value="Vorkasse" checked> <span><b>Überweisung (Vorkasse)</b><br><span class="klein">Die Bankverbindung kommt per E-Mail, wir versenden nach Zahlungseingang.</span></span></label>
<label class="check zahlart sofort-art" hidden><input type="radio" name="zahlart" value="Kreditkarte"> <span><b>Kreditkarte</b><br><span class="klein">Sofort bezahlen mit Visa, Mastercard und weiteren Karten, sicher abgewickelt über PayPal. Ein PayPal-Konto ist nicht nötig.</span></span></label>
<label class="check zahlart sofort-art" hidden><input type="radio" name="zahlart" value="PayPal"> <span><b>PayPal</b><br><span class="klein">Sofort bezahlen mit Ihrem PayPal-Konto.</span></span></label></fieldset>
<label class="check"><input type="checkbox" name="konto_anlegen"> Kundenkonto anlegen (Bestellungen verfolgen)</label>
<label id="pw-feld" hidden>Passwort für Ihr Konto (mind. 10 Zeichen) <input type="password" name="passwort" minlength="10" autocomplete="new-password"></label>
<label class="check nl-kasse nl-bew" hidden><input type="checkbox" name="newsletter"> <span>Newsletter (freiwillig, mit {NEWSLETTER['prozent']} % Willkommensrabatt): {nl_einwilligung()} Sie bekommen zuerst eine E-Mail zur Bestätigung.</span></label>
<label class="check" id="bew-mail" hidden><input type="checkbox" name="bewertungsmail"> Ja, erinnern Sie mich nach der Lieferung einmal per E-Mail daran, die Artikel zu bewerten (freiwillig).</label>
<label class="check"><input type="checkbox" name="agb" required> Ich habe die <a href="{u('/agb/')}" target="_blank">AGB</a> gelesen und akzeptiere sie. Die <a href="{u('/datenschutz/')}" target="_blank">Datenschutzerklärung</a> habe ich zur Kenntnis genommen.</label>
<p class="klein nur-privat">Als Verbraucher haben Sie ein gesetzliches Widerrufsrecht. Einzelheiten in der <a href="{u('/widerruf/')}" target="_blank">Widerrufsbelehrung</a>.</p>
<label class="check nur-gewerbe" hidden><input type="checkbox" name="gewerbe_bestaetigt"> Ich bestelle als Unternehmer (§ 14 BGB) für mein Gewerbe oder meine selbständige Tätigkeit.</label>
<div id="sofort" class="sofort" hidden><p class="sofort-summe"></p><div id="paypal-knoepfe"></div></div>
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


def widerrufen():
    return f"""<div class="seite g"><div class="in" style="max-width:760px"><h1 class="titel">Vertrag widerrufen</h1>
<p>Als Verbraucher können Sie Ihren Kauf innerhalb von 14 Tagen ab Erhalt der Ware ohne Angabe von Gründen widerrufen. Hier geht das direkt online: Bestellnummer und E-Mail-Adresse aus der Bestellbestätigung eingeben, Artikel wählen, bestätigen. Sie bekommen sofort eine Eingangsbestätigung per E-Mail. Einzelheiten stehen in der <a href="{u('/widerruf/')}">Widerrufsbelehrung</a>.</p>
<form id="widerruf-suche" class="kasten" style="margin:18px 0"><div class="zwei"><label>Bestellnummer <input type="text" name="nr" required placeholder="DG-…"></label><label>E-Mail <input type="email" name="email" required></label></div><button class="btn pri">Weiter</button></form>
<div id="widerruf-ergebnis"></div></div></div>"""


def suche():
    return """<div class="seite g"><div class="in"><h1 class="titel">Suche</h1><p id="anzahl" class="klein"></p><div class="raster" id="treffer" style="margin-top:20px"></div></div></div>"""


# Ratgeber (Lenn 2026-11-24 freigegeben): Text in daten/ratgeber/<slug>.html, verlinkt aus der Kategorie
RATGEBER = [
    {"slug": "abzugshaube-gastrokueche", "kategorie": "Lüftung",
     "h1": "Welche Abzugshaube passt in deine Gastroküche?",
     "titel": "Abzugshaube für die Gastroküche: Größe, Bauform, Motor | Domo Gastro",
     "beschreibung": "Wandhaube, Kastenhaube oder Deckenhaube? Mit oder ohne Motor? So findest du die passende Gastro-Abzugshaube für deine Küche.",
     "teaser": "Wand-, Kasten- oder Deckenhaube, mit oder ohne Motor: So findest du die passende Haube in vier Schritten."},
]


def ratgeberseite(r):
    pfad = f"/ratgeber/{r['slug']}/"
    text = (ROOT / "daten/ratgeber" / f"{r['slug']}.html").read_text(encoding="utf-8")
    text = text.replace("<!--MAIL-->", e(CFG["anfrage_email"])).replace('href="/', f'href="{BASIS}/')
    k = r["kategorie"]
    inhalt = (f'<div class="seite g"><div class="in text ratgeber"><nav class="pfad"><a href="{u("/")}">Start</a> › '
              f'<a href="{u("/" + slug(k) + "/")}">{e(k)}</a> › Ratgeber</nav><h1 class="titel">{e(r["h1"])}</h1>{text}</div></div>')
    return seite(r["titel"], inhalt, pfad, r["beschreibung"], k)


def ratgeber_hinweis(k):
    return "".join(f'<a class="ratgeber-hinweis" href="{u("/ratgeber/" + r["slug"] + "/")}"><b>Ratgeber: {e(r["h1"])}</b><span>{e(r["teaser"])}</span></a>'
                   for r in RATGEBER if r["kategorie"] == k)


def textseite(titel, datei, pfad, beschreibung=""):
    inhalt = (RECHT / datei).read_text(encoding="utf-8") if (RECHT / datei).exists() else "<p class='platzhalter'>Text fehlt – so nicht veröffentlichen.</p>"
    inhalt = inhalt.replace('href="/', f'href="{BASIS}/')
    inhalt = inhalt.replace("<!--LAENDER-->", laender_tabelle())  # Links in Rechtstexten auch unter /domogastro/ (Vorschau)
    return seite(f"{titel} | Domo Gastro", f'<div class="seite g"><div class="in text"><h1 class="titel">{titel}</h1>{inhalt}</div></div>', pfad, beschreibung)


def verwaltung():
    return f"""<div class="seite g"><div class="in" style="max-width:960px"><h1 class="titel">Verwaltung</h1>
<p class="klein">Bestellstatus setzen und Bewertungen verwalten. Zugang nur mit dem Verwaltungsschlüssel.</p>
<div id="verwaltung"></div></div></div><script src="{uv('/verwaltung.js')}" defer></script>"""


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
    rechnen_js()
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
    schreib("/stellfuesse/", seite(f"{BF_TITEL} | Domo Gastro", stellfuesse(), "/stellfuesse/",
                                    "Stellfüße, Einschlagfüße und Maschinenfüße: unser Spezialshop beinundfuss.de.", BF_TITEL))
    schreib("/warenkorb/", seite("Warenkorb | Domo Gastro", warenkorb(), "/warenkorb/", index=False))
    schreib("/konto/", seite("Kundenkonto | Domo Gastro", konto(), "/konto/", index=False))
    schreib("/bestellung/", seite("Bestellung verfolgen | Domo Gastro", bestellung(), "/bestellung/", index=False))
    schreib("/widerrufen/", seite("Vertrag widerrufen | Domo Gastro", widerrufen(), "/widerrufen/", index=False))
    schreib("/newsletter/", seite(f"Newsletter mit {NEWSLETTER['prozent']} % Willkommensrabatt | Domo Gastro", newsletter_seite(), "/newsletter/",
                                   f"Angebote, Neuheiten und Tipps für die Gastronomie, {NEWSLETTER['haeufigkeit']}. Nach der Anmeldung einmalig {NEWSLETTER['prozent']} % Rabatt."))
    schreib("/karriere/", seite("Karriere | Domo Gastro", karriere_seite(), "/karriere/",
                                 "Jobs bei Domo Gastro in Pfungstadt: Keine passende Stelle dabei? Bewirb dich trotzdem."))
    schreib("/suche/", seite("Suche | Domo Gastro", suche(), "/suche/", index=False))
    schreib("/verwaltung/", seite("Verwaltung | Domo Gastro", verwaltung(), "/verwaltung/", index=False))
    for pfad, titel, datei in [("/impressum/", "Impressum", "impressum.html"), ("/datenschutz/", "Datenschutzerklärung", "datenschutz.html"),
                               ("/agb/", "Allgemeine Geschäftsbedingungen", "agb.html"), ("/widerruf/", "Widerrufsbelehrung", "widerruf.html"),
                               ("/versand/", "Versand und Zahlung", "versand.html"), ("/kontakt/", "Kontakt", "kontakt.html"),
                               ("/entsorgung/", "Entsorgung von Altgeräten, Batterien und Verpackungen", "entsorgung.html")]:
        schreib(pfad, textseite(titel, datei, pfad))
    for r in RATGEBER:
        schreib(f"/ratgeber/{r['slug']}/", ratgeberseite(r))
    (OUT / "404.html").write_text(seite("Seite nicht gefunden | Domo Gastro",
        f'<div class="seite g"><div class="in"><h1 class="titel">Seite nicht gefunden</h1><p><a href="{u("/")}">Zur Startseite</a> oder oben suchen.</p></div></div>', "/404", index=False), encoding="utf-8")

    # Index für Warenkorb und Suche (öffentlich, nur Verkaufspreise netto)
    artikel, liste = {}, []
    for p in PRODUKTE:
        b = p["bilder"][0] if p["bilder"] else ""
        if p["varianten"]:
            for v in p["varianten"]:
                artikel[v["sku"]] = {"n": f'{p["name"]}, Breite {v["breite_mm"]} mm', "p": v["preis_netto"], "s": p["slug"], "b": b,
                                     "l": lieferzeit(v.get("lieferzeit_tage")).replace("Lieferzeit ", ""), **versandangaben(p, v.get("breite_mm"))}
        else:
            artikel[p["sku"]] = {"n": p["name"], "p": p.get("preis_netto"), "s": p["slug"], "b": b,
                                 "l": lieferzeit(p.get("lieferzeit_tage")).replace("Lieferzeit ", ""), **versandangaben(p)}
        liste.append({"s": p["slug"], "n": p["name"], "k": p["kategorie"], "u": p["unterkategorie"], "h": p["hersteller"], "p": ab_preis(p),
                      "ab": len(set(preise(p))) > 1, "b": b, "skus": [v["sku"] for v in p["varianten"]] or [p["sku"]]})
    (OUT / "produkte-index.json").write_text(json.dumps({"artikel": artikel, "produkte": liste}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Katalog für den Shop-Server: Preise prüft der Server selbst, nie der Browser
    worker = ROOT / "worker/src"
    kat_von = {x["s"]: x["k"] for x in liste}  # Kategorie je Produkt: Bestandskunden-Werbung nur zu ähnlichen Produkten (§ 7 Abs. 3 UWG)
    katalog = {"artikel": {sku: {"n": a["n"], "p": a["p"], "s": a["s"], "g": a["g"], "sp": a["sp"], "el": a["el"], "k": kat_von.get(a["s"], "")} for sku, a in artikel.items()},
               "produkte": {x["s"]: x["skus"] for x in liste}}
    (worker / "katalog.json").write_text(json.dumps(katalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Katalog für den KI-Berater: nur öffentliche Angaben (Name, Kategorie, Hersteller, Merkmale, Maße, Netto-Preis)
    def merkmalText(p):
        m = p.get("merkmale") or []
        m = m if isinstance(m, list) else [f"{k}: {v}" for k, v in m.items()]
        return "; ".join(str(x) for x in m[:6])[:300]
    def masse(p):
        m = p.get("masse_mm") or {}
        return " × ".join(f"{k[0].upper()} {v}" for k, v in m.items() if v) + " mm" if m else ""
    berater = []
    for p in PRODUKTE:
        if p["varianten"]:
            w = [v["preis_netto"] for v in p["varianten"]]
            preis = f'{min(w):.2f} bis {max(w):.2f} € je nach Breite (Breiten: {", ".join(str(v["breite_mm"]) for v in p["varianten"])} mm)'
        else:
            preis = f'{p["preis_netto"]:.2f} €'
        berater.append({"s": p["slug"], "n": p["name"], "k": f'{p["kategorie"]} / {p["unterkategorie"]}', "h": p["hersteller"],
                        "m": merkmalText(p), "ma": "" if p["varianten"] else masse(p), "p": preis})
    (worker / "berater.json").write_text(json.dumps(berater, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Rechtstexte als PDF-Anhang der Bestellbestätigung (Base64), nicht mehr im Mailtext
    from pdf_text import pdf
    import base64
    b64 = lambda titel, datei: base64.b64encode(pdf(titel, klartext(datei))).decode()
    (worker / "texte.json").write_text(json.dumps({
        "agb_pdf": b64("Allgemeine Geschäftsbedingungen – Domo Gastro", "agb.html"),
        "widerruf_pdf": b64("Widerrufsbelehrung und Muster-Widerrufsformular – Domo Gastro", "widerruf.html"),
        # Logo für den Mailkopf (weiß auf Navy, 2x), wird als Inline-Bild (cid:logo) mitgeschickt
        "logo_png": base64.b64encode((ROOT / "werkzeuge" / "logo-mail.png").read_bytes()).decode(),
    }), encoding="utf-8")

    heute = date.today().isoformat()
    print(f"google-shopping.xml: {shopping_feed()} Artikel")
    (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "".join(f"<url><loc>{SITE_URL}{p}</loc><lastmod>{heute}</lastmod></url>\n" for p in SEITEN) + "</urlset>\n", encoding="utf-8")
    if VORSCHAU:
        (OUT / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    else:
        gesperrt = "Disallow: /konto/\nDisallow: /warenkorb/\nDisallow: /bestellung/\nDisallow: /widerrufen/\nDisallow: /verwaltung/\n"
        # Das transparente Logo.svg nicht in der Google-Bildersuche zeigen (wirkt dort dunkel auf Karo), stattdessen logo-teilen.png / icon-512.png
        (OUT / "robots.txt").write_text(f"User-agent: *\n{gesperrt}\nUser-agent: Googlebot-Image\n{gesperrt}Disallow: /logo.svg\n\nSitemap: {SITE_URL}/sitemap.xml\n", encoding="utf-8")
    print(f"site/ gebaut: {len(PRODUKTE)} Produktseiten, {len(kategorien())} Kategorien, {len(artikel)} Artikelnummern, API {'an' if API else 'aus'}")


if __name__ == "__main__":
    main()
