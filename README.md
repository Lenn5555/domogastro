# Domo Gastro

Website für Gastronomie-Technik von T&S Systemtechnik („Zuhause in der Gastronomie“). Verkauf an Gewerbe und Privat mit Schalter (Gewerbe: netto zzgl. MwSt., Privat: brutto inkl. MwSt.). Aufbau nach dem Muster von beinundfuss.de: statische Seite (GitHub Pages), später Cloudflare Worker für Bestellung, Resend für Mails, PayPal und Vorkasse.

| Ordner | Inhalt |
| --- | --- |
| `quelle/metro-export.xlsx` | Produktdaten aus METRO Marketplace (ohne Preise) |
| `quelle/metro-angebote.xlsx` | METRO-Angebotsexport: Nettopreis, Bestand, Bearbeitungszeit, Spedition, Hersteller |
| `werkzeuge/import_metro.py` | Export → `daten/produkte.json`: Texte ohne HTML, eigene Kategorien, Abzugshauben als Modelle mit Breiten-Varianten |
| `daten/produkte.json` | 523 Produkte (aus 888 Zeilen), Preise netto aus dem Angebotsexport |
| `daten/pruefliste.csv` | Auffälligkeiten: doppelte Artikelnummern/Namen, kurze Texte, fremde Bilder |
| `daten/site.json` | Einstellungen (Adresse, MwSt., Standardmodus) |
| `seite/` | Stil, Schriften, Logo, Domo-Bild, Shop-Skript (Warenkorb, Konto, Bestellverfolgung, Bewertungen), Verwaltung |
| `werkzeuge/build_site.py` | Baut die ganze Seite nach `site/` und den Katalog/die Rechtstexte für den Server |
| `daten/rechtstexte/` | Impressum, Datenschutz, AGB (Privat + Gewerbe), Widerruf mit Muster-Formular, Versand, Kontakt |
| `worker/` | Shop-Server (Cloudflare Worker + D1): Konto, Gast-Bestellung, Bestellstatus, Bewertungen, Verwaltung, PayPal, Resend |
| `.github/workflows/` | Veröffentlichen nur von Hand (Website auf GitHub Pages, Server auf Cloudflare) |

## Lokal ansehen

```
python3 werkzeuge/build_site.py            # ohne Server: Bestellung öffnet vorbereitete E-Mail
cd site && python3 -m http.server 8000     # http://localhost:8000
```

Mit Server (alles lokal, kein Konto nötig):

```
cd worker && npm install
npx wrangler d1 execute domogastro --local --file=schema.sql
echo VERWALTUNG_SCHLUESSEL=test > .dev.vars
npx wrangler dev --port 8787               # Mails werden nur ins Protokoll geschrieben
SITE_API=http://localhost:8787 python3 werkzeuge/build_site.py   # im Hauptordner
npm test                                   # nach dem Bauen (braucht worker/src/katalog.json)
```

## Was der Shop kann

- Bestellen als Gast oder mit Konto; Konto auch direkt beim Bestellen anlegen.
- Konto: anmelden, Passwort vergessen (Link per Mail), Daten ändern, Konto löschen (Bestellungen bleiben wegen Aufbewahrungspflicht).
- Bestellung verfolgen: mit Konto in der Übersicht, ohne Konto mit Bestellnummer + E-Mail.
- Bewertungen: nur Kunden, die das Produkt bezahlt gekauft haben; erscheinen erst nach Freigabe unter `/verwaltung/`.
- Preise rechnet nur der Server (aus dem Katalog), PayPal wird vor dem Einziehen auf Betrag und Bestellnummer geprüft.
- Keine Cookies, keine Tracker. Warenkorb und Anmeldung im Browser-Speicher (localStorage).

## Vor dem Start (erst nach Lenns Okay)

Cloudflare-Konto + D1-Datenbank (ID in `worker/wrangler.toml`), Secrets `RESEND_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `VERWALTUNG_SCHLUESSEL`; Resend-Domain mit SPF/DKIM/DMARC; Domain (ohne Umlaute) und `CNAME`; GitHub Pages auf „GitHub Actions“; Rechtstexte anwaltlich prüfen; VerpackG (LUCID) und ElektroG für Privatkunden prüfen.

Preise kommen aus `quelle/metro-angebote.xlsx` (Zuordnung über Artikelnummer). Einzelne Preise abweichend von Metro: `daten/preise.csv` mit `Artikelnummer;Preis netto` anlegen. Danach `python3 werkzeuge/import_metro.py` neu ausführen.

Einkaufspreise und Lieferanten gehören nie ins Repo (öffentlich), nur in GitHub-Secrets.

Noch offen: 58 Artikel ohne Preis (erscheinen als „Preis auf Anfrage“). Nichts wird veröffentlicht, bevor Lenn zustimmt.
