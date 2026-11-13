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
