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
| `seite/logo.svg` | Logo, zugeschnitten aus der Druck-PDF |

Preise kommen aus `quelle/metro-angebote.xlsx` (Zuordnung über Artikelnummer). Einzelne Preise abweichend von Metro: `daten/preise.csv` mit `Artikelnummer;Preis netto` anlegen. Danach `python3 werkzeuge/import_metro.py` neu ausführen.

Einkaufspreise und Lieferanten gehören nie ins Repo (öffentlich), nur in GitHub-Secrets.

Noch offen: Design (Auswahl läuft), 58 Artikel ohne Preis, Rechtstexte für B2B + B2C, Bestell-Worker. Nichts wird veröffentlicht, bevor Lenn zustimmt.
