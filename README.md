# events.fragroger.ai

Kommende Auftritte von Roger Basler de Roca, automatisch aus der Notion-Datenbank "🎤 Keynotes".

## So funktioniert es

- GitHub Actions baut die Seite jeden Monat am 30. um 05:00 Zürich (Februar: Monatsletzter). Manuell: Actions > "Events aus Notion" > Run workflow.
- Angezeigt werden Einträge mit Status "Bestätigt" oder "In Vorbereitung" ab heute.
- Steuerung pro Eintrag in Notion:
  - `Website: Sichtbarkeit`: Öffentlich = mit Titel und Veranstalter. Geschlossen oder leer = anonymisiert (nur Format, Datum, Stadt). Ausblenden = erscheint nicht.
  - `Website: Stadt` / `Website: Land`: öffentlicher Ort für den Filter. Leer = wird aus "Ort" oder Titel abgeleitet (nur bekannte Städte, nie Adressen).
  - `Website: Titel`, `Website: Link`: für öffentliche Events.
  - `Website: Branche`: optional für geschlossene Events ("Inhouse-Workshop, Branche: Finanz").
- Geschlossene Events geben nie Kundennamen, Titel, Adressen, Honorare oder Kontakte aus. Das Repo ist öffentlich, darum steht nur die bereinigte `data/events.json` darin.

## Einrichtung (einmalig)

1. Notion: unter notion.so/profile/integrations eine interne Integration "events.fragroger.ai" mit Leserecht anlegen, Token kopieren. Dann die Datenbank "🎤 Keynotes" öffnen > ••• > Verbindungen > Integration hinzufügen.
2. GitHub: Settings > Secrets and variables > Actions > `NOTION_TOKEN` anlegen.
3. GitHub Pages: Settings > Pages > Deploy from branch `main`, Ordner `/`. Custom domain `events.fragroger.ai`, HTTPS erzwingen.
4. DNS bei fragroger.ai: CNAME `events` auf `rogerbasler.github.io`.

## Lokal

```
NOTION_TOKEN=secret_xxx node scripts/build.mjs
```
