# events.fragroger.ai

Kommende Auftritte von Roger Basler de Roca, automatisch aus der Notion-Datenbank "🎤 Keynotes".

## So funktioniert es

- Ein geplanter Claude-Task läuft jeden Monat am 30. frühmorgens (Februar: Monatsletzter). Er liest die Notion-Datenbank über den Notion-Connector, baut die Seite mit `node scripts/build.mjs --fixture <abfrage.json>` und pusht nach `main`. Ein Notion-Token ist dafür nicht nötig.
- Reserve: GitHub Actions > "Events aus Notion" > Run workflow (liest über die Notion API, braucht das Secret `NOTION_TOKEN`).
- Angezeigt werden Einträge mit Status "Bestätigt" oder "In Vorbereitung" ab heute.
- Steuerung pro Eintrag in Notion:
  - `Website: Sichtbarkeit`: Öffentlich = mit Titel und Veranstalter. Geschlossen oder leer = anonymisiert (nur Format, Datum, Stadt). Ausblenden = erscheint nicht.
  - `Website: Stadt` / `Website: Land`: öffentlicher Ort für den Filter. Leer = wird aus "Ort" oder Titel abgeleitet (nur bekannte Städte, nie Adressen).
  - `Website: Titel`, `Website: Link`: für öffentliche Events.
  - `Website: Branche`: optional für geschlossene Events ("Inhouse-Workshop, Branche: Finanz").
- Geschlossene Events geben nie Kundennamen, Titel, Adressen, Honorare oder Kontakte aus. Das Repo ist öffentlich, darum steht nur die bereinigte `data/events.json` darin.

## Einrichtung (einmalig)

1. GitHub Pages: Settings > Pages > Deploy from branch `main`, Ordner `/`. Custom domain `events.fragroger.ai`, HTTPS erzwingen.
2. DNS bei fragroger.ai: CNAME `events` auf `rogerbasler.github.io`.
3. Optional für die Reserve: Notion-Integration mit Leserecht anlegen, mit der Datenbank "🎤 Keynotes" verbinden, Token als Secret `NOTION_TOKEN` speichern.

## Lokal

```
NOTION_TOKEN=secret_xxx node scripts/build.mjs
```
