#!/usr/bin/env python3
"""Liest den METRO-Marketplace-Produktexport und schreibt daten/produkte.json für Domogastro.

- Texte ohne HTML, Merkmale als Liste, Maße in mm
- Eigene Kategorien (Schlagwort-Regeln), weil der Export meist keinen Kategorienamen hat
- Abzugshauben gleicher Bauart werden zu einem Produkt mit Breiten-Varianten zusammengefasst
- Auffälligkeiten (Dubletten, kurze Texte, fremde Bilder) landen in daten/pruefliste.csv

Preise stehen nicht im Metro-Export; sie kommen aus daten/preise.csv (Artikelnummer;Preis netto), sobald vorhanden.

Aufruf: python3 werkzeuge/import_metro.py [quelle/metro-export.xlsx]
"""
import csv
import html
import json
import re
import sys
import warnings
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
QUELLE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "quelle/metro-export.xlsx"
ZIEL = ROOT / "daten/produkte.json"
PRUEF = ROOT / "daten/pruefliste.csv"
PREISE = ROOT / "daten/preise.csv"

# Reihenfolge zählt: erste passende Regel gewinnt. (Kategorie, Unterkategorie, Muster im Namen)
REGELN = [
    ("Lüftung", "Haubenzubehör", r"belüftung|Flammschutzfilter|Ersatzfilter|LED-Einbauleuchte|Nano-LED"),
    ("Lüftung", "Abzugshauben", r"haube"),
    ("Lüftung", "Luftreiniger & Messgeräte", r"Luftreiniger|Luftqualit|CO2|CO₂|Messgerät"),
    ("Kochen", "Pizzaöfen", r"Pizzaofen"),
    ("Kochen", "Herde & Kochfelder", r"herd\b|Herd |Induktions|Wok"),
    ("Kochen", "Grillplatten & Grills", r"Grillplatte|Lavastein|Hähnchengrill|Vapor-Grill|Kebab"),
    ("Kochen", "Fritteusen", r"Fri?tt?eus|Fettabscheider|Air Fryer|Pommeswärmer"),
    ("Kochen", "Kessel, Pastakocher & Kippbratpfannen", r"Kochkessel|Pastakocher|Kippbratpfanne|Suppentopf"),
    ("Warmhalten & Ausgabe", "Tellerstapler", r"Stapler"),
    ("Warmhalten & Ausgabe", "Wärmelampen & Wärmebrücken", r"Wärmelampe|Wärmebrücke|Quarzlampe|Wärmestrahler|Standwärme"),
    ("Warmhalten & Ausgabe", "Warmhalteplatten & Bain Marie", r"Warmhalte|Heizplatte|Bain Marie|Chafing|Speisenwärmer|Suppen-"),
    ("Warmhalten & Ausgabe", "Ausgabe & Buffet", r"Theken-Trennwand|Zange für GN|Besteck|Wannenhalterung"),
    ("Spülen & Wasser", "Armaturen & Füller", r"füller|Brause|Schlauch|Wasserhahn|Spüler"),
    ("Spülen & Wasser", "Handwaschbecken", r"Handwaschbecken"),
    ("Hygiene & Waschraum", "Händetrockner", r"Händetrockner|Hände-?trock"),
    ("Hygiene & Waschraum", "Spender", r"spender|Spender"),
    ("Hygiene & Waschraum", "Waschraum-Ausstattung", r"Wickel|Haltegriff|Handgriff|Damenhygien"),
    ("Hygiene & Waschraum", "Abfall", r"Müll|Papierkorb|Abfall"),
    ("Möbel & Transport", "Regale & Untergestelle", r"Regal|Untergestell|Arbeitselement|Vorratsbehälter"),
    ("Möbel & Transport", "Wagen", r"wagen"),
    ("Möbel & Transport", "Theken", r"Tresen|Theke"),
    ("Terrasse & Raum", "Heizstrahler", r"Heizstrahler|Heizung"),
    ("Bar & Getränke", "Mixer & Bar", r"Mixer|Zitruspresse|Eis-?Crusher|Eiswürfel|Gläser-Kühl|Glühw|Wasserkocher|Kaffeemühle"),
    ("Küchenhelfer", "Küchenhelfer & Kleingeräte", r"."),
]


def ohne_html(text):
    t = re.sub(r"<\s*(br|/p|/li)\s*/?>", "\n", str(text or ""), flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return "\n".join(re.sub(r"[ \t]+", " ", z).strip() for z in t.splitlines() if z.strip())


def slug(s):
    s = s.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:80]


def zahl(v):
    try:
        return round(float(str(v).replace(",", ".")))
    except (TypeError, ValueError):
        return None


def kategorie(name):
    for k, u, m in REGELN:
        if re.search(m, name, re.I):
            return k, u
    return "Küchenhelfer", "Küchenhelfer & Kleingeräte"


def main():
    warnings.simplefilter("ignore")
    ws = openpyxl.load_workbook(QUELLE, data_only=True).active
    zeilen = list(ws.iter_rows(values_only=True))
    kopf = zeilen[6]
    spalten = defaultdict(list)
    for i, h in enumerate(kopf):
        spalten[h].append(i)
    daten = [z for z in zeilen[7:] if any(v is not None for v in z)]

    def feld(z, name, n=0):
        idx = spalten.get(name, [])
        return z[idx[n]] if n < len(idx) else None

    def alle(z, name):
        return [z[i] for i in spalten.get(name, []) if z[i] not in (None, "")]

    preise = {}
    if PREISE.exists():
        for r in csv.reader(PREISE.open(encoding="utf-8"), delimiter=";"):
            if len(r) >= 2 and zahl(r[1]) is not None:
                preise[r[0].strip()] = float(r[1].replace(",", "."))

    pruef = []
    artikel = []
    for z in daten:
        name = str(feld(z, "Product name DE")).strip()
        sku = str(feld(z, "MPN")).strip()
        k, u = kategorie(name)
        bilder = [str(b) for b in alle(z, "Image")]
        a = {
            "sku": sku,
            "gtin": feld(z, "GTIN"),
            "name": name,
            "kategorie": k,
            "unterkategorie": u,
            "text": ohne_html(feld(z, "Description DE")),
            "merkmale": [ohne_html(m) for m in alle(z, "Key feature DE")],
            "masse_mm": {
                "breite": zahl(feld(z, "Width")),
                "tiefe": zahl(feld(z, "Length")),
                "hoehe": zahl(feld(z, "Height")),
            },
            "bilder": bilder,
            "preis_netto": preise.get(sku),
            "sicherheit": ohne_html(feld(z, "Product safety instructions DE")) or None,
            "energie": {
                "klasse": feld(z, "Energy efficiency class"),
                "label": feld(z, "EU energy label"),
                "datenblatt": feld(z, "EU product data sheet DE"),
            } if feld(z, "Energy efficiency class") else None,
        }
        for einheit in ("Width unit", "Length unit", "Height unit"):
            if feld(z, einheit) not in (None, "mm"):
                pruef.append((sku, name, f"Einheit {einheit} = {feld(z, einheit)}"))
        if len(a["text"]) < 80:
            pruef.append((sku, name, f"Beschreibung sehr kurz ({len(a['text'])} Zeichen)"))
        if any("ts-systemtechnik.de" not in b for b in bilder):
            pruef.append((sku, name, "Bild von fremder Seite: Bildrechte klären"))
        artikel.append(a)

    for sku, n in Counter(a["sku"] for a in artikel).items():
        if n > 1:
            for a in artikel:
                if a["sku"] == sku:
                    pruef.append((sku, a["name"], f"Artikelnummer {n}x vorhanden"))
    for name, n in Counter(a["name"] for a in artikel).items():
        if n > 1:
            pruef.append(("", name, f"Produktname {n}x vorhanden (verschiedene Artikelnummern)"))

    # Abzugshauben: Familie = Name ohne „(Breite … mm)“, Varianten nach Breite
    produkte, familien = [], defaultdict(list)
    for a in artikel:
        m = re.search(r"\s*\(Breite (\d+) mm\)", a["name"])
        if a["unterkategorie"] == "Abzugshauben" and m:
            fam = re.sub(r"\s+", " ", a["name"].replace(m.group(0), "")).strip()
            familien[fam].append((int(m.group(1)), a))
        else:
            produkte.append(dict(a, varianten=[]))
    for fam, liste in familien.items():
        liste.sort(key=lambda x: x[0])
        basis = liste[0][1]
        produkte.append(dict(
            basis, sku=basis["sku"], name=fam,
            varianten=[{"breite_mm": b, "sku": a["sku"], "preis_netto": a["preis_netto"],
                        "masse_mm": a["masse_mm"], "bilder": a["bilder"]} for b, a in liste],
        ))

    belegt = Counter()
    for p in produkte:
        s = slug(p["name"])
        belegt[s] += 1
        p["slug"] = s if belegt[s] == 1 else f"{s}-{slug(p['sku'])}"

    produkte.sort(key=lambda p: (p["kategorie"], p["unterkategorie"], p["name"]))
    ZIEL.parent.mkdir(exist_ok=True)
    ZIEL.write_text(json.dumps({
        "_hinweis": "Erzeugt aus dem METRO-Produktexport mit werkzeuge/import_metro.py. Preise netto in EUR aus daten/preise.csv; leer = noch kein Preis.",
        "produkte": produkte,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    with PRUEF.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Artikelnummer", "Name", "Hinweis"])
        w.writerows(pruef)

    print(f"{len(artikel)} Zeilen → {len(produkte)} Produkte ({len(familien)} Haubenfamilien), "
          f"{sum(1 for a in artikel if a['preis_netto'])} mit Preis, {len(pruef)} Prüfhinweise")
    for (k, u), n in sorted(Counter((p["kategorie"], p["unterkategorie"]) for p in produkte).items()):
        print(f"  {k} › {u}: {n}")


if __name__ == "__main__":
    main()
