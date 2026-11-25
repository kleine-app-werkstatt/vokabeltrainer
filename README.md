# Vokabeltrainer

Web-App zum Vokabellernen (Englisch–Deutsch, Französisch–Deutsch) fürs iPhone.

- Vokabelseiten aus dem Schulbuch selbst fotografieren (Texterkennung läuft offline auf dem Gerät); alternativ eintippen oder Text einfügen
- Kapitel pro Sprache
- Karteikasten mit 5 Fächern (Wiederholung nach 1, 3, 7, 14, 30 Tagen); falsche Wörter kommen in derselben Runde und am nächsten Tag wieder
- Testtermine je Kapitel (Lernplan richtet sich danach), Statistik, schwierige Wörter, Lernserie
- Täglicher Bericht per WhatsApp (ein Tipp, Empfänger im Elternbereich mit PIN)
- Fotos dienen nur zum Erfassen und werden nicht gespeichert; Beispielsätze aus dem Buch werden für den Lückentext übernommen
- Prüfungsmodus (Vokabeltest, Lückentext), Kapitel teilen (z. B. zwischen Geschwistern)
- Sicherung & Wiederherstellung (Handywechsel) als JSON-Datei

Alle Daten bleiben auf dem jeweiligen Gerät (localStorage). Kein Server, kein Konto.

## Installation auf dem iPhone
1. Seite in **Safari** öffnen
2. Teilen-Symbol → **Zum Home-Bildschirm**

## Technik
Reines HTML/CSS/JavaScript ohne Build-Schritt. Texterkennung: [tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0), unter `vendor/`.
Nach Änderungen an App-Dateien `VERSION` in `sw.js` erhöhen.
