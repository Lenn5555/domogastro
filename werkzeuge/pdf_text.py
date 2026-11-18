"""Kleiner PDF-Schreiber ohne Abhängigkeiten: reiner Text, A4, Helvetica (WinAnsi), automatische Seiten.

Für die Rechtstexte im Anhang der Bestellmail (Textform, § 312f BGB).
Zeilen, die nur aus Großbuchstaben bestehen, werden als fette Überschrift gesetzt.
"""
import textwrap

ERSATZ = {"−": "-", "‑": "-", " ": " ", "→": "->", "≥": ">=", "≤": "<=", " ": " ", " ": " "}
BREITE, HOEHE, RAND = 595, 842, 56
ZEICHEN_PRO_ZEILE = 92          # vorsichtig für 10 pt Helvetica bei 483 pt Satzbreite
ZEILEN_PRO_SEITE = 58


def _kodiert(s):
    for a, b in ERSATZ.items():
        s = s.replace(a, b)
    s = s.encode("cp1252", errors="replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _zeilen(titel, text):
    aus = [("T", titel), ("", "")]
    for absatz in text.split("\n"):
        a = absatz.rstrip()
        if not a:
            aus.append(("", ""))
            continue
        fett = a.upper() == a and any(c.isalpha() for c in a) and len(a) < 90
        einzug = "    " if a.startswith("  - ") else ""
        for i, z in enumerate(textwrap.wrap(a.strip(), ZEICHEN_PRO_ZEILE - len(einzug)) or [""]):
            aus.append(("B" if fett else "", (einzug if i else "") + (("  " + z) if einzug and not i else z)))
    return aus


def pdf(titel, text):
    zeilen = _zeilen(titel, text)
    seiten = [zeilen[i:i + ZEILEN_PRO_SEITE] for i in range(0, len(zeilen), ZEILEN_PRO_SEITE)]
    objekte = []  # Inhalte der Objekte 1..n

    def neu(inhalt):
        objekte.append(inhalt)
        return len(objekte)

    katalog = neu(None)
    seitenbaum = neu(None)
    f1 = neu(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    f2 = neu(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    kinder = []
    for nr, seite in enumerate(seiten, 1):
        teile = ["BT", f"{RAND} {HOEHE - RAND} Td"]
        for art, z in seite:
            gr, schrift, abstand = (15, "/F2", 22) if art == "T" else (10, "/F2" if art == "B" else "/F1", 13)
            teile.append(f"{schrift} {gr} Tf ({_kodiert(z)}) Tj 0 -{abstand} Td")
        teile.append("ET")
        teile.append(f"BT /F1 8 Tf {RAND} 30 Td ({_kodiert(titel)} - Seite {nr} von {len(seiten)}) Tj ET")
        strom = "\n".join(teile).encode("latin-1")
        inhalt = neu(b"<< /Length %d >>\nstream\n" % len(strom) + strom + b"\nendstream")
        kinder.append(neu(f"<< /Type /Page /Parent {seitenbaum} 0 R /MediaBox [0 0 {BREITE} {HOEHE}] "
                          f"/Resources << /Font << /F1 {f1} 0 R /F2 {f2} 0 R >> >> /Contents {inhalt} 0 R >>".encode()))
    objekte[katalog - 1] = f"<< /Type /Catalog /Pages {seitenbaum} 0 R >>".encode()
    objekte[seitenbaum - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kinder)}] /Count {len(kinder)} >>".encode()

    aus = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    stellen = []
    for i, o in enumerate(objekte, 1):
        stellen.append(len(aus))
        aus += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(aus)
    aus += f"xref\n0 {len(objekte) + 1}\n0000000000 65535 f \n".encode()
    aus += "".join(f"{s:010d} 00000 n \n" for s in stellen).encode()
    aus += f"trailer\n<< /Size {len(objekte) + 1} /Root {katalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(aus)
