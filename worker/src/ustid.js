// USt-IdNr. eines EU-Unternehmens bei der EU prüfen (VIES, REST-Schnittstelle der Kommission).
// Mit unserer eigenen USt-IdNr. als Anfragender gibt VIES eine Abfragenummer zurück; die speichern wir als Nachweis
// für die steuerfreie innergemeinschaftliche Lieferung. Ohne Antwort von VIES gilt die Nummer als nicht bestätigt.
import { text, jetzt } from "./hilfe.js";

const VIES = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const EIGENE = { land: "DE", nummer: "172950054" }; // T&S Systemtechnik GmbH, DE 172 950 054 (Impressum)

export function zerlegen(roh, land) {
  const s = text(roh, 30).toUpperCase().replace(/[\s.\-]/g, "");
  const praefix = land.vies || land.c;
  const m = s.match(/^([A-Z]{2})([0-9A-Z+*]{2,13})$/);
  if (!m) return null;
  if (m[1] !== praefix) return { falschesLand: true, praefix };
  return { land: m[1], nummer: m[2] };
}

export async function ustidPruefen(env, roh, land, abruf = fetch) {
  const z = zerlegen(roh, land);
  if (!z) return { gueltig: false, fehler: "Bitte die USt-IdNr. mit Länderkennung angeben, z. B. ATU12345678." };
  if (z.falschesLand) return { gueltig: false, fehler: `Für die Lieferung nach ${land.n} brauchen wir eine USt-IdNr. aus ${land.n} (beginnt mit ${z.praefix}).` };
  try {
    const r = await abruf(env.VIES_URL || VIES, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ countryCode: z.land, vatNumber: z.nummer, requesterMemberStateCode: EIGENE.land, requesterNumber: EIGENE.nummer }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || typeof d.valid !== "boolean") throw new Error(`VIES ${r.status} ${d.errorWrappers?.[0]?.error || d.actionSucceed || ""}`);
    if (!d.valid) return { gueltig: false, fehler: "Die USt-IdNr. ist laut EU-Prüfung (VIES) nicht gültig. Bitte prüfen Sie sie oder bestellen Sie ohne USt-IdNr. mit Umsatzsteuer." };
    return { gueltig: true, nachweis: { ustid: z.land + z.nummer, name: text(d.name, 200), adresse: text(d.address, 300), abfrage: text(d.requestIdentifier, 60), zeit: jetzt() } };
  } catch (err) {
    console.error("USt-IdNr.-Prüfung:", err?.message || err);
    return { gueltig: false, fehler: "Die USt-IdNr. konnte gerade nicht bei der EU geprüft werden. Bitte versuchen Sie es später noch einmal oder bestellen Sie ohne USt-IdNr. mit Umsatzsteuer." };
  }
}
