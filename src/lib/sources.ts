// Thin clients for PotterDB (primary) and Wizard World (secondary, optional).
import { getJson, UpstreamError } from "./http.js";
import { SRC_PDB, SRC_WW, bestMatches, norm, slugify } from "./text.js";

const PDB = "https://api.potterdb.com/v1";
const WW = "https://wizard-world-api.herokuapp.com";

export interface PdbItem {
  id: string;
  type: string;
  attributes: Record<string, any>;
  relationships?: Record<string, any>;
}
export interface PdbPage {
  items: PdbItem[];
  total: number;
  page: number;
  pages: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k.replace(/\[/g, "%5B").replace(/\]/g, "%5D")}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function pdbList(
  resource: string,
  filters: Record<string, string | undefined> = {},
  opts: { page?: number; size?: number; sort?: string } = {},
): Promise<PdbPage> {
  const params: Record<string, string | number | undefined> = {
    "page[number]": opts.page ?? 1,
    "page[size]": opts.size ?? 10,
    sort: opts.sort,
  };
  for (const [k, v] of Object.entries(filters)) if (v) params[`filter[${k}]`] = v;
  const json = await getJson<any>(`${PDB}/${resource}${qs(params)}`, SRC_PDB);
  const p = json?.meta?.pagination ?? {};
  const size = opts.size ?? 10;
  return {
    items: json?.data ?? [],
    total: p.records ?? (json?.data?.length ?? 0),
    page: p.current ?? opts.page ?? 1,
    pages: p.last ?? Math.max(1, Math.ceil((p.records ?? 0) / size)),
  };
}

export async function pdbBySlug(resource: string, slug: string): Promise<PdbItem | undefined> {
  try {
    const json = await getJson<any>(`${PDB}/${resource}/${encodeURIComponent(slug)}`, SRC_PDB);
    return json?.data;
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 404) return undefined;
    throw e;
  }
}

/**
 * Resolve a free-text name or slug to one item, or return "did you mean" candidates.
 * Tries exact slug, then name_cont, then the longest/rarest word so typos still surface suggestions.
 */
export async function pdbResolve(
  resource: "characters" | "spells" | "potions",
  query: string,
): Promise<{ item?: PdbItem; suggestions: PdbItem[] }> {
  const slug = slugify(query);
  const bySlug = slug ? await pdbBySlug(resource, slug) : undefined;
  if (bySlug) return { item: bySlug, suggestions: [] };

  const nameOf = (i: PdbItem) => String(i.attributes.name ?? "");
  const pool = new Map<string, PdbItem>();
  const add = (page: PdbPage) => page.items.forEach((i) => pool.set(i.id, i));

  const q = query.trim();
  add(await pdbList(resource, { name_cont: q }, { size: 30, sort: "name" }));
  if (pool.size === 0) {
    const words = norm(q).split(" ").filter((w) => w.length > 2).sort((a, b) => b.length - a.length);
    for (const w of words.slice(0, 2)) add(await pdbList(resource, { name_cont: w }, { size: 30, sort: "name" }));
    // typo fallback: search by a prefix of the longest word
    if (pool.size === 0 && words[0] && words[0].length > 4) {
      add(await pdbList(resource, { name_cont: words[0].slice(0, Math.max(3, words[0].length - 2)) }, { size: 30, sort: "name" }));
    }
  }
  // Many spells are known by their incantation ("Expelliarmus" = Disarming Charm).
  if (resource === "spells") {
    const inc = await pdbList(resource, { incantation_cont: q }, { size: 30, sort: "name" });
    const strip = (s: unknown) => String(s ?? "").replace(/\s*\(.*?\)\s*$/, "");
    const exact = inc.items.filter((i) => norm(strip(i.attributes.incantation)) === norm(q));
    if (exact.length === 1) return { item: exact[0], suggestions: [] };
    inc.items.forEach((i) => pool.set(i.id, i));
  }
  const ranked = bestMatches(q, [...pool.values()], nameOf, 5);
  if (ranked[0] && (ranked[0].score >= 0.99 || (ranked.length === 1 && ranked[0].score >= 0.85))) {
    return { item: ranked[0].item, suggestions: [] };
  }
  // Exactly one raw hit is good enough.
  if (pool.size === 1) return { item: [...pool.values()][0], suggestions: [] };
  // Prefer a name that equals the query once normalised, else the best-scoring one if clearly ahead.
  if (ranked.length > 1 && ranked[0].score >= 0.9 && ranked[0].score - ranked[1].score >= 0.1) {
    return { item: ranked[0].item, suggestions: [] };
  }
  return { suggestions: ranked.map((r) => r.item) };
}

export async function pdbTotal(resource: string, filters: Record<string, string | undefined> = {}): Promise<number> {
  return (await pdbList(resource, filters, { size: 1 })).total;
}

// ---------------- Wizard World ----------------

export type WwResult<T> = { ok: true; data: T } | { ok: false; reason: string };

export async function ww<T = any[]>(path: string, params: Record<string, string | undefined> = {}): Promise<WwResult<T>> {
  try {
    const data = await getJson<T>(`${WW}/${path}${qs(params)}`, SRC_WW);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export const WW_DOWN_NOTE = "_Wizard World data is currently unavailable; showing PotterDB only._";
export { PDB, WW };
