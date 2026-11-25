#!/bin/sh
# Übernimmt die freigegebene Testversion (test/) in die Echtversion (Hauptordner).
# Name, Symbol und Manifest der Echtversion bleiben dabei unverändert.
set -e
cd "$(dirname "$0")/.."

for f in app.js styles.css sw.js index.html; do
  cp "test/$f" "$f"
done
# Testkennzeichnung im Titel zurücksetzen
sed -i 's#<title>Vokabeltrainer TEST</title>#<title>Vokabeltrainer</title>#; s#content="Vokabeln TEST">#content="Vokabeln">#' index.html

# Bibliotheken und Schriften angleichen (ändern sich selten)
rm -rf vendor fonts
cp -r test/vendor test/fonts .

if grep -q "TEST" index.html; then
  echo "Achtung: index.html enthält noch 'TEST'" >&2
  exit 1
fi
echo "Testversion in die Echtversion übernommen."
