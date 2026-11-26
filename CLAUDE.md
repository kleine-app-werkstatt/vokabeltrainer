# Vokabeltrainer – Projektnotizen

Private Web-App (PWA) für zwei Kinder (6. und 8. Klasse, iPhones) zum Vokabellernen Englisch/Französisch ↔ Deutsch.
Antworten an den Nutzer auf Deutsch, kurz und Schritt für Schritt.

## Stand
- Echtversion (Kinder): https://kleine-app-werkstatt.github.io/vokabeltrainer/
- Testversion (nur Vater): https://kleine-app-werkstatt.github.io/vokabeltrainer/test/
- Repo: `kleine-app-werkstatt/vokabeltrainer` (öffentlich; GitHub-Konto wurde von „marcelmelter“ umbenannt).
  Claude ist direkt verbunden und pusht selbst auf `main`; GitHub Pages veröffentlicht `main` (root).
- Offen: Vorlesefunktion und Texterkennung (Testseiten) auf echten iPhones prüfen.

## Arbeitsweise Test → Echt (verbindlich)
- Änderungen IMMER nur im Ordner `test/` machen und pushen. Nutzer testet auf seinem iPhone („Vokabeln TEST“).
- Erst nach ausdrücklichem „übernehmen“ des Nutzers `sh tools/promote.sh` ausführen, committen, pushen.
- Testversion erkennt sich am Pfad `/test/`: eigener localStorage-Schlüssel (`…v1.test`), Banner „TESTVERSION“,
  eigenes Symbol/Manifest (`test/icons`, `test/manifest.webmanifest` werden nicht übernommen).
- Service-Worker-Caches sind pro Pfad benannt; bei Änderungen `VERSION` in `test/sw.js` erhöhen und
  `APP_VERSION` in `test/app.js` anpassen (wird unter „Mein Bereich“ angezeigt, zeigt dem Nutzer, ob das Update da ist).
- Lokales Testfoto `test/tmp-debug.jpg` (Schulbuchseite) ist per .git/info/exclude ausgeschlossen – nie committen.
- Keine echten Namen, Nummern oder Fotos der Kinder in Chats oder im Repo.

## Entscheidungen
- Kein Server, keine laufende KI-Nutzung, keine Kosten. Alles läuft offline auf dem Gerät (localStorage).
- Kinder fotografieren Schulbuchseiten selbst; Fotos werden nach dem Speichern verworfen (nicht gespeichert).
  Keine Schulbuchinhalte im Repo (Urheberrecht). Manuelle Eingabe/Einfügen als Alternative.
- Lernmethode „Auto“: neue Wörter → Kennenlern-Karte → Fremd→DE (Verstehen) → ab Fach 2 DE→Fremd (Schreiben, Rechtschreibung zählt).
  Karteikasten 1/3/7/14/30 Tage, Testtermine verdichten die Wiederholung.
- Prüfungsmodus (Vokabeltest, Lückentext aus Beispielsätzen) läuft parallel und ändert den Karteikasten nicht.
- Unregelmäßige Verben (Englisch): fertige Liste (~95, `IRREGULAR_VERBS`) + eigene; abgefragt Simple Past + Past Participle,
  eigener Karteikasten (`db.verbs`), „be“ verlangt was/were. Past Progressive bewusst nicht (regelmäßig: was/were + -ing).
- Anonymer Zähler „erster Start“ (GoatCounter, Bild-Pixel beim Abschluss des Einrichtens; bewusst KEIN Merker auf
  dem Gerät, damit keine Einwilligung nach TDDDG nötig ist) ist vorbereitet, aber AUS:
  `COUNTER_CODE` = kleine-app-werkstatt (Konto kleine-app-werkstatt.goatcounter.com angelegt), zuerst nur in test/ aktiv.
  `IMPRINT` (Impressum) ebenfalls leer; Abschnitt „Datenschutz & Impressum“ unter Mein Bereich.
- WhatsApp-Bericht per wa.me-Link (Kind tippt auf Senden); Empfänger im Elternbereich mit PIN.
- Kommerzialisierung vorerst nicht; Hinweise (App-Store-Abo vs. Web-Abo, Arbeitgeber, Datenschutz, Steuern) wurden besprochen.

## Technik
- Texterkennung bei Buchseiten mit Tabellenlinien (`analyzeTable`/`tableRows` in app.js): Linien finden →
  Bild entlang der Linien begradigen + Beleuchtung ausgleichen → jede Spalte einzeln lesen (PSM 4) → Wörter
  per Zeile/Spalte zuordnen; deutsche Spalte = kürzeste Einträge. Zum Vergleich wird immer auch klassisch
  gelesen (PSM 6, Standard von tesseract.js) und das Ergebnis mit mehr vollständigen Vokabeln genommen.
- Reines HTML/CSS/JS ohne Build. Texterkennung tesseract.js (vendor/, Apache-2.0), Schrift Nunito (fonts/, OFL).
