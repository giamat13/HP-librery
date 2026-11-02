import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UpstreamError } from "./lib/http.js";
import {
  PdbItem,
  WW_DOWN_NOTE,
  pdbBySlug,
  pdbList,
  pdbResolve,
  pdbTotal,
  ww,
  PDB,
  WW,
} from "./lib/sources.js";
import {
  SRC_PDB,
  SRC_WW,
  bestMatches,
  clean,
  facts,
  slugify,
  list,
  norm,
  pageFooter,
  similarity,
  table,
  truncate,
} from "./lib/text.js";
import { ICON_DATA_URI } from "./icon.js";
import { VIEW_CSP, VIEW_HTML, VIEW_MIME, VIEW_URI } from "./view.js";

const HOUSES = ["Gryffindor", "Slytherin", "Ravenclaw", "Hufflepuff"];

const FAMOUS: Record<string, string[]> = {
  Gryffindor: ["harry-potter", "hermione-granger", "ron-weasley", "neville-longbottom", "ginny-weasley", "fred-weasley", "george-weasley", "minerva-mcgonagall", "sirius-black", "lily-potter", "james-potter", "remus-lupin", "albus-dumbledore", "rubeus-hagrid", "seamus-finnigan", "dean-thomas", "lavender-brown", "oliver-wood", "percy-weasley"],
  Slytherin: ["draco-malfoy", "severus-snape", "lord-voldemort", "lucius-malfoy", "bellatrix-lestrange", "narcissa-malfoy", "horace-slughorn", "vincent-crabbe", "gregory-goyle", "pansy-parkinson", "regulus-black", "dolores-umbridge"],
  Ravenclaw: ["luna-lovegood", "cho-chang", "filius-flitwick", "gilderoy-lockhart", "rowena-ravenclaw", "padma-patil", "sybill-trelawney", "penelope-clearwater", "quirinus-quirrell", "garrick-ollivander"],
  Hufflepuff: ["cedric-diggory", "nymphadora-tonks", "pomona-sprout", "newt-scamander", "hannah-abbott", "ernie-macmillan", "susan-bones", "helga-hufflepuff", "justin-finch-fletchley", "leanne"],
};

const READ_ONLY ={ readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true } as const;

const limitSchema = z.number().int().min(1).max(25).default(10).describe("Results per page (1-25, default 10).");
const pageSchema = z.number().int().min(1).max(500).default(1).describe("Page number, starting at 1.");
const q = (what: string) => z.string().trim().min(1).max(100).describe(what);
const optQ = (what: string) => z.string().trim().max(100).optional().describe(what);

type Out = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const text = (t: string): Out => ({ content: [{ type: "text", text: t }] });
// Text for the model, plus structured data for the inline card (MCP Apps hosts render VIEW_URI with it).
const card = (t: string, data: Record<string, unknown>): Out => ({ content: [{ type: "text", text: t }], structuredContent: data });
const UI_META = { ui: { resourceUri: VIEW_URI }, "ui/resourceUri": VIEW_URI };
const fail = (t: string): Out => ({ content: [{ type: "text", text: t }], isError: true });

function safe<A>(fn: (a: A) => Promise<Out>) {
  return async (a: A): Promise<Out> => {
    try {
      return await fn(a);
    } catch (e) {
      if (e instanceof UpstreamError) return fail(`⚠️ ${e.message}`);
      return fail(`⚠️ Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

const attrs = (i: PdbItem) => i.attributes ?? {};
const link = (label: string, url?: string) => (url ? `[${label}](${url})` : undefined);
const stripPron = (s?: string) => (s ? String(s).replace(/\s*\(.*?\)\s*$/, "").trim() : s);

function didYouMean(kind: string, query: string, sugg: PdbItem[], tool: string): Out {
  const names = sugg.map((s) => `- ${attrs(s).name} (\`${attrs(s).slug}\`)`).join("\n");
  return text(
    `🔍 No exact ${kind} found for **"${query}"**.` +
      (names ? `\n\n**Did you mean:**\n${names}\n\nCall \`${tool}\` again with one of these names or slugs.` : `\n\nTry a shorter or differently spelled name, or use the matching search tool.`) +
      `\n\n_Source: ${SRC_PDB}_`,
  );
}

// ---------------- formatters ----------------

function charCard(i: PdbItem, full = false): string {
  const a = attrs(i);
  const rows: [string, unknown][] = [
    ["Also known as", full ? list(a.alias_names, 8) : list(a.alias_names, 3)],
    ["House", a.house],
    ["Species", a.species],
    ["Gender", a.gender],
    ["Blood status", a.blood_status],
    ["Born", a.born],
    ["Died", a.died],
    ["Nationality", a.nationality],
  ];
  if (full) {
    rows.push(
      ["Eyes", a.eye_color], ["Hair", a.hair_color], ["Skin", a.skin_color], ["Height", a.height], ["Weight", a.weight],
      ["Marital status", a.marital_status], ["Family", list(a.family_members, 10)], ["Romances", list(a.romances)],
      ["Jobs", list(a.jobs, 8)], ["Titles", list(a.titles, 8)], ["Wands", list(a.wands)],
      ["Patronus", a.patronus], ["Boggart", a.boggart], ["Animagus", a.animagus],
    );
  }
  return `### ${a.name}\n${facts(rows)}${a.wiki ? `\n- ${link("Wiki", a.wiki)}${a.image ? " · " + link("Image", a.image) : ""}` : ""}`;
}

const present = (rows: [string, unknown][]) =>
  rows.map(([k, v]) => [k, Array.isArray(v) ? list(v, 8) : clean(v)] as [string, unknown]).filter(([, v]) => v !== undefined && v !== "");

type Call = { name: string; arguments: Record<string, unknown> };

function charData(i: PdbItem, elixirs?: string[], again?: Call) {
  const a = attrs(i);
  return {
    kind: "character", name: a.name, image: a.image, wiki: a.wiki, house: clean(a.house), species: clean(a.species), again,
    family: a.family_members?.length ? { name: "character_family", arguments: { name_or_slug: a.slug } } : undefined,
    blood_status: clean(a.blood_status), gender: clean(a.gender), aliases: (a.alias_names ?? []).slice(0, 4), elixirs,
    sources: elixirs?.length ? `${SRC_PDB} + ${SRC_WW}` : SRC_PDB,
    rows: present([
      ["Born", a.born], ["Died", a.died], ["Nationality", a.nationality], ["Eyes", a.eye_color], ["Hair", a.hair_color],
      ["Height", a.height], ["Family", a.family_members], ["Jobs", a.jobs], ["Titles", a.titles], ["Wands", a.wands],
      ["Patronus", a.patronus], ["Boggart", a.boggart], ["Animagus", a.animagus],
    ]),
  };
}

function spellLine(i: PdbItem): string {
  const a = attrs(i);
  const inc = stripPron(a.incantation);
  return `- **${a.name}**${inc && norm(inc) !== norm(a.name) ? ` — _${inc}_` : ""} · ${a.category ?? "Spell"}${a.light && norm(a.light) !== "none" ? ` · ${a.light} light` : ""}\n  ${truncate(String(clean(a.effect) ?? "No effect recorded."), 160)} (\`${a.slug}\`)`;
}

// ---------------- server ----------------

export function createServer(): McpServer {
  const server = new McpServer({
    name: "hogwarts-mcp",
    title: "Hogwarts Archives",
    version: "1.0.0",
    icons: [{ src: ICON_DATA_URI, mimeType: "image/svg+xml", sizes: ["any"] }],
  } as any);

  // ---- inline card (MCP Apps) ----
  server.registerResource(
    "hogwarts-card",
    VIEW_URI,
    { title: "Hogwarts card", description: "Visual card for characters, spells, potions and houses.", mimeType: VIEW_MIME },
    async () => ({
      contents: [{ uri: VIEW_URI, mimeType: VIEW_MIME, text: VIEW_HTML, _meta: { ui: { csp: VIEW_CSP, prefersBorder: false } } }],
    }),
  );

  // ---- characters ----
  server.registerTool(
    "search_characters",
    {
      title: "🧙 Search Characters",
      description:
        "Search ~5,400 Harry Potter characters by name, optionally filtered by house, species or blood status. Use get_character for a full profile.",
      inputSchema: {
        query: optQ("Part of a name, e.g. 'weasley'. Leave empty to list by filters only."),
        house: optQ("Gryffindor, Slytherin, Ravenclaw or Hufflepuff."),
        species: optQ("e.g. Human, Goblin, House-elf, Centaur."),
        blood_status: optQ("e.g. Pure-blood, Half-blood, Muggle-born."),
        limit: limitSchema,
        page: pageSchema,
      },
      annotations: { title: "Search Characters", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ query, house, species, blood_status, limit, page }: any) => {
      const res = await pdbList(
        "characters",
        { name_cont: query, house_cont: house, species_cont: species, blood_status_cont: blood_status },
        { size: limit, page, sort: "name" },
      );
      if (res.total === 0) {
        if (query && !house && !species && !blood_status) {
          const r = await pdbResolve("characters", query);
          if (r.item) return text(charCard(r.item) + `\n\n_Source: ${SRC_PDB}_`);
          return didYouMean("character", query, r.suggestions, "get_character");
        }
        return text(`🔍 No characters match those filters. Try fewer filters.\n\n_Source: ${SRC_PDB}_`);
      }
      const body = res.items.map((i) => charCard(i)).join("\n\n");
      return card(`${body}${pageFooter(res.total, res.items.length, page, limit, "search_characters")}\n_Source: ${SRC_PDB}_`, {
        kind: "list", title: "Characters", sub: `${res.total} found`, total: res.total, sources: SRC_PDB,
        items: res.items.map((i) => ({
          title: attrs(i).name, image: attrs(i).image, icon: "🧙",
          sub: [attrs(i).house, attrs(i).species, attrs(i).blood_status].filter(Boolean).join(" · "),
          call: { name: "get_character", arguments: { name_or_slug: attrs(i).slug } },
        })),
        nav: { name: "search_characters", arguments: { query, house, species, blood_status, limit }, page, pages: Math.ceil(res.total / limit) },
      });
    }),
  );

  async function wwWizard(name: string) {
    const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/);
    if (parts.length < 2) return { ok: true as const, data: [] as any[] };
    return ww<any[]>("Wizards", { FirstName: parts[0], LastName: parts[parts.length - 1] });
  }

  server.registerTool(
    "get_character",
    {
      title: "📜 Get Character Profile",
      description:
        "Full profile of one character by name or slug (fuzzy, accent/case-insensitive). Enriched with Wizard World elixir data when available.",
      inputSchema: { name_or_slug: q("Name or slug, e.g. 'Hermione Granger' or 'severus-snape'.") },
      annotations: { title: "Get Character Profile", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ name_or_slug }: any) => {
      const r = await pdbResolve("characters", name_or_slug);
      if (!r.item) return didYouMean("character", name_or_slug, r.suggestions, "get_character");
      const a = attrs(r.item);
      let out = charCard(r.item, true) + `\n\n_Source: ${SRC_PDB}_`;
      let elixirs: string[] | undefined;
      const w = await wwWizard(a.name);
      if (!w.ok) out += `\n\n${WW_DOWN_NOTE}`;
      else {
        const hit = w.data.find((x: any) => similarity(`${x.firstName} ${x.lastName}`, a.name) > 0.8);
        if (hit?.elixirs?.length) {
          elixirs = hit.elixirs.map((e: any) => e.name);
          out += `\n\n**🧪 Elixirs invented/associated (${SRC_WW}):** ${elixirs!.join(", ")}`;
        }
      }
      return card(out, charData(r.item, elixirs));
    }),
  );

  // "Name (I) (née X) (mother) †" -> { name, relation, dead }
  function parseRelative(raw: string) {
    const dead = raw.includes("†");
    const s = raw.replace(/†/g, "").trim();
    const m = s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    const rel = (m ? m[2] : s).trim();
    const name = (m ? m[1] : s).replace(/\s*\((?:[IVX]+|née [^)]*)\)/g, "").trim();
    return { name: name || s, relation: rel.toLowerCase(), dead };
  }
  function relGroup(rel: string): string {
    if (/in-law|by marriage/.test(rel)) return "In-laws";
    if (/grand|ancestor/.test(rel)) return "Grandparents & ancestors";
    if (/^(father|mother|step|adoptive)/.test(rel)) return "Parents";
    if (/^(wife|husband|spouse|partner|ex-)/.test(rel)) return "Partner";
    if (/^(son|daughter|child)/.test(rel)) return "Children";
    if (/^(brother|sister|half|twin)/.test(rel)) return "Siblings";
    if (/aunt|uncle|cousin|niece|nephew|relative/.test(rel)) return "Extended family";
    if (/family/.test(rel)) return "Families";
    return "Other";
  }
  const GROUP_ORDER = ["Grandparents & ancestors", "Parents", "Partner", "Siblings", "Children", "Extended family", "In-laws", "Families", "Other"];

  server.registerTool(
    "character_family",
    {
      title: "🌳 Character Family",
      description: "Family of one character grouped by relation (parents, partner, siblings, children, in-laws…), from PotterDB. Use get_character for the full profile.",
      inputSchema: { name_or_slug: q("Name or slug, e.g. 'Harry Potter'.") },
      annotations: { title: "Character Family", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ name_or_slug }: any) => {
      const r = await pdbResolve("characters", name_or_slug);
      if (!r.item) return didYouMean("character", name_or_slug, r.suggestions, "character_family");
      const a = attrs(r.item);
      const rels: string[] = a.family_members ?? [];
      if (!rels.length) return text(`🌳 No family members recorded for **${a.name}**.\n\n_Source: ${SRC_PDB}_`);
      const by = new Map<string, ReturnType<typeof parseRelative>[]>();
      for (const raw of rels) {
        const p = parseRelative(String(raw));
        const g = relGroup(p.relation);
        by.set(g, [...(by.get(g) ?? []), p]);
      }
      const groups = GROUP_ORDER.filter((g) => by.has(g)).map((label) => ({ label, members: by.get(label)!.slice(0, 16) }));
      const md = groups
        .map((g) => `**${g.label}:** ${g.members.slice(0, 10).map((m) => `${m.dead ? "† " : ""}${m.name}${m.relation && m.relation !== m.name.toLowerCase() ? ` (${m.relation})` : ""}`).join(", ")}${by.get(g.label)!.length > 10 ? ` … +${by.get(g.label)!.length - 10} more` : ""}`)
        .join("\n");
      return card(`## 🌳 ${a.name} — family\n${md}\n\n_† = deceased · Source: ${SRC_PDB}_`, {
        kind: "family", name: a.name, image: a.image, house: clean(a.house), groups, sources: SRC_PDB,
        tree: { name: "family_tree", arguments: { name_or_slug: a.slug } },
      });
    }),
  );

  // How a relation word places someone relative to the person it is read from: generation offset + link kind.
  function relInfo(rel: string): { gen: number; kind: "parent" | "partner" | "child" | "sibling" | "other" } {
    const great = (rel.match(/great/g) ?? []).length;
    if (/in-law|by marriage/.test(rel)) return { gen: /^(father|mother|parent)/.test(rel) ? -1 : /^(son|daughter|child)/.test(rel) ? 1 : 0, kind: "other" };
    if (/grand/.test(rel)) return { gen: /(son|daughter|child)/.test(rel) ? 2 + great : -(2 + great), kind: "other" };
    if (/ancestor/.test(rel)) return { gen: -3, kind: "other" };
    if (/^(step-?|adoptive |foster )?(father|mother|parent)/.test(rel)) return { gen: -1, kind: "parent" };
    if (/^(wife|husband|spouse|partner|ex-|fianc|girlfriend|boyfriend|widow)/.test(rel)) return { gen: 0, kind: "partner" };
    if (/^(step-?|adoptive |foster )?(son|daughter|child)/.test(rel)) return { gen: 1, kind: "child" };
    if (/^(step-?|half-?)?(brother|sister|sibling|twin)/.test(rel)) return { gen: 0, kind: "sibling" };
    if (/aunt|uncle/.test(rel)) return { gen: -1, kind: "other" };
    if (/niece|nephew/.test(rel)) return { gen: 1, kind: "other" };
    return { gen: 0, kind: "other" };
  }
  const genLabel = (g: number) =>
    g < -3 ? "Earlier ancestors" : ({ "-3": "Ancestors", "-2": "Grandparents", "-1": "Parents' generation", "0": "Same generation", "1": "Children's generation", "2": "Grandchildren" } as Record<string, string>)[String(g)] ?? "Descendants";

  server.registerTool(
    "family_tree",
    {
      title: "🕸️ Family Tree",
      description:
        "Full graphical family tree of one character: ancestors on top, descendants below, partners linked, and (depth 2) the families of the closest relatives merged in. Click a name in the card to open that profile.",
      inputSchema: {
        name_or_slug: q("Name or slug, e.g. 'Harry Potter'."),
        depth: z.number().int().min(1).max(2).default(2).describe("1 = only the character's own recorded relatives; 2 (default) also merges in the families of parents, partner, children and siblings."),
      },
      annotations: { title: "Family Tree", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ name_or_slug, depth }: any) => {
      const r = await pdbResolve("characters", name_or_slug);
      if (!r.item) return didYouMean("character", name_or_slug, r.suggestions, "family_tree");
      const a = attrs(r.item);
      if (!a.family_members?.length) return text(`🌳 No family members recorded for **${a.name}**.\n\n_Source: ${SRC_PDB}_`);

      type N = { id: string; name: string; gen: number; dead?: boolean; house?: unknown; slug?: string; center?: boolean };
      const MAX = 70;
      const nodes = new Map<string, N>();
      const edges = new Map<string, [string, string, string]>(); // p = parent->child, m = partners, x = loose link
      const edge = (x: string, y: string, t: string) => {
        const k = t === "m" ? `${[x, y].sort().join("|")}m` : `${x}|${y}${t}`;
        if (!edges.has(k)) edges.set(k, [x, y, t]);
      };
      const center: N = { id: norm(a.name), name: String(a.name), gen: 0, dead: !!a.died, house: clean(a.house), slug: a.slug, center: true };
      nodes.set(center.id, center);

      const addFrom = (owner: N, rels: string[]) => {
        const sibs: string[] = [];
        const kinds = new Map<string, string>();
        for (const raw of rels) {
          const p = parseRelative(String(raw));
          const id = norm(p.name);
          if (!id || id === owner.id) continue;
          // placeholders like "Father-in-law", "Two paternal uncles", "Possible paternal relative"
          if (/^(father|mother|paternal|maternal|possible|unnamed|unknown|two|three|several|grandfather|grandmother|brother|sister|son|daughter)\b|in law$/.test(id)) continue;
          const info = relInfo(p.relation);
          let n = nodes.get(id);
          if (!n) {
            if (nodes.size >= MAX) continue;
            n = { id, name: p.name, gen: owner.gen + info.gen, dead: p.dead };
            nodes.set(id, n);
          }
          if (info.kind === "parent") edge(id, owner.id, "p");
          else if (info.kind === "child") edge(owner.id, id, "p");
          else if (info.kind === "partner") edge(id, owner.id, "m");
          else if (info.kind === "sibling") sibs.push(id);
          if (!kinds.has(id)) kinds.set(id, info.kind);
        }
        const ps = [...edges.values()].filter((e) => e[2] === "p" && e[1] === owner.id).map((e) => e[0]);
        for (const s of sibs) for (const pp of ps) edge(pp, s, "p");
        return kinds;
      };

      const kinds = addFrom(center, a.family_members);
      const expanded: string[] = [];
      if (depth > 1) {
        const order = ["parent", "partner", "child", "sibling"];
        const targets = [...kinds.entries()]
          .filter(([, k]) => order.includes(k))
          .sort((x, y) => order.indexOf(x[1]) - order.indexOf(y[1]))
          .slice(0, 10)
          .map(([id]) => nodes.get(id)!);
        // Exact slug first; otherwise a name search, accepting only a close name whose own family mentions the centre.
        const cw = norm(center.name).split(" ");
        const mentionsCenter = (i: PdbItem) => {
          const t = ` ${norm((attrs(i).family_members ?? []).join(" "))} `;
          return t.includes(` ${cw[0]} `) && t.includes(` ${cw[cw.length - 1]} `);
        };
        const load = async (n: N) => {
          const hit = await pdbBySlug("characters", slugify(n.name));
          if (hit) return hit;
          for (const term of [n.name, n.name.split(" ")[0]]) {
            const page = await pdbList("characters", { name_cont: term }, { size: 25, sort: "name" });
            const best = page.items
              .filter((i) => {
                const s = similarity(n.name, String(attrs(i).name));
                return s >= 0.97 || (s >= 0.75 && mentionsCenter(i));
              })
              .sort((x, y) => similarity(n.name, String(attrs(y).name)) - similarity(n.name, String(attrs(x).name)))[0];
            if (best) return best;
          }
          return undefined;
        };
        const got = await Promise.allSettled(targets.map(load));
        got.forEach((res, i) => {
          if (res.status !== "fulfilled" || !res.value) return;
          const b = attrs(res.value);
          const n = targets[i];
          n.house = clean(b.house);
          n.slug = b.slug;
          if (b.died) n.dead = true;
          addFrom(n, b.family_members ?? []);
          expanded.push(n.name);
        });
      }

      const byGen = new Map<number, string[]>();
      for (const n of nodes.values()) byGen.set(n.gen, [...(byGen.get(n.gen) ?? []), `${n.dead ? "† " : ""}${n.name}`]);
      const md = [...byGen.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([g, names]) => `**${genLabel(g)}:** ${names.slice(0, 14).join(", ")}${names.length > 14 ? ` … +${names.length - 14} more` : ""}`)
        .join("\n");
      const note = `${nodes.size} people${nodes.size >= MAX ? ` (capped at ${MAX})` : ""}${expanded.length ? ` · merged families of ${expanded.join(", ")}` : ""}`;
      return card(`## 🕸️ ${a.name} — family tree\n${md}\n\n_${note} · † = deceased · Source: ${SRC_PDB}_`, {
        kind: "tree", name: a.name, image: a.image, house: clean(a.house), centerId: center.id, note, sources: SRC_PDB,
        nodes: [...nodes.values()], edges: [...edges.values()],
      });
    }),
  );

  server.registerTool(
    "house_roster",
    {
      title: "🏰 House Roster",
      description:
        "Overview of a Hogwarts house: founder, colours, ghost, traits (Wizard World) plus a page of its known members (PotterDB).",
      inputSchema: {
        house: q("Gryffindor, Slytherin, Ravenclaw or Hufflepuff."),
        limit: limitSchema,
        page: pageSchema,
      },
      annotations: { title: "House Roster", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ house, limit, page }: any) => {
      const m = bestMatches(house, HOUSES, (h) => h, 1)[0];
      if (!m) return text(`🔍 Unknown house "${house}". Choose one of: ${HOUSES.join(", ")}.`);
      const name = m.item;
      const [members, info] = await Promise.all([
        pdbList("characters", { house_eq: name }, { size: limit, page, sort: "name" }),
        ww<any[]>("Houses"),
      ]);
      let head = `## 🏰 ${name}\n`;
      let hInfo: Record<string, unknown> | undefined;
      if (info.ok) {
        const h = info.data.find((x: any) => norm(x.name) === norm(name));
        if (h) {
          hInfo = {
            founder: h.founder, colours: h.houseColours, animal: h.animal, element: h.element, ghost: h.ghost,
            commonRoom: h.commonRoom, heads: list((h.heads ?? []).map((x: any) => `${x.firstName} ${x.lastName}`)),
            traits: (h.traits ?? []).map((x: any) => x.name).slice(0, 12),
          };
          head += facts([
            ["Founder", h.founder], ["Colours", h.houseColours], ["Animal", h.animal], ["Element", h.element],
            ["Ghost", h.ghost], ["Common room", h.commonRoom],
            ["Heads", list((h.heads ?? []).map((x: any) => `${x.firstName} ${x.lastName}`))],
            ["Traits", list((h.traits ?? []).map((x: any) => x.name), 12)],
          ]) + `\n_House info source: ${SRC_WW}_\n`;
        }
      } else head += `${WW_DOWN_NOTE}\n`;
      const rows = members.items.map((i) => [attrs(i).name, attrs(i).species, attrs(i).blood_status, attrs(i).gender]);
      const body = `\n### Members (${SRC_PDB})\n${table(["Name", "Species", "Blood status", "Gender"], rows)}`;
      return card(head + body + pageFooter(members.total, members.items.length, page, limit, "house_roster"), {
        kind: "house", name, info: hInfo, total: members.total, sources: hInfo ? `${SRC_PDB} + ${SRC_WW}` : SRC_PDB,
        members: members.items.map((i) => ({ name: attrs(i).name, slug: attrs(i).slug, species: attrs(i).species, blood_status: attrs(i).blood_status })),
        nav: { name: "house_roster", arguments: { house: name, limit }, page, pages: Math.ceil(members.total / limit) },
      });
    }),
  );

  server.registerTool(
    "random_character",
    {
      title: "🎲 Random Character",
      description: "Pick a random character, optionally from one house. Great for trivia and inspiration.",
      inputSchema: { house: optQ("Optional house to draw from.") },
      annotations: { title: "Random Character", ...READ_ONLY, idempotentHint: false },
      _meta: UI_META,
    },
    safe(async ({ house }: any) => {
      const h = house ? bestMatches(house, HOUSES, (x) => x, 1)[0]?.item : undefined;
      if (house && !h) return text(`🔍 Unknown house "${house}". Choose one of: ${HOUSES.join(", ")}.`);
      const again: Call = { name: "random_character", arguments: h ? { house: h } : {} };
      // PotterDB has no popularity field, so draw from a curated list of well-known characters first.
      const pool = [...(h ? FAMOUS[h] : Object.values(FAMOUS).flat())].sort(() => Math.random() - 0.5);
      for (const slug of pool.slice(0, 6)) {
        const item = await pdbBySlug("characters", slug).catch(() => undefined);
        if (item) return card(`🎲 ${charCard(item, true)}\n\n_Source: ${SRC_PDB} · picked from well-known characters_`, charData(item, undefined, again));
      }
      const f = h ? { house_eq: h } : {};
      const n = await pdbTotal("characters", f);
      if (!n) return text(`🔍 No characters found.`);
      const res = await pdbList("characters", f, { size: 1, page: 1 + Math.floor(Math.random() * n) });
      return card(`🎲 ${charCard(res.items[0], true)}\n\n_Source: ${SRC_PDB}_`, charData(res.items[0], undefined, again));
    }),
  );

  server.registerTool(
    "compare_characters",
    {
      title: "⚔️ Compare Characters",
      description: "Side-by-side table of two characters' key attributes (house, species, wand, patronus, etc.).",
      inputSchema: { a: q("First character name or slug."), b: q("Second character name or slug.") },
      annotations: { title: "Compare Characters", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ a, b }: any) => {
      const [ra, rb] = await Promise.all([pdbResolve("characters", a), pdbResolve("characters", b)]);
      if (!ra.item) return didYouMean("character", a, ra.suggestions, "compare_characters");
      if (!rb.item) return didYouMean("character", b, rb.suggestions, "compare_characters");
      const A = attrs(ra.item), B = attrs(rb.item);
      const fields: [string, string][] = [
        ["House", "house"], ["Species", "species"], ["Gender", "gender"], ["Blood status", "blood_status"], ["Born", "born"],
        ["Died", "died"], ["Eyes", "eye_color"], ["Hair", "hair_color"], ["Patronus", "patronus"], ["Boggart", "boggart"],
        ["Animagus", "animagus"], ["Wands", "wands"], ["Jobs", "jobs"], ["Titles", "titles"],
      ];
      const fmt = (v: unknown) => (Array.isArray(v) ? list(v, 3) : clean(v));
      const rows = fields
        .map(([label, k]) => [label, truncate(String(fmt(A[k]) ?? "—"), 120), truncate(String(fmt(B[k]) ?? "—"), 120)])
        .filter((r) => r[1] !== "—" || r[2] !== "—");
      return card(`## ⚔️ ${A.name} vs ${B.name}\n${table(["", A.name, B.name], rows)}\n\n_Source: ${SRC_PDB}_`, {
        kind: "compare", sources: SRC_PDB, rows,
        a: { name: A.name, image: A.image }, b: { name: B.name, image: B.image },
      });
    }),
  );

  // ---- spells ----
  server.registerTool(
    "search_spells",
    {
      title: "✨ Search Spells",
      description: "Search ~345 spells by name, category, incantation or words in the effect. Use get_spell for details.",
      inputSchema: {
        query: optQ("Part of the spell name."),
        category: optQ("e.g. Charm, Curse, Hex, Jinx, Transfiguration, Spell, Counter-spell."),
        incantation: optQ("Part of the incantation, e.g. 'lumos'."),
        effect_contains: optQ("Word in the effect, e.g. 'light' or 'fire'."),
        limit: limitSchema,
        page: pageSchema,
      },
      annotations: { title: "Search Spells", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ query, category, incantation, effect_contains, limit, page }: any) => {
      const res = await pdbList(
        "spells",
        { name_cont: query, category_cont: category, incantation_cont: incantation, effect_cont: effect_contains },
        { size: limit, page, sort: "name" },
      );
      if (res.total === 0) {
        if (query) {
          const r = await pdbResolve("spells", query);
          if (r.item) return text(spellLine(r.item) + `\n\n_Source: ${SRC_PDB}_`);
          return didYouMean("spell", query, r.suggestions, "get_spell");
        }
        return text(`🔍 No spells match those filters.\n\n_Source: ${SRC_PDB}_`);
      }
      return card(res.items.map(spellLine).join("\n") + pageFooter(res.total, res.items.length, page, limit, "search_spells") + `\n_Source: ${SRC_PDB}_`, {
        kind: "list", title: "Spells", sub: `${res.total} found`, total: res.total, sources: SRC_PDB,
        items: res.items.map((i) => ({
          title: attrs(i).name, image: attrs(i).image, icon: "🪄",
          sub: [stripPron(attrs(i).incantation), attrs(i).category, attrs(i).light && norm(attrs(i).light) !== "none" ? `${attrs(i).light} light` : undefined].filter(Boolean).join(" · "),
          call: { name: "get_spell", arguments: { name_or_slug: attrs(i).slug } },
        })),
        nav: { name: "search_spells", arguments: { query, category, incantation, effect_contains, limit }, page, pages: Math.ceil(res.total / limit) },
      });
    }),
  );

  server.registerTool(
    "get_spell",
    {
      title: "🪄 Get Spell",
      description: "One spell by name or slug, merging PotterDB and Wizard World and showing which source gave each field.",
      inputSchema: { name_or_slug: q("e.g. 'Expelliarmus' or 'lumos-solem'.") },
      annotations: { title: "Get Spell", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ name_or_slug }: any) => {
      const r = await pdbResolve("spells", name_or_slug);
      if (!r.item) return didYouMean("spell", name_or_slug, r.suggestions, "get_spell");
      const p = attrs(r.item);
      let w: any | undefined;
      let wwDown = false;
      for (const params of [{ Name: p.name }, { Incantation: stripPron(p.incantation) }]) {
        if (!params.Name && !params.Incantation) continue;
        const res = await ww<any[]>("Spells", params as any);
        if (!res.ok) { wwDown = true; break; }
        w = res.data.find((x: any) => similarity(x.name, p.name) >= 0.85 || (p.incantation && similarity(x.incantation ?? "", stripPron(p.incantation) ?? "") >= 0.95));
        if (w) break;
      }
      const row = (label: string, pv: unknown, wv: unknown): string[] | undefined => {
        const a = clean(pv), b = clean(wv);
        if (a === undefined && b === undefined) return undefined;
        const src = a !== undefined && b !== undefined ? (norm(a) === norm(b) ? "both" : `${SRC_PDB} / ${SRC_WW}`) : a !== undefined ? SRC_PDB : SRC_WW;
        const val = a !== undefined && b !== undefined && norm(a) !== norm(b) ? `${a} · _${b}_` : String(a ?? b);
        return [label, truncate(val, 220), src];
      };
      const rows = [
        row("Incantation", stripPron(p.incantation), w?.incantation),
        row("Category", p.category, w?.type),
        row("Effect", p.effect, w?.effect),
        row("Light", p.light, w?.light),
        row("Hand motion", p.hand, undefined),
        row("Creator", p.creator, w?.creator),
        row("Can be verbal", undefined, w?.canBeVerbal),
      ].filter(Boolean) as string[][];
      let out = `## 🪄 ${p.name}\n${table(["Field", "Value", "Source"], rows)}`;
      if (p.wiki || p.image) out += `\n\n${[link("Wiki", p.wiki), link("Image", p.image)].filter(Boolean).join(" · ")}`;
      if (wwDown) out += `\n\n${WW_DOWN_NOTE}`;
      else if (!w) out += `\n\n_No matching entry in ${SRC_WW}._`;
      return card(out + `\n\n_Sources: ${SRC_PDB}${w ? ", " + SRC_WW : ""}_`, {
        kind: "spell", name: p.name, image: p.image, wiki: p.wiki, sources: w ? `${SRC_PDB} + ${SRC_WW}` : SRC_PDB,
        incantation: stripPron(p.incantation) ?? w?.incantation, category: clean(p.category) ?? clean(w?.type),
        effect: clean(p.effect) ?? clean(w?.effect), light: clean(p.light) ?? clean(w?.light),
        rows: present([["Hand motion", p.hand], ["Creator", p.creator ?? w?.creator]]),
      });
    }),
  );

  const spellData = (a: Record<string, any>, again?: Call) => ({
    kind: "spell", name: a.name, image: a.image, wiki: a.wiki, sources: SRC_PDB, again,
    incantation: stripPron(a.incantation), category: clean(a.category), effect: clean(a.effect), light: clean(a.light),
    rows: present([["Hand motion", a.hand], ["Creator", a.creator]]),
  });

  server.registerTool(
    "random_spell",
    {
      title: "🎲 Random Spell",
      description: "Pick a random spell, optionally from one category (Charm, Curse, Hex…).",
      inputSchema: { category: optQ("Optional category.") },
      annotations: { title: "Random Spell", ...READ_ONLY, idempotentHint: false },
      _meta: UI_META,
    },
    safe(async ({ category }: any) => {
      const f = { category_cont: category };
      const n = await pdbTotal("spells", f);
      if (!n) return text(`🔍 No spells in category "${category}".`);
      const res = await pdbList("spells", f, { size: 1, page: 1 + Math.floor(Math.random() * n) });
      const a = attrs(res.items[0]);
      return card(`🎲 ${spellLine(res.items[0])}\n${facts([["Hand motion", a.hand], ["Creator", a.creator]])}\n\n_Source: ${SRC_PDB}_`, spellData(a, { name: "random_spell", arguments: category ? { category } : {} }));
    }),
  );

  // ---- potions ----
  const potionBlock = (p: Record<string, any>) =>
    facts([
      ["Effect", p.effect], ["Difficulty", p.difficulty], ["Characteristics", p.characteristics],
      ["Ingredients", p.ingredients], ["Side effects", p.side_effects], ["Brewing time", p.time],
      ["Inventors", p.inventors], ["Manufacturers", p.manufacturers],
    ]);

  server.registerTool(
    "search_potions",
    {
      title: "🧪 Search Potions",
      description: "Search potions (PotterDB) and elixirs (Wizard World) by name.",
      inputSchema: { query: optQ("Part of the potion name, e.g. 'polyjuice'."), limit: limitSchema, page: pageSchema },
      annotations: { title: "Search Potions", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ query, limit, page }: any) => {
      const [res, el] = await Promise.all([
        pdbList("potions", { name_cont: query }, { size: limit, page, sort: "name" }),
        page === 1 ? ww<any[]>("Elixirs", { Name: query }) : Promise.resolve({ ok: true as const, data: [] as any[] }),
      ]);
      if (res.total === 0 && (!el.ok || el.data.length === 0)) {
        if (query) {
          const r = await pdbResolve("potions", query);
          if (r.item) return text(`### ${attrs(r.item).name}\n${potionBlock(attrs(r.item))}\n\n_Source: ${SRC_PDB}_`);
          return didYouMean("potion", query, r.suggestions, "get_potion");
        }
        return text(`🔍 No potions found.`);
      }
      let out = res.items.map((i) => `- **${attrs(i).name}**${attrs(i).difficulty ? ` · ${attrs(i).difficulty}` : ""} — ${truncate(String(clean(attrs(i).effect) ?? "no effect recorded"), 140)} (\`${attrs(i).slug}\`)`).join("\n");
      out += pageFooter(res.total, res.items.length, page, limit, "search_potions") + `\n_Source: ${SRC_PDB}_`;
      let note: string | undefined;
      if (el.ok && el.data.length) {
        note = `Elixirs also in ${SRC_WW}: ${el.data.slice(0, 10).map((e: any) => `${e.name}${e.difficulty && e.difficulty !== "Unknown" ? ` (${e.difficulty})` : ""}`).join(", ")}`;
        out += `\n\n**${note.replace(":", ":**")}`;
      } else if (!el.ok) {
        note = WW_DOWN_NOTE;
        out += `\n\n${WW_DOWN_NOTE}`;
      }
      return card(out, {
        kind: "list", title: "Potions", sub: `${res.total} found`, total: res.total, note, sources: SRC_PDB,
        items: res.items.map((i) => ({
          title: attrs(i).name, image: attrs(i).image, icon: "⚗️",
          sub: [attrs(i).difficulty, truncate(String(clean(attrs(i).effect) ?? ""), 80)].filter(Boolean).join(" · "),
          call: { name: "get_potion", arguments: { name_or_slug: attrs(i).slug } },
        })),
        nav: { name: "search_potions", arguments: { query, limit }, page, pages: Math.ceil(res.total / limit) },
      });
    }),
  );

  server.registerTool(
    "get_potion",
    {
      title: "⚗️ Get Potion",
      description: "One potion by name or slug with ingredients, difficulty and effects, merging PotterDB and Wizard World elixirs.",
      inputSchema: { name_or_slug: q("e.g. 'Felix Felicis'.") },
      annotations: { title: "Get Potion", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ name_or_slug }: any) => {
      const r = await pdbResolve("potions", name_or_slug);
      const wr = await ww<any[]>("Elixirs", { Name: r.item ? attrs(r.item).name : name_or_slug });
      const w = wr.ok ? wr.data.find((x: any) => similarity(x.name, r.item ? attrs(r.item).name : name_or_slug) >= 0.8) : undefined;
      if (!r.item && !w) return didYouMean("potion", name_or_slug, r.suggestions, "get_potion");
      const name = r.item ? attrs(r.item).name : w.name;
      let out = `## ⚗️ ${name}\n`;
      if (r.item) out += `**${SRC_PDB}**\n${potionBlock(attrs(r.item))}\n`;
      if (w) {
        out += `\n**${SRC_WW}**\n` + facts([
          ["Effect", w.effect], ["Difficulty", w.difficulty !== "Unknown" ? w.difficulty : undefined],
          ["Ingredients", list((w.ingredients ?? []).map((x: any) => x.name), 15)],
          ["Side effects", w.sideEffects], ["Characteristics", w.characteristics], ["Time", w.time],
          ["Inventors", list((w.inventors ?? []).map((x: any) => `${x.firstName} ${x.lastName}`))], ["Manufacturer", w.manufacturer],
        ]) + "\n";
      } else if (!wr.ok) out += `\n${WW_DOWN_NOTE}\n`;
      if (r.item && attrs(r.item).wiki) out += `\n${link("Wiki", attrs(r.item).wiki)}`;
      const pp = r.item ? attrs(r.item) : {};
      const ings = (w?.ingredients ?? []).map((x: any) => x.name);
      const pdbIngs = typeof pp.ingredients === "string" ? pp.ingredients.split(/,\s*/).filter(Boolean) : [];
      return card(out + `\n_Sources: ${[r.item ? SRC_PDB : "", w ? SRC_WW : ""].filter(Boolean).join(", ")}_`, {
        kind: "potion", name, image: pp.image, wiki: pp.wiki, sources: [r.item ? SRC_PDB : "", w ? SRC_WW : ""].filter(Boolean).join(" + "),
        effect: clean(pp.effect) ?? clean(w?.effect), difficulty: clean(pp.difficulty) ?? clean(w?.difficulty !== "Unknown" ? w?.difficulty : undefined),
        ingredients: (ings.length ? ings : pdbIngs).slice(0, 20),
        rows: present([
          ["Characteristics", pp.characteristics ?? w?.characteristics], ["Side effects", pp.side_effects ?? w?.sideEffects],
          ["Brewing time", pp.time ?? w?.time], ["Inventors", pp.inventors ?? list((w?.inventors ?? []).map((x: any) => `${x.firstName} ${x.lastName}`))],
          ["Manufacturers", pp.manufacturers ?? w?.manufacturer],
        ]),
      });
    }),
  );

  // ---- books, chapters, movies ----
  async function allBooks() {
    return (await pdbList("books", {}, { size: 20, sort: "release_date" })).items;
  }
  // Local corrections for known upstream errors (PotterDB lists Prisoner of Azkaban as 2002-11-15).
  const MOVIE_FIXES: Record<string, Record<string, unknown>> = {
    "prisoner of azkaban": { release_date: "2004-06-04" },
  };
  async function allMovies() {
    const items = (await pdbList("movies", {}, { size: 20, sort: "release_date" })).items;
    return items.map((m) => {
      const fix = Object.entries(MOVIE_FIXES).find(([k]) => norm(String(attrs(m).title)).includes(k))?.[1];
      return fix ? { ...m, attributes: { ...attrs(m), ...fix } } : m;
    });
  }
  function pick(items: PdbItem[], query: string) {
    const ranked = bestMatches(query, items, (i) => `${attrs(i).title} ${attrs(i).slug}`, 3);
    const n = Number(query);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return { item: items[n - 1], suggestions: [] as PdbItem[] };
    if (ranked[0] && ranked[0].score >= 0.7) return { item: ranked[0].item, suggestions: [] as PdbItem[] };
    return { item: undefined, suggestions: ranked.map((r) => r.item) };
  }

  server.registerTool(
    "list_books",
    {
      title: "📚 List Books",
      description: "All Harry Potter books in release order with author, pages and release date.",
      inputSchema: {},
      annotations: { title: "List Books", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async () => {
      const books = await allBooks();
      return card(`## 📚 Books\n${table(["#", "Title", "Pages", "Released"], books.map((b, i) => [i + 1, attrs(b).title, attrs(b).pages, attrs(b).release_date]))}\n\nUse \`get_book\` with a title or number.\n\n_Source: ${SRC_PDB}_`, {
        kind: "list", title: "Books", sub: `${books.length} books`, sources: SRC_PDB,
        items: books.map((b, i) => ({
          title: attrs(b).title, image: attrs(b).cover, icon: "📚",
          sub: [`${attrs(b).pages} pages`, attrs(b).release_date].join(" · "),
          call: { name: "get_book", arguments: { title_or_number: String(i + 1) } },
        })),
      });
    }),
  );

  server.registerTool(
    "get_book",
    {
      title: "📖 Get Book",
      description: "Details and summary of one book plus its chapter list. Accepts a title, slug or number 1-7.",
      inputSchema: { title_or_number: q("e.g. 'Goblet of Fire' or '4'.") },
      annotations: { title: "Get Book", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ title_or_number }: any) => {
      const books = await allBooks();
      const r = pick(books, title_or_number);
      if (!r.item) return didYouMean("book", title_or_number, r.suggestions, "get_book");
      const b = attrs(r.item);
      const ch = await getChapters(r.item.id);
      return card(
        `## 📖 ${b.title}\n${facts([["Author", b.author], ["Pages", b.pages], ["Released", b.release_date], ["Dedication", b.dedication]])}\n\n${truncate(String(b.summary ?? ""), 900)}\n\n**Chapters (${ch.length}):** ${ch.map((c) => `${attrs(c).order}. ${attrs(c).title}`).join(" · ")}\n\n${link("Wiki", b.wiki) ?? ""}\n_Source: ${SRC_PDB}_`,
        {
          kind: "detail", name: b.title, image: b.cover, icon: "📖", subtitle: b.author, sources: SRC_PDB,
          badges: [b.pages ? `${b.pages} pages` : undefined, b.release_date],
          summary: truncate(String(b.summary ?? ""), 600),
          rows: present([["Dedication", b.dedication]]),
          chipsLabel: `Chapters (${ch.length})`, chips: ch.map((c) => `${attrs(c).order}. ${attrs(c).title}`),
          links: b.wiki ? [{ label: "Wiki", url: b.wiki }] : [],
        },
      );
    }),
  );

  async function getChapters(bookId: string): Promise<PdbItem[]> {
    return (await pdbList(`books/${bookId}/chapters`, {}, { size: 100 })).items;
  }

  server.registerTool(
    "search_chapters",
    {
      title: "🔎 Search Chapters",
      description: "Find book chapters by words in the title or short summary (not the full text), optionally within one book. Try specific names or events, e.g. 'Horntail' or 'Triwizard'.",
      inputSchema: {
        query: q("Word or phrase, e.g. 'dragon' or 'Triwizard'."),
        book: optQ("Optional book title or number to restrict the search."),
        limit: limitSchema,
        page: pageSchema,
      },
      annotations: { title: "Search Chapters", ...READ_ONLY },
    },
    safe(async ({ query, book, limit, page }: any) => {
      let books = await allBooks();
      if (book) {
        const r = pick(books, book);
        if (!r.item) return didYouMean("book", book, r.suggestions, "search_chapters");
        books = [r.item];
      }
      const lists = await Promise.all(books.map(async (b) => (await getChapters(b.id)).map((c) => ({ b, c }))));
      const nq = norm(query);
      const hits = lists.flat().filter(({ c }) => norm(`${attrs(c).title} ${attrs(c).summary}`).includes(nq));
      if (!hits.length) return text(`🔍 No chapters mention "${query}".\n\n_Source: ${SRC_PDB}_`);
      const slice = hits.slice((page - 1) * limit, page * limit);
      return text(
        slice.map(({ b, c }) => `- **${attrs(b).title}**, ch. ${attrs(c).order}: _${attrs(c).title}_\n  ${truncate(String(attrs(c).summary ?? ""), 180)}`).join("\n") +
          pageFooter(hits.length, slice.length, page, limit, "search_chapters") + `\n_Source: ${SRC_PDB}_`,
      );
    }),
  );

  server.registerTool(
    "list_movies",
    {
      title: "🎬 List Movies",
      description: "All Harry Potter films in release order with director, runtime and release date.",
      inputSchema: {},
      annotations: { title: "List Movies", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async () => {
      const m = await allMovies();
      return card(`## 🎬 Movies\n${table(["#", "Title", "Director", "Runtime", "Released"], m.map((x, i) => [i + 1, attrs(x).title, list(attrs(x).directors), attrs(x).running_time, attrs(x).release_date]))}\n\nUse \`get_movie\` with a title or number.\n\n_Source: ${SRC_PDB}_`, {
        kind: "list", title: "Movies", sub: `${m.length} films`, sources: SRC_PDB,
        items: m.map((x, i) => ({
          title: attrs(x).title, image: attrs(x).poster, icon: "🎬",
          sub: [list(attrs(x).directors), attrs(x).running_time, attrs(x).release_date].filter(Boolean).join(" · "),
          call: { name: "get_movie", arguments: { title_or_number: String(i + 1) } },
        })),
      });
    }),
  );

  server.registerTool(
    "get_movie",
    {
      title: "🍿 Get Movie",
      description: "Details of one film: crew, budget, box office and summary. Accepts a title, slug or number.",
      inputSchema: { title_or_number: q("e.g. 'Prisoner of Azkaban' or '3'.") },
      annotations: { title: "Get Movie", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async ({ title_or_number }: any) => {
      const movies = await allMovies();
      const r = pick(movies, title_or_number);
      if (!r.item) return didYouMean("movie", title_or_number, r.suggestions, "get_movie");
      const m = attrs(r.item);
      return card(
        `## 🍿 ${m.title}\n${facts([
          ["Released", m.release_date], ["Runtime", m.running_time], ["Rating", m.rating], ["Directors", list(m.directors)],
          ["Screenwriters", list(m.screenwriters)], ["Producers", list(m.producers)], ["Music", list(m.music_composers)],
          ["Budget", m.budget], ["Box office", m.box_office], ["Distributors", list(m.distributors)],
        ])}\n\n${truncate(String(m.summary ?? "").trim(), 800)}\n\n${[link("Trailer", m.trailer), link("Wiki", m.wiki)].filter(Boolean).join(" · ")}\n_Source: ${SRC_PDB} (community data; dates and figures may contain errors)_`,
        {
          kind: "detail", name: m.title, image: m.poster, icon: "🍿", subtitle: list(m.directors), sources: `${SRC_PDB} (some dates corrected locally)`,
          badges: [m.release_date, m.running_time, m.rating],
          summary: truncate(String(m.summary ?? "").trim(), 600),
          rows: present([
            ["Screenwriters", m.screenwriters], ["Producers", m.producers], ["Music", m.music_composers],
            ["Budget", m.budget], ["Box office", m.box_office], ["Distributors", m.distributors],
          ]),
          links: [m.trailer ? { label: "Trailer", url: m.trailer } : undefined, m.wiki ? { label: "Wiki", url: m.wiki } : undefined].filter(Boolean),
        },
      );
    }),
  );

  // ---- diagnostics ----
  server.registerTool(
    "sources_status",
    {
      title: "🩺 Sources Status",
      description: "Check whether PotterDB and Wizard World are reachable, with response times. Use for debugging.",
      inputSchema: {},
      annotations: { title: "Sources Status", ...READ_ONLY },
      _meta: UI_META,
    },
    safe(async () => {
      const ping = async (name: string, url: string) => {
        const t0 = Date.now();
        const ms = () => `${Date.now() - t0} ms`;
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
          return { name, ok: r.ok, status: r.ok ? "up" : `HTTP ${r.status}`, latency: ms(), url };
        } catch (e) {
          return { name, ok: false, status: e instanceof Error ? e.message : "unreachable", latency: ms(), url };
        }
      };
      const res = await Promise.all([
        ping(SRC_PDB, `${PDB}/spells?page%5Bsize%5D=1`),
        ping(SRC_WW, `${WW}/Houses`),
      ]);
      const rows = res.map((r) => [r.name, r.ok ? "✅ up" : `❌ ${r.status}`, r.latency, r.url]);
      const note = "If Wizard World is down, tools still work from PotterDB.";
      return card(`## 🩺 Sources\n${table(["Source", "Status", "Latency", "Probe"], rows)}\n\n${note}`, { kind: "status", rows: res, note });
    }),
  );

  return server;
}
