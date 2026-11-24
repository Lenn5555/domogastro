-- Datenbank des Shop-Servers (Cloudflare D1, SQLite)
CREATE TABLE IF NOT EXISTS kunden (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  firma TEXT NOT NULL DEFAULT '', ustid TEXT NOT NULL DEFAULT '',
  strasse TEXT NOT NULL DEFAULT '', plz TEXT NOT NULL DEFAULT '', ort TEXT NOT NULL DEFAULT '', telefon TEXT NOT NULL DEFAULT '',
  pw_hash TEXT NOT NULL, pw_salz TEXT NOT NULL,
  erstellt TEXT NOT NULL
);
-- Anmeldungen und Links zum Zurücksetzen: nur der SHA-256 des Schlüssels wird gespeichert
CREATE TABLE IF NOT EXISTS sitzungen (hash TEXT PRIMARY KEY, kunde_id INTEGER NOT NULL, bis INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS zuruecksetzen (hash TEXT PRIMARY KEY, kunde_id INTEGER NOT NULL, bis INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bestellungen (
  nr TEXT PRIMARY KEY,
  kunde_id INTEGER,
  email TEXT NOT NULL,
  modus TEXT NOT NULL,
  kunde TEXT NOT NULL,        -- JSON: Adresse und Kontaktdaten
  positionen TEXT NOT NULL,   -- JSON: sku, name, menge, netto je Stück
  netto REAL NOT NULL, mwst REAL NOT NULL, brutto REAL NOT NULL,
  zahlart TEXT NOT NULL,
  status TEXT NOT NULL,       -- eingegangen, bezahlt, in_bearbeitung, versendet, zugestellt, storniert, zahlung_offen
  sendung TEXT NOT NULL DEFAULT '',
  paypal_id TEXT NOT NULL DEFAULT '', transaktion TEXT NOT NULL DEFAULT '',
  datum TEXT NOT NULL, aktualisiert TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bestellungen_kunde ON bestellungen(kunde_id);
CREATE TABLE IF NOT EXISTS bewertungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produkt TEXT NOT NULL, kunde_id INTEGER, name TEXT NOT NULL,
  sterne INTEGER NOT NULL, titel TEXT NOT NULL, text TEXT NOT NULL,
  verifiziert INTEGER NOT NULL DEFAULT 1, freigegeben INTEGER NOT NULL DEFAULT 0,
  datum TEXT NOT NULL,
  UNIQUE(produkt, kunde_id)
);
CREATE INDEX IF NOT EXISTS bewertungen_produkt ON bewertungen(produkt, freigegeben);
-- Einmalige Bitte um Bewertung per Mail (nur mit Kundenkonto und Zustimmung beim Bestellen)
CREATE TABLE IF NOT EXISTS bewertungsanfragen (nr TEXT PRIMARY KEY, faellig TEXT NOT NULL, gesendet TEXT NOT NULL DEFAULT '');
-- Gutscheine, einmal einlösbar: DG5- = Dank für Bewertung (bis 24.11.2026, nicht mehr vergeben), DGN- = Newsletter
CREATE TABLE IF NOT EXISTS gutscheine (
  code TEXT PRIMARY KEY, kunde_id INTEGER, bewertung_id INTEGER, prozent INTEGER NOT NULL,
  erstellt TEXT NOT NULL, eingeloest_nr TEXT NOT NULL DEFAULT '', eingeloest_am TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS gutscheine_bewertung ON gutscheine(bewertung_id);
-- Bewertungen erscheinen seit 2026-11-18 sofort (keine Freigabe mehr); ältere wartende einmalig freischalten
UPDATE bewertungen SET freigegeben = 1 WHERE freigegeben = 0;
-- Widerrufe (Widerrufsbutton, Lenn 2026-11-19): eingegangen → zurueck (Ware da) → erstattet
CREATE TABLE IF NOT EXISTS widerrufe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nr TEXT NOT NULL,
  positionen TEXT NOT NULL,   -- JSON: sku, name, menge
  grund TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  vorschlag REAL NOT NULL,    -- anteiliger Bruttobetrag der widerrufenen Artikel
  betrag REAL NOT NULL DEFAULT 0,
  datum TEXT NOT NULL, aktualisiert TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS widerrufe_nr ON widerrufe(nr);
-- Newsletter mit Double-Opt-in (Lenn 2026-11-24): offen → bestaetigt → abgemeldet. Nachweis: Wortlaut, Zeitpunkt und IP von Anmeldung und Bestätigung.
-- code: der einmalige Willkommens-Gutschein (DGN-…), bleibt auch nach Abmeldung stehen (nur ein Code je Adresse).
CREATE TABLE IF NOT EXISTS newsletter (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  quelle TEXT NOT NULL DEFAULT '',
  einwilligung TEXT NOT NULL,
  angemeldet TEXT NOT NULL, anmelde_ip TEXT NOT NULL DEFAULT '',
  bestaetigen_hash TEXT NOT NULL DEFAULT '', bestaetigen_bis INTEGER NOT NULL DEFAULT 0,
  bestaetigt TEXT NOT NULL DEFAULT '', bestaetigt_ip TEXT NOT NULL DEFAULT '',
  abmelde_schluessel TEXT NOT NULL,
  abgemeldet TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  mail_gesendet TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS newsletter_bestaetigen ON newsletter(bestaetigen_hash);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_abmelden ON newsletter(abmelde_schluessel);
-- Statistik ohne personenbezogene Daten: je Ereignis nur Zeitpunkt und Art (anmeldung, bestaetigung, abmeldung)
CREATE TABLE IF NOT EXISTS newsletter_ereignisse (id INTEGER PRIMARY KEY AUTOINCREMENT, datum TEXT NOT NULL, art TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS newsletter_ereignisse_datum ON newsletter_ereignisse(datum);
-- Monatlicher Newsletter (Lenn 2026-11-24): Ausgabe + Warteschlange, gedrosselt verschickt (Cron alle 10 Minuten)
CREATE TABLE IF NOT EXISTS newsletter_ausgaben (
  id INTEGER PRIMARY KEY AUTOINCREMENT, betreff TEXT NOT NULL, text TEXT NOT NULL,
  status TEXT NOT NULL,          -- laeuft, fertig, abgebrochen
  empfaenger INTEGER NOT NULL DEFAULT 0, gestartet TEXT NOT NULL, fertig TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS newsletter_versand (
  ausgabe_id INTEGER NOT NULL, email TEXT NOT NULL, gesendet TEXT NOT NULL DEFAULT '', ergebnis TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (ausgabe_id, email)
);
CREATE INDEX IF NOT EXISTS newsletter_versand_gesendet ON newsletter_versand(gesendet);
-- Bewertungen ohne Konto (Lenn 2026-11-24, ohne E-Mail-Bestätigung): Adresse je Bewertung (nie öffentlich, eine je Produkt) und Tageszähler je IP (gehasht, täglich gelöscht)
CREATE TABLE IF NOT EXISTS bewertung_mail (
  bewertung_id INTEGER PRIMARY KEY, produkt TEXT NOT NULL, email TEXT NOT NULL, erstellt TEXT NOT NULL,
  UNIQUE(produkt, email)
);
CREATE TABLE IF NOT EXISTS bewertung_ip (ip TEXT NOT NULL, tag TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS bewertung_ip_tag ON bewertung_ip(ip, tag);
