// Live / externally maintained sources beyond PotterDB and Wizard World:
// Google News RSS, Open Library, Wikidata (SPARQL) and Frankfurter (ECB exchange rates).
import { getJson, getText } from "./http.js";

export const SRC_NEWS = "Google News (live)";
export const SRC_OL = "Open Library";
export const SRC_WD = "Wikidata";
export const SRC_FX = "Frankfurter / ECB rates";

const enc = encodeURIComponent;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" };
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

// ---- news ----
export interface NewsItem {
  title: string;
  source: string;
  date: string;
  url: string;
}

export async function latestNews(query: string, limit: number): Promise<NewsItem[]> {
  const xml = await getText(`https://news.google.com/rss/search?q=${enc(query)}&hl=en-US&gl=US&ceid=US:en`, SRC_NEWS, 5 * 60 * 1000);
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    return m ? decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim() : "";
  };
  const items: (NewsItem & { ts: number })[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const source = tag(m[1], "source");
    let title = tag(m[1], "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const url = tag(m[1], "link");
    const ts = Date.parse(tag(m[1], "pubDate"));
    if (!title || !url) continue;
    items.push({ title, source: source || "news", date: Number.isNaN(ts) ? "" : new Date(ts).toISOString().slice(0, 10), url, ts: Number.isNaN(ts) ? 0 : ts });
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, limit).map(({ ts: _ts, ...rest }) => rest);
}

// ---- Open Library ----
export interface OlWork {
  title: string;
  url: string;
  year?: number;
  editions: number;
  languages: string[];
  rating?: number;
  ratings: number;
  want: number;
  cover?: string;
}

export async function openLibraryWorks(title: string, limit: number): Promise<OlWork[]> {
  const fields = "key,title,edition_count,first_publish_year,language,ratings_average,ratings_count,want_to_read_count,cover_i";
  const j = await getJson<any>(`https://openlibrary.org/search.json?title=${enc(title)}&author=${enc("J. K. Rowling")}&sort=editions&fields=${fields}&limit=${limit}`, SRC_OL, 30 * 60 * 1000);
  return (j?.docs ?? []).map((d: any) => ({
    title: String(d.title),
    url: `https://openlibrary.org${d.key}`,
    year: d.first_publish_year,
    editions: d.edition_count ?? 0,
    languages: d.language ?? [],
    rating: d.ratings_average ? Math.round(d.ratings_average * 100) / 100 : undefined,
    ratings: d.ratings_count ?? 0,
    want: d.want_to_read_count ?? 0,
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : undefined,
  }));
}

// ---- Wikidata ----
// Heavy filters/label service time out on the public endpoint, so queries stay simple and filtering happens here.
const SERIES = "wd:Q216930 wd:Q117662601"; // Harry Potter film series, Harry Potter (TV series)
const WD_TTL = 6 * 60 * 60 * 1000;
const EN = `FILTER(LANG(?l) = "en")`;

async function sparql(query: string): Promise<any[]> {
  const j = await getJson<any>(`https://query.wikidata.org/sparql?format=json&query=${enc(query)}`, SRC_WD, WD_TTL);
  return j?.results?.bindings ?? [];
}
// Members of the series (films, seasons) and the series items themselves.
const both = (select: string, body: string) =>
  Promise.all([
    sparql(`SELECT ${select} WHERE { VALUES ?series { ${SERIES} } ?work wdt:P179 ?series . ${body} }`),
    sparql(`SELECT ${select} WHERE { VALUES ?work { ${SERIES} } ${body} }`),
  ]).then(([a, b]) => [...a, ...b]);
const qid = (uri: string) => uri.split("/").pop() ?? uri;

export interface CastBirthday {
  name: string;
  year: number;
  url: string;
}
export async function castBirthdays(month: number, day: number): Promise<CastBirthday[]> {
  const rows = await both("?actor ?l ?dob", `?work wdt:P161 ?actor . ?actor wdt:P569 ?dob . ?actor rdfs:label ?l . ${EN}`);
  const seen = new Set<string>();
  const out: CastBirthday[] = [];
  for (const r of rows) {
    const d = new Date(r.dob.value);
    if (Number.isNaN(+d) || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) continue;
    const id = qid(r.actor.value);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name: r.l.value, year: d.getUTCFullYear(), url: `https://www.wikidata.org/wiki/${id}` });
  }
  return out.sort((a, b) => a.year - b.year);
}

export interface Release {
  title: string;
  date: string;
  url: string;
}
export async function upcomingReleases(today: string): Promise<Release[]> {
  const rows = await both("?work ?l ?date", `{ ?work wdt:P577 ?date } UNION { ?work wdt:P580 ?date } ?work rdfs:label ?l . ${EN}`);
  const seen = new Set<string>();
  return rows
    .map((r) => ({ title: String(r.l.value), date: String(r.date.value).slice(0, 10), url: `https://www.wikidata.org/wiki/${qid(r.work.value)}` }))
    .filter((r) => r.date >= today && !seen.has(r.url + r.date) && seen.add(r.url + r.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 15);
}

// ---- exchange rates ----
export async function fxRate(from: string, to: string): Promise<{ rate: number; date: string }> {
  if (from === to) return { rate: 1, date: new Date().toISOString().slice(0, 10) };
  const j = await getJson<any>(`https://api.frankfurter.dev/v1/latest?base=${enc(from)}&symbols=${enc(to)}`, SRC_FX, 30 * 60 * 1000);
  const rate = j?.rates?.[to];
  if (typeof rate !== "number") throw new Error(`no rate for ${from}->${to}`);
  return { rate, date: String(j.date) };
}
