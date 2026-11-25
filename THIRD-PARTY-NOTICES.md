# Verwendete Fremdbausteine und Lizenzen

Die App enthält folgende Bausteine anderer Urheber. Alle erlauben die Nutzung, auch kommerziell,
solange die Lizenzhinweise erhalten bleiben (die Lizenztexte liegen in den jeweiligen Ordnern).

| Baustein | Version | Lizenz | Ordner | Quelle |
| --- | --- | --- | --- | --- |
| tesseract.js (Texterkennung) | 6.0.1 | Apache-2.0 | `vendor/tesseract/` | https://github.com/naptha/tesseract.js |
| tesseract.js-core (Texterkennung, WebAssembly) | 6.1.2 | Apache-2.0 | `vendor/tesseract/core/` | https://github.com/naptha/tesseract.js-core |
| Sprachdaten Englisch, Französisch, Deutsch | 4.0.0_best_int | Paket: MIT; Originaldaten des Tesseract-Projekts: Apache-2.0 | `vendor/tesseract/lang/` | https://github.com/naptha/tessdata |
| Schrift „Nunito“ | 5.3.0 (Fontsource) | SIL Open Font License 1.1 | `fonts/` | https://github.com/googlefonts/nunito |

## Eigene Inhalte

- App-Symbole (`icons/`, `test/icons/`): selbst erstellt (einfache Vektorgrafik), keine fremden Bilder.
- Töne: werden im Programm erzeugt, keine Audiodateien.
- Emojis: Es werden nur Unicode-Zeichen verwendet; dargestellt werden sie von der Systemschrift des
  jeweiligen Geräts (z. B. Apple). Die Emoji-Grafiken selbst sind nicht Teil der App.
- Vorlesen: nutzt die Sprachausgabe des Betriebssystems, keine eingebetteten Stimmen.
- Testseiten: frei erfunden, keine Schulbuchinhalte.
