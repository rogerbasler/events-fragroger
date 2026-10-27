// events.fragroger.ai: liest die Notion-Datenbank "Keynotes" und baut die öffentliche Event-Seite.
// Aufruf:  node scripts/build.mjs                (holt Daten über die Notion API, braucht NOTION_TOKEN)
//          node scripts/build.mjs --fixture x.json (lokaler Test mit flachen Datensätzen)
// Datenschutz: Für geschlossene Events verlassen nur Datum, Format, Stadt/Land und Branche das Skript.
// Kundennamen, Titel, Adressen, Honorare und Kontakte werden nie geschrieben.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://events.fragroger.ai";
const DATABASE_ID = process.env.NOTION_DATABASE_ID || "8d748824-0cba-46ca-887d-161098ff4818";
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID || "bc9dbcd3-ca20-40b4-9c8e-beb1b8656e1b";
const SHOW_STATUS = ["Bestätigt", "In Vorbereitung"];
const TZ = "Europe/Zurich";

// ---------- Notion ----------
const plain = (rt) => (rt || []).map((t) => t.plain_text).join("").trim();
function prop(p) {
  if (!p) return null;
  switch (p.type) {
    case "title": return plain(p.title) || null;
    case "rich_text": return plain(p.rich_text) || null;
    case "select": return p.select?.name || null;
    case "status": return p.status?.name || null;
    case "url": return p.url || null;
    case "date": return p.date || null;
    default: return null;
  }
}

async function notionQuery(today) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN fehlt (GitHub Secret).");
  const filter = {
    and: [
      { property: "Event-Datum", date: { on_or_after: today } },
      { or: SHOW_STATUS.map((s) => ({ property: "Status", status: { equals: s } })) },
    ],
  };
  const attempts = [
    { url: `https://api.notion.com/v1/databases/${DATABASE_ID}/query`, version: "2022-06-28" },
    { url: `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`, version: "2025-09-03" },
  ];
  let lastErr;
  for (const a of attempts) {
    try {
      const pages = [];
      let cursor;
      do {
        const res = await fetch(a.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Notion-Version": a.version, "Content-Type": "application/json" },
          body: JSON.stringify({ filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
        });
        if (!res.ok) throw new Error(`${a.url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const j = await res.json();
        pages.push(...j.results);
        cursor = j.has_more ? j.next_cursor : null;
      } while (cursor);
      return pages.map((pg) => {
        const P = pg.properties;
        const d = prop(P["Event-Datum"]);
        return {
          title: prop(P["Titel"]), start: d?.start, end: d?.end, ort: prop(P["Ort"]),
          kunde: prop(P["Kunde / Veranstalter"]), format: prop(P["Format"]), sprache: prop(P["Sprache"]),
          status: prop(P["Status"]), sicht: prop(P["Website: Sichtbarkeit"]), stadt: prop(P["Website: Stadt"]),
          land: prop(P["Website: Land"]), wtitel: prop(P["Website: Titel"]), branche: prop(P["Website: Branche"]),
          link: prop(P["Website: Link"]),
        };
      });
    } catch (e) { lastErr = e; console.warn(String(e)); }
  }
  throw lastErr;
}

// ---------- Ort ableiten (nur Stadt, nie Adresse oder Firmenname) ----------
const PLACES = [
  ["Online", "Online"], ["Webinar", "Online"], ["Zürich", "Schweiz"], ["Winterthur", "Schweiz"], ["Uster", "Schweiz"],
  ["Spreitenbach", "Schweiz"], ["Baden", "Schweiz"], ["Bern", "Schweiz"], ["Basel", "Schweiz"], ["St.Gallen", "Schweiz"],
  ["St. Gallen", "Schweiz"], ["Appenzell", "Schweiz"], ["Lachen", "Schweiz"], ["Landquart", "Schweiz"], ["Uzwil", "Schweiz"],
  ["Chur", "Schweiz"], ["Luzern", "Schweiz"], ["St. Moritz", "Schweiz"], ["Brunnen", "Schweiz"], ["Lupfig", "Schweiz"],
  ["Valbella", "Schweiz"], ["Amriswil", "Schweiz"], ["Hagenwil", "Schweiz"], ["Frauenfeld", "Schweiz"], ["Aarau", "Schweiz"],
  ["Zug", "Schweiz"], ["Lugano", "Schweiz"], ["Ticino", "Schweiz"], ["Tessin", "Schweiz"], ["Zentralschweiz", "Schweiz"],
  ["Graubünden", "Schweiz"], ["Thurgau", "Schweiz"], ["Ostschweiz", "Schweiz"],
  ["Frankfurt", "Deutschland"], ["Köln", "Deutschland"], ["Bocholt", "Deutschland"], ["Rust", "Deutschland"],
  ["München", "Deutschland"], ["Berlin", "Deutschland"], ["Hamburg", "Deutschland"], ["Stuttgart", "Deutschland"],
  ["Potsdam", "Deutschland"], ["Rheinsberg", "Deutschland"], ["Waiblingen", "Deutschland"],
  ["Wien", "Österreich"], ["Graz", "Österreich"], ["Salzburg", "Österreich"], ["Linz", "Österreich"], ["Innsbruck", "Österreich"],
];
const CITY_LABEL = { Webinar: "Online", Ticino: "Tessin", "St. Gallen": "St.Gallen", Frankfurt: "Frankfurt am Main" };
function findPlace(text) {
  if (!text) return null;
  for (const [name, land] of PLACES) {
    if (new RegExp(`(^|[^\\p{L}])${name.replace(".", "\\.")}([^\\p{L}]|$)`, "u").test(text)) return { stadt: CITY_LABEL[name] || name, land };
  }
  return null;
}
function landFor(stadt) { return findPlace(stadt)?.land || null; }

// ---------- Normalisieren ----------
const FORMAT_LABEL = { Keynote: "Keynote", Impuls: "Impulsreferat", Workshop: "Workshop", Panel: "Panel", Podcast: "Interview" };

function normalize(r) {
  if (!r.start || !SHOW_STATUS.includes(r.status)) return null;
  if (r.sicht === "Ausblenden") return null;
  const isPublic = r.sicht === "Öffentlich";
  const place = r.stadt ? { stadt: r.stadt, land: r.land || landFor(r.stadt) } : findPlace(r.ort) || findPlace(r.title);
  const stadt = place?.stadt || null;
  const land = r.land || place?.land || null;
  const ev = {
    date: r.start.slice(0, 10),
    time: r.start.length > 10 ? r.start : null,
    end: r.end ? r.end.slice(0, 10) : null,
    format: FORMAT_LABEL[r.format] || "Vortrag",
    stadt, land,
    lang: r.sprache && r.sprache !== "DE" ? r.sprache : null,
    public: isPublic,
  };
  if (isPublic) {
    ev.title = r.wtitel || r.title;
    ev.host = r.kunde ? r.kunde.split(/ \/ | \(/)[0].trim() : null; // ohne Ansprechperson
    ev.link = r.link || null;
  } else {
    ev.branche = r.branche || null;
    ev.title = ev.branche ? `${ev.format}, ${ev.branche}` : ev.format;
  }
  return ev;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((e) => {
    const k = e.public ? `${e.date}|${e.title}` : `${e.date}|${e.title}|${e.stadt}|${e.branche}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- Rendern ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dDay = new Intl.DateTimeFormat("de-CH", { day: "numeric", timeZone: "UTC" });
const dWd = new Intl.DateTimeFormat("de-CH", { weekday: "short", timeZone: "UTC" });
const dMon = new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric", timeZone: "UTC" });
const dLong = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const tFmt = new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const asDate = (iso) => new Date(`${iso}T12:00:00Z`);

function card(e) {
  const d = asDate(e.date);
  const where = e.stadt || "Ort auf Anfrage";
  const meta = [e.public ? e.format : null, e.time ? `${tFmt.format(new Date(e.time))} Uhr` : null, e.lang ? `Sprache ${e.lang}` : null].filter(Boolean);
  const sub = e.public ? e.host : null;
  return `<li class="ev${e.public ? " is-public" : ""}" data-land="${esc(e.land || "")}" data-stadt="${esc(e.stadt || "")}" data-art="${e.public ? "oeffentlich" : "geschlossen"}">
  <time class="ev-date" datetime="${esc(e.time || e.date)}" aria-hidden="true"><span class="ev-day">${dDay.format(d)}</span><span class="ev-wd">${dWd.format(d)}</span></time>
  <div class="ev-body">
    <p class="ev-tags"><span class="tag ${e.public ? "tag-public" : "tag-closed"}">${e.public ? "Öffentlich" : "Geschlossen"}</span>${meta.map((m) => `<span class="tag">${esc(m)}</span>`).join("")}</p>
    <h3 class="ev-title">${esc(e.title)}</h3>
    ${sub ? `<p class="ev-sub">${esc(sub)}</p>` : ""}
    <p class="ev-where"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg><span class="sr-only">${dLong.format(d)}, </span>${esc(where)}${e.land && e.land !== "Online" && e.land !== "Schweiz" ? `, ${esc(e.land)}` : ""}</p>
    ${e.public && e.link ? `<p class="ev-cta"><a href="${esc(e.link)}" rel="noopener">Infos und Anmeldung</a></p>` : ""}
  </div>
</li>`;
}

// ---------- SEO / GEO ----------
const PERSON_ID = "https://fragroger.ai/#roger";
const COUNTRY = { Schweiz: "CH", Deutschland: "DE", Österreich: "AT" };
const PERSON = {
  "@type": "Person", "@id": PERSON_ID, name: "Roger Basler de Roca",
  jobTitle: "KI-Berater, Keynote Speaker, Autor und Doktorand (kognitives Offloading)",
  url: "https://fragroger.ai", image: `${SITE}/assets/og-image.png`,
  worksFor: { "@type": "Organization", name: "Analytics Agentur", address: { "@type": "PostalAddress", streetAddress: "The Circle 6", postalCode: "8058", addressLocality: "Zürich", addressCountry: "CH" } },
  knowsAbout: ["Künstliche Intelligenz", "KI im Unternehmen", "KI-Kompetenz", "Agentic AI", "Kognitives Offloading", "Digitale Souveränität", "EU AI Act"],
  knowsLanguage: ["de", "en", "fr", "es"],
  sameAs: ["https://www.linkedin.com/in/rogerbasler", "https://www.rogerbasler.ch", "https://fragroger.ai", "https://ki-power.me", "https://www.youtube.com/watch?v=nSkHqpvobD8"],
};
const FAQ = [
  ["Wie kann ich Roger Basler de Roca für einen Anlass buchen?", "Anfragen für Keynotes, Impulsreferate und Workshops gehen per E-Mail an mail@rogerbasler.ch. Hilfreich sind Datum, Ort, Publikum, Dauer und Thema."],
  ["Kann ich an den Veranstaltungen auf dieser Seite teilnehmen?", "Öffentliche Termine sind mit einem Link zur Anmeldung beim Veranstalter versehen. Geschlossene Termine sind interne Anlässe von Unternehmen, Verwaltungen oder Verbänden; dort zeigt die Seite nur Datum, Format und Ort."],
  ["Zu welchen Themen spricht Roger Basler de Roca?", "Zu KI im Unternehmen und im Arbeitsalltag: KI-Kompetenz, Agentic AI, digitale Souveränität, EU AI Act und kognitives Offloading, also die Frage, wie Menschen mit KI arbeiten, ohne das eigene Denken abzugeben."],
  ["In welchen Sprachen finden die Vorträge statt?", "Auf Deutsch, Englisch, Französisch und Spanisch. Die Sprache steht beim Termin, wenn sie nicht Deutsch ist."],
  ["Wie aktuell ist die Liste?", "Die Termine werden jeden Monat am 30. aus der Terminplanung übernommen. Massgeblich sind die Angaben der Veranstalter."],
];
function jsonLd(events, stamp) {
  const pub = events.filter((e) => e.public);
  const evs = pub.map((e, i) => ({
    "@type": "Event", "@id": `${SITE}/#event-${i + 1}`, name: e.title, startDate: e.time || e.date, ...(e.end ? { endDate: e.end } : {}),
    description: [e.format, e.host ? `Veranstalter: ${e.host}` : null, `Mit Roger Basler de Roca`].filter(Boolean).join(". "),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: e.land === "Online" ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
    location: e.land === "Online" ? { "@type": "VirtualLocation", url: e.link || SITE } : { "@type": "Place", name: e.stadt || "", address: { "@type": "PostalAddress", addressLocality: e.stadt || "", addressCountry: COUNTRY[e.land] || e.land || "" } },
    performer: { "@id": PERSON_ID },
    ...(e.host ? { organizer: { "@type": "Organization", name: e.host, ...(e.link ? { url: e.link } : {}) } } : {}),
    ...(e.link ? { url: e.link } : {}),
    inLanguage: (e.lang || "DE").toLowerCase(),
    image: `${SITE}/assets/og-image.png`,
  }));
  const graph = [
    { "@type": "WebSite", "@id": `${SITE}/#website`, url: `${SITE}/`, name: "#fragRoger Events", inLanguage: "de-CH", publisher: { "@id": PERSON_ID } },
    PERSON,
    { "@type": "CollectionPage", "@id": `${SITE}/#webpage`, url: `${SITE}/`, name: "Events und Keynotes von Roger Basler de Roca", isPartOf: { "@id": `${SITE}/#website` }, about: { "@id": PERSON_ID }, inLanguage: "de-CH", dateModified: todayZh,
      mainEntity: { "@type": "ItemList", numberOfItems: pub.length, itemListElement: evs.map((e, i) => ({ "@type": "ListItem", position: i + 1, item: { "@id": e["@id"] } })) } },
    ...evs,
    { "@type": "FAQPage", "@id": `${SITE}/#faq`, mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

const KIP = "https://ki-power.me/?utm_source=events.fragroger.ai&utm_medium=referral";

function layout({ title, desc, path, body, head = "", depth = 0, noindex = false }) {
  const up = depth ? "../".repeat(depth) : "";
  return `<!DOCTYPE html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="author" content="Roger Basler de Roca">
<meta name="robots" content="${noindex ? "noindex, follow" : "index, follow, max-image-preview:large"}">
<link rel="canonical" href="${SITE}${path}">
<link rel="alternate" hreflang="de-CH" href="${SITE}${path}">
<link rel="alternate" hreflang="x-default" href="${SITE}${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="#fragRoger Events">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:locale" content="de_CH">
<meta property="og:image" content="${SITE}/assets/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="#fragRoger Events: Termine von Roger Basler de Roca">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE}/assets/og-image.png">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<link rel="icon" href="${up}favicon.ico" sizes="32x32">
<link rel="icon" href="${up}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${up}assets/apple-touch-icon.png">
<link rel="manifest" href="${up}site.webmanifest">
<link rel="alternate" type="application/json" title="Termine als JSON" href="${SITE}/data/events.json">
<link rel="alternate" type="text/calendar" title="Öffentliche Termine (iCal)" href="${SITE}/kalender.ics">
<script>(function(){try{var t=localStorage.getItem('frev-theme');if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<link rel="stylesheet" href="${up}assets/style.css?v=${BUILD_STAMP}">
${head}
</head>
<body>
<a class="skip" href="#main">Direkt zum Inhalt</a>
<aside class="promo-top" aria-label="Hinweis KI Power">
  <div class="wrap"><span class="promo-label">KI Power</span> Die KI-Academy für Selbstständige<span class="promo-long"> von Janet Zentel, Roger Basler de Roca und Fabian Zentel</span>: <a href="${KIP}&utm_campaign=topbar" rel="noopener">ki-power.me</a></div>
</aside>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="${up || "./"}" aria-label="fragRoger Events">
      <span class="brand-mark"><span class="brand-hash">#</span>frag<span class="brand-blue">Roger</span></span>
      <span class="brand-sub">Events</span>
    </a>
    <nav class="nav" aria-label="Navigation">
      <a href="${up || "./"}">Termine</a>
      <a href="https://fragroger.ai" rel="noopener">fragroger.ai</a>
    </nav>
    <button class="theme-toggle" type="button" id="theme-toggle" aria-label="Hell- und Dunkelmodus wechseln">
      <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    </button>
  </div>
</header>
<main id="main" class="wrap">
${body}
</main>
<aside class="wrap promo-bottom" aria-label="Empfehlung KI Power">
  <div class="promo-card">
    <p class="promo-kicker">Weiterlernen nach dem Vortrag</p>
    <p class="promo-title">KI Power: Mach KI zu deiner Sichtbarkeitsmaschine</p>
    <p class="promo-text">Online-Academy für Selbstständige und Coaches: Angebot, Content und Kundengewinnung mit KI aufbauen, mit monatlichen Live-Terminen und Aufzeichnung.</p>
    <a class="promo-btn" href="${KIP}&utm_campaign=footer" rel="noopener">ki-power.me ansehen</a>
  </div>
</aside>
<footer class="site-footer">
  <div class="wrap">
    <p class="foot-brand"><span class="brand-hash">#</span>frag<span class="brand-blue">Roger</span></p>
    <p class="foot-line">Keynotes, Impulse und Workshops zu KI von Roger Basler de Roca.</p>
    <p class="foot-small">Für Anfragen: <a href="mailto:mail@rogerbasler.ch">mail@rogerbasler.ch</a> · Mehr: <a href="https://fragroger.ai" rel="noopener">fragroger.ai</a> · <a href="https://www.linkedin.com/in/rogerbasler" rel="noopener me">LinkedIn</a> · <a href="${KIP}&utm_campaign=footerlink" rel="noopener">KI Power</a></p>
    <div class="foot-bottom">
      <p>© ${new Date().getFullYear()} Roger Basler de Roca, Analytics Agentur, Zürich</p>
      <nav class="foot-nav" aria-label="Rechtliches"><a href="${up}impressum/">Impressum</a><a href="${up}datenschutz/">Datenschutz</a><a href="${up}kalender.ics">Kalender abonnieren</a></nav>
    </div>
  </div>
</footer>
<div class="consent" id="consent" role="region" aria-label="Hinweis zu Cookies" hidden>
  <p>Diese Seite setzt keine Cookies und kein Tracking ein. Lokal im Browser gespeichert werden nur Ihre Wahl hell oder dunkel und dieser Hinweis. <a href="${up}datenschutz/">Datenschutz</a></p>
  <button type="button" id="consent-ok">Verstanden</button>
</div>
<script>(function(){var b=document.getElementById('theme-toggle');if(b){b.addEventListener('click',function(){var n=document.documentElement.getAttribute('data-theme')==='light'?'dark':'light';document.documentElement.setAttribute('data-theme',n);try{localStorage.setItem('frev-theme',n);}catch(e){}});}
var c=document.getElementById('consent'),seen=false;try{seen=localStorage.getItem('frev-consent')==='1';}catch(e){}
if(c&&!seen){c.hidden=false;document.getElementById('consent-ok').addEventListener('click',function(){c.hidden=true;try{localStorage.setItem('frev-consent','1');}catch(e){}});}})();</script>
</body>
</html>
`;
}

const LAND_ORDER = ["Schweiz", "Deutschland", "Österreich", "Online", "Andere"];

function indexPage(events, stamp) {
  const lands = LAND_ORDER.filter((l) => events.some((e) => e.land === l));
  const cities = [...new Set(events.filter((e) => e.stadt && e.land !== "Online").map((e) => e.stadt))].sort((a, b) => a.localeCompare(b, "de"));
  const nPublic = events.filter((e) => e.public).length;
  const months = [];
  for (const e of events) {
    const m = e.date.slice(0, 7);
    if (!months.length || months.at(-1).key !== m) months.push({ key: m, items: [] });
    months.at(-1).items.push(e);
  }
  const body = `
<section class="hero">
  <p class="kicker">Kommende Termine</p>
  <h1 class="hero-title">Wo Roger Basler de Roca als Nächstes über KI spricht</h1>
  <p class="lead">Keynotes, Impulsreferate und Workshops zu künstlicher Intelligenz in der Schweiz, in Deutschland und online: ${events.length} Termine, davon ${nPublic} öffentlich mit Anmeldung. Bei geschlossenen Veranstaltungen zeigen wir nur Format und Ort, nicht die Organisation.</p>
  <p class="stamp">Stand: <time datetime="${todayZh}">${esc(stamp)}</time> · Die Liste wird jeden Monat am 30. aktualisiert.</p>
</section>

<section class="filters" aria-label="Filter" hidden>
  <div class="filter-row" role="group" aria-label="Art der Veranstaltung">
    <button type="button" class="chip on" data-f="art" data-v="">Alle</button>
    <button type="button" class="chip" data-f="art" data-v="oeffentlich">Öffentlich</button>
    <button type="button" class="chip" data-f="art" data-v="geschlossen">Geschlossen</button>
  </div>
  <div class="filter-row" role="group" aria-label="Region">
    <button type="button" class="chip on" data-f="land" data-v="">Überall</button>
    ${lands.map((l) => `<button type="button" class="chip" data-f="land" data-v="${esc(l)}">${esc(l)}</button>`).join("\n    ")}
  </div>
  <label class="select-wrap">Ort
    <select id="f-stadt"><option value="">Alle Orte</option>${cities.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
  </label>
  <p class="count" id="count" aria-live="polite"></p>
</section>

<section class="list" id="list">
${months.map((m) => `<div class="month" data-month="${m.key}">
  <h2 class="month-title">${esc(dMon.format(asDate(m.key + "-01")))}</h2>
  <ul class="evs">
${m.items.map(card).join("\n")}
  </ul>
</div>`).join("\n")}
  <p class="empty" id="empty" hidden>Für diese Auswahl gibt es zurzeit keine Termine.</p>
</section>

<section class="ask">
  <h2>Roger an Ihren Anlass holen</h2>
  <p>Keynote, Impulsreferat oder Workshop zu KI im Unternehmen: Anfragen gerne per <a href="mailto:mail@rogerbasler.ch?subject=Anfrage%20Event">E-Mail</a>.</p>
</section>

<section class="about prose" aria-labelledby="about-title">
  <h2 id="about-title">Über Roger Basler de Roca</h2>
  <p>Roger Basler de Roca ist KI-Berater, Keynote Speaker und Autor aus Zürich. Er hält über 100 Vorträge pro Jahr und begleitet mehr als 60 Unternehmen bei der Einführung von KI. Er doziert an der ZHAW, der HWZ und der FHNW und forscht als Doktorand zum kognitiven Offloading: wie Menschen mit KI arbeiten, ohne das eigene Denken abzugeben. Er spricht auf Deutsch, Englisch, Französisch und Spanisch.</p>
  <p>Sein Leitsatz: "Künstlich ist die Maschine. Intelligenz muss vom Menschen kommen." Mehr unter <a href="https://fragroger.ai" rel="noopener">fragroger.ai</a> und <a href="https://www.linkedin.com/in/rogerbasler" rel="noopener me">LinkedIn</a>.</p>
</section>

<section class="faq prose" aria-labelledby="faq-title">
  <h2 id="faq-title">Häufige Fragen</h2>
${FAQ.map(([q, a]) => `  <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
</section>

<script>
(function(){
  var f={art:'',land:'',stadt:''};
  var box=document.querySelector('.filters'); box.hidden=false;
  var sel=document.getElementById('f-stadt');
  function apply(){
    var n=0;
    document.querySelectorAll('.ev').forEach(function(li){
      var ok=(!f.art||li.dataset.art===f.art)&&(!f.land||li.dataset.land===f.land)&&(!f.stadt||li.dataset.stadt===f.stadt);
      li.hidden=!ok; if(ok)n++;
    });
    document.querySelectorAll('.month').forEach(function(m){m.hidden=!m.querySelector('.ev:not([hidden])');});
    document.getElementById('empty').hidden=n>0;
    document.getElementById('count').textContent=n+(n===1?' Termin':' Termine');
    var q=new URLSearchParams(); Object.keys(f).forEach(function(k){if(f[k])q.set(k,f[k]);});
    history.replaceState(null,'',q.toString()?'?'+q:location.pathname);
  }
  function setChip(k,v){ f[k]=v; document.querySelectorAll('.chip[data-f="'+k+'"]').forEach(function(c){c.classList.toggle('on',c.dataset.v===v);c.setAttribute('aria-pressed',c.dataset.v===v);}); }
  box.addEventListener('click',function(e){var c=e.target.closest('.chip'); if(!c)return; setChip(c.dataset.f,c.dataset.v); if(c.dataset.f==='land'){f.stadt='';sel.value='';} apply();});
  sel.addEventListener('change',function(){f.stadt=sel.value; apply();});
  var p=new URLSearchParams(location.search);
  setChip('art',p.get('art')||''); setChip('land',p.get('land')||''); f.stadt=p.get('stadt')||''; sel.value=f.stadt;
  apply();
})();
</script>`;
  const years = [...new Set(events.map((e) => e.date.slice(0, 4)))];
  const yr = years.length > 1 ? `${years[0]}/${years.at(-1).slice(2)}` : years[0];
  return layout({
    title: `Events und Keynotes ${yr}: Roger Basler de Roca zu KI | #fragRoger`,
    desc: `Alle kommenden Keynotes, Impulsreferate und Workshops von Roger Basler de Roca zu KI, mit ${nPublic} öffentlichen Terminen und Anmeldung. Filter nach Ort, Region und Art.`,
    path: "/",
    body,
    head: `<script type="application/ld+json">${jsonLd(events, stamp)}</script>`,
  });
}

function impressumPage() {
  return layout({
    title: "Impressum · #fragRoger Events", desc: "Impressum von events.fragroger.ai", path: "/impressum/", depth: 1,
    body: `<section class="hero small"><h1 class="hero-title">Impressum</h1></section>
<section class="prose">
<h2>Verantwortlich für den Inhalt</h2>
<p>Roger Basler de Roca<br>Analytics Agentur<br>The Circle 6<br>8058 Zürich<br>Schweiz</p>
<p>E-Mail: <a href="mailto:mail@rogerbasler.ch">mail@rogerbasler.ch</a><br>Web: <a href="https://fragroger.ai">https://fragroger.ai</a></p>
<h2>Was diese Seite ist</h2>
<p>Eine Übersicht der kommenden Auftritte von Roger Basler de Roca. Die Liste wird monatlich automatisch aus der eigenen Terminplanung erzeugt. Bei geschlossenen Veranstaltungen werden weder Organisation noch Adresse veröffentlicht.</p>
<h2>Haftungsausschluss</h2>
<p>Termine können sich verschieben. Massgeblich sind die Angaben der jeweiligen Veranstalter. Für verlinkte Seiten sind ausschliesslich deren Betreiber verantwortlich.</p>
<h2>Werbung</h2>
<p>Die Hinweise auf KI Power (ki-power.me) sind Eigenwerbung: Roger Basler de Roca ist Mitgründer von KI Power.</p>
<p>Zum Datenschutz siehe die <a href="../datenschutz/">Datenschutzerklärung</a>.</p>
</section>`,
  });
}

function datenschutzPage() {
  return layout({
    title: "Datenschutz · #fragRoger Events", desc: "Datenschutzerklärung von events.fragroger.ai: keine Cookies, kein Tracking.", path: "/datenschutz/", depth: 1,
    body: `<section class="hero small"><h1 class="hero-title">Datenschutz</h1></section>
<section class="prose">
<h2>Verantwortlich</h2>
<p>Roger Basler de Roca, Analytics Agentur, The Circle 6, 8058 Zürich, Schweiz. E-Mail: <a href="mailto:mail@rogerbasler.ch">mail@rogerbasler.ch</a></p>
<h2>Cookies und Tracking</h2>
<p>Diese Seite setzt keine Cookies, keine Analyse- oder Werbe-Tracker und keine eingebetteten Inhalte von Dritten ein. Schriften und Skripte werden direkt von dieser Seite geladen.</p>
<h2>Lokale Speicherung im Browser</h2>
<p>Im lokalen Speicher Ihres Browsers (localStorage) werden zwei Einstellungen abgelegt: Ihre Wahl der Darstellung (hell oder dunkel) und dass Sie den Hinweis zu Cookies gesehen haben. Diese Angaben verlassen Ihr Gerät nicht. Sie können sie jederzeit in den Browsereinstellungen löschen.</p>
<h2>Hosting</h2>
<p>Die Seite wird über GitHub Pages (GitHub Inc., USA) ausgeliefert. Beim Aufruf verarbeitet GitHub technisch notwendige Daten wie die IP-Adresse, um die Seite auszuliefern und vor Missbrauch zu schützen. Details stehen in der Datenschutzerklärung von GitHub.</p>
<h2>Links zu anderen Seiten</h2>
<p>Links zu Veranstaltern und zu KI Power führen auf Seiten Dritter. Dort gelten deren Datenschutzbestimmungen. Die Links zu KI Power enthalten Kampagnenparameter (utm), damit KI Power erkennt, dass Sie von dieser Seite kommen. Diese Seite selbst wertet nichts aus.</p>
<h2>Ihre Rechte</h2>
<p>Nach dem Schweizer Datenschutzgesetz (DSG) und, soweit anwendbar, der DSGVO können Sie Auskunft, Berichtigung oder Löschung verlangen. Schreiben Sie dazu an die oben genannte Adresse.</p>
<p class="stamp">Stand: ${esc(dLong.format(new Date()))}</p>
</section>`,
  });
}

function notFoundPage() {
  return layout({
    title: "Seite nicht gefunden · #fragRoger Events", desc: "Diese Seite gibt es nicht.", path: "/404.html", noindex: true,
    body: `<section class="hero small"><h1 class="hero-title">Seite nicht gefunden</h1><p class="lead"><a href="/">Zu den kommenden Terminen</a></p></section>`,
  }).replaceAll('href="assets/', 'href="/assets/').replaceAll('href="favicon', 'href="/favicon').replaceAll('href="site.web', 'href="/site.web').replaceAll('href="impressum/', 'href="/impressum/').replaceAll('href="datenschutz/', 'href="/datenschutz/').replaceAll('href="kalender', 'href="/kalender').replaceAll('href="./"', 'href="/"');
}

function sitemap(events) {
  const urls = [["/", "weekly", "1.0"], ["/impressum/", "yearly", "0.2"], ["/datenschutz/", "yearly", "0.2"]];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, f, pr]) => `  <url><loc>${SITE}${p}</loc><lastmod>${todayZh}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join("\n")}\n</urlset>\n`;
}

function llms(events, stamp) {
  const pub = events.filter((e) => e.public);
  const d = (e) => new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(asDate(e.date));
  return `# #fragRoger Events: Termine von Roger Basler de Roca

> Übersicht der kommenden Keynotes, Impulsreferate und Workshops von Roger Basler de Roca (KI-Berater, Keynote Speaker, Autor, Zürich) zum Thema künstliche Intelligenz. Stand: ${stamp}. Monatlich am 30. aktualisiert.

Roger Basler de Roca hält über 100 Vorträge pro Jahr, begleitet mehr als 60 Unternehmen bei der KI-Einführung, doziert an ZHAW, HWZ und FHNW und forscht als Doktorand zum kognitiven Offloading. Sprachen: Deutsch, Englisch, Französisch, Spanisch. Buchung: mail@rogerbasler.ch. Website: https://fragroger.ai

## Öffentliche Termine

${pub.map((e) => `- ${d(e)}, ${e.stadt || "Ort offen"}: ${e.title}${e.host ? ` (Veranstalter: ${e.host})` : ""}${e.link ? `. Anmeldung: ${e.link}` : ""}`).join("\n")}

## Hinweise

- Insgesamt ${events.length} Termine, davon ${events.length - pub.length} geschlossene Anlässe von Unternehmen, Verwaltungen und Verbänden (ohne Angabe der Organisation).
- Maschinenlesbar: ${SITE}/data/events.json und ${SITE}/kalender.ics
- KI Power (https://ki-power.me), die KI-Academy für Selbstständige, ist ein Angebot, das Roger Basler de Roca mitgegründet hat.
`;
}

function ics(events) {
  const fold = (s) => s.replace(/[,;\\]/g, (c) => "\\" + c);
  const stampNow = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//fragRoger//Events//DE", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Roger Basler de Roca · öffentliche Events", "X-WR-TIMEZONE:Europe/Zurich"];
  for (const e of events.filter((x) => x.public)) {
    const start = e.date.replace(/-/g, "");
    const endD = new Date(`${e.end || e.date}T00:00:00Z`); endD.setUTCDate(endD.getUTCDate() + 1);
    lines.push("BEGIN:VEVENT", `UID:${start}-${Buffer.from(e.title).toString("hex").slice(0, 24)}@events.fragroger.ai`, `DTSTAMP:${stampNow}`,
      `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${endD.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${fold(e.title)}`, `LOCATION:${fold([e.stadt, e.land].filter(Boolean).join(", "))}`,
      ...(e.link ? [`URL:${e.link}`] : []), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ---------- Main ----------
const todayZh = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const BUILD_STAMP = todayZh.replace(/-/g, "");
const args = process.argv.slice(2);
// --fixture akzeptiert flache Datensätze oder direkt die Ausgabe der Notion-SQL-Abfrage
// aus dem monatlichen Claude-Lauf ({"results":[{Titel,start,ende,Ort,kunde,Format,Sprache,Status,sicht,stadt,land,wtitel,branche,link}]}).
const fx = args.indexOf("--fixture");
function fromInput(j) {
  const rows = Array.isArray(j) ? j : j.results;
  if (!Array.isArray(rows)) throw new Error("Eingabedatei hat kein Array und kein results-Feld.");
  return rows.map((r) => ("title" in r ? r : {
    title: r.Titel, start: r.start ? String(r.start).replace(" ", "T") : null, end: r.ende || null, ort: r.Ort,
    kunde: r.kunde, format: r.Format, sprache: r.Sprache, status: r.Status, sicht: r.sicht, stadt: r.stadt,
    land: r.land, wtitel: r.wtitel, branche: r.branche, link: r.link,
  }));
}
const raw = fx >= 0 ? fromInput(JSON.parse(await readFile(args[fx + 1], "utf8"))) : await notionQuery(todayZh);

const events = dedupe(raw.map(normalize).filter(Boolean).filter((e) => (e.end || e.date) >= todayZh))
  .sort((a, b) => (a.time || a.date).localeCompare(b.time || b.date) || Number(b.public) - Number(a.public));

if (!events.length) throw new Error("Keine Termine gefunden, Seite bleibt unverändert.");

const stamp = dLong.format(new Date());
await mkdir(join(ROOT, "data"), { recursive: true });
await mkdir(join(ROOT, "impressum"), { recursive: true });
await writeFile(join(ROOT, "data/events.json"), JSON.stringify({ updated: todayZh, events }, null, 2) + "\n");
await writeFile(join(ROOT, "index.html"), indexPage(events, stamp));
await writeFile(join(ROOT, "impressum/index.html"), impressumPage());
await mkdir(join(ROOT, "datenschutz"), { recursive: true });
await writeFile(join(ROOT, "datenschutz/index.html"), datenschutzPage());
await writeFile(join(ROOT, "404.html"), notFoundPage());
await writeFile(join(ROOT, "sitemap.xml"), sitemap(events));
await writeFile(join(ROOT, "llms.txt"), llms(events, stamp));
await writeFile(join(ROOT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
await writeFile(join(ROOT, "kalender.ics"), ics(events));
console.log(`${events.length} Termine geschrieben (${events.filter((e) => e.public).length} öffentlich), Stand ${todayZh}.`);
