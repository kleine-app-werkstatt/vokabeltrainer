# Vokabeltrainer – Projektnotizen

Private Web-App (PWA) für zwei Kinder (6. und 8. Klasse, iPhones) zum Vokabellernen Englisch/Französisch ↔ Deutsch.
Antworten an den Nutzer auf Deutsch, kurz und Schritt für Schritt.

## Stand
- Live: https://marcelmelter.github.io/vokabeltrainer/ (GitHub Pages, Branch `main`, root)
- Repo: `marcelmelter/vokabeltrainer` (öffentlich). Bisher manueller Upload über die GitHub-Weboberfläche,
  weil die GitHub-Verknüpfung im Claude-Firmenkonto nicht freigegeben war.
- Offen: Update (`app.js`, `sw.js` mit verbesserter Texterkennung) hochladen und mit den Testseiten
  (`testseite-englisch`, `testseite-franzoesisch`, frei erfunden) auf echten iPhones testen.
  Erwartet: alle 12 Vokabeln je Seite, ein OCR-Fehler „môgen“ statt „mögen“.

## Entscheidungen
- Kein Server, keine laufende KI-Nutzung, keine Kosten. Alles läuft offline auf dem Gerät (localStorage).
- Kinder fotografieren Schulbuchseiten selbst; Fotos werden nach dem Speichern verworfen (nicht gespeichert).
  Keine Schulbuchinhalte im Repo (Urheberrecht). Manuelle Eingabe/Einfügen als Alternative.
- Lernmethode „Auto“: neue Wörter → Kennenlern-Karte → Fremd→DE (Verstehen) → ab Fach 2 DE→Fremd (Schreiben, Rechtschreibung zählt).
  Karteikasten 1/3/7/14/30 Tage, Testtermine verdichten die Wiederholung.
- Prüfungsmodus (Vokabeltest, Lückentext aus Beispielsätzen) läuft parallel und ändert den Karteikasten nicht.
- WhatsApp-Bericht per wa.me-Link (Kind tippt auf Senden); Empfänger im Elternbereich mit PIN.
- Kommerzialisierung vorerst nicht; Hinweise (App-Store-Abo vs. Web-Abo, Arbeitgeber, Datenschutz, Steuern) wurden besprochen.

## Technik
- Reines HTML/CSS/JS ohne Build. Texterkennung tesseract.js (vendor/, Apache-2.0), Schrift Nunito (fonts/, OFL).
- Bei jeder Änderung an App-Dateien `VERSION` in `sw.js` erhöhen.
