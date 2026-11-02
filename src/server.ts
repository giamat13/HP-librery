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
  list,
  norm,
  pageFooter,
  similarity,
  table,
  truncate,
} from "./lib/text.js";
import { ICON_DATA_URI } from "./icon.js";

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

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): Out => ({ content: [{ type: "text", text: t }] });
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
      return text(`${body}${pageFooter(res.total, res.items.length, page, limit, "search_characters")}\n_Source: ${SRC_PDB}_`);
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
    },
    safe(async ({ name_or_slug }: any) => {
      const r = await pdbResolve("characters", name_or_slug);
      if (!r.item) return didYouMean("character", name_or_slug, r.suggestions, "get_character");
      const a = attrs(r.item);
      let out = charCard(r.item, true) + `\n\n_Source: ${SRC_PDB}_`;
      const w = await wwWizard(a.name);
      if (!w.ok) out += `\n\n${WW_DOWN_NOTE}`;
      else {
        const hit = w.data.find((x: any) => similarity(`${x.firstName} ${x.lastName}`, a.name) > 0.8);
        if (hit?.elixirs?.length) out += `\n\n**🧪 Elixirs invented/associated (${SRC_WW}):** ${hit.elixirs.map((e: any) => e.name).join(", ")}`;
      }
      return text(out);
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
      if (info.ok) {
        const h = info.data.find((x: any) => norm(x.name) === norm(name));
        if (h) {
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
      return text(head + body + pageFooter(members.total, members.items.length, page, limit, "house_roster"));
    }),
  );

  server.registerTool(
    "random_character",
    {
      title: "🎲 Random Character",
      description: "Pick a random character, optionally from one house. Great for trivia and inspiration.",
      inputSchema: { house: optQ("Optional house to draw from.") },
      annotations: { title: "Random Character", ...READ_ONLY, idempotentHint: false },
    },
    safe(async ({ house }: any) => {
      const h = house ? bestMatches(house, HOUSES, (x) => x, 1)[0]?.item : undefined;
      if (house && !h) return text(`🔍 Unknown house "${house}". Choose one of: ${HOUSES.join(", ")}.`);
      // PotterDB has no popularity field, so draw from a curated list of well-known characters first.
      const pool = [...(h ? FAMOUS[h] : Object.values(FAMOUS).flat())].sort(() => Math.random() - 0.5);
      for (const slug of pool.slice(0, 6)) {
        const item = await pdbBySlug("characters", slug).catch(() => undefined);
        if (item) return text(`🎲 ${charCard(item, true)}\n\n_Source: ${SRC_PDB} · picked from well-known characters_`);
      }
      const f = h ? { house_eq: h } : {};
      const n = await pdbTotal("characters", f);
      if (!n) return text(`🔍 No characters found.`);
      const res = await pdbList("characters", f, { size: 1, page: 1 + Math.floor(Math.random() * n) });
      return text(`🎲 ${charCard(res.items[0], true)}\n\n_Source: ${SRC_PDB}_`);
    }),
  );

  server.registerTool(
    "compare_characters",
    {
      title: "⚔️ Compare Characters",
      description: "Side-by-side table of two characters' key attributes (house, species, wand, patronus, etc.).",
      inputSchema: { a: q("First character name or slug."), b: q("Second character name or slug.") },
      annotations: { title: "Compare Characters", ...READ_ONLY },
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
      return text(`## ⚔️ ${A.name} vs ${B.name}\n${table(["", A.name, B.name], rows)}\n\n_Source: ${SRC_PDB}_`);
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
      return text(res.items.map(spellLine).join("\n") + pageFooter(res.total, res.items.length, page, limit, "search_spells") + `\n_Source: ${SRC_PDB}_`);
    }),
  );

  server.registerTool(
    "get_spell",
    {
      title: "🪄 Get Spell",
      description: "One spell by name or slug, merging PotterDB and Wizard World and showing which source gave each field.",
      inputSchema: { name_or_slug: q("e.g. 'Expelliarmus' or 'lumos-solem'.") },
      annotations: { title: "Get Spell", ...READ_ONLY },
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
      return text(out + `\n\n_Sources: ${SRC_PDB}${w ? ", " + SRC_WW : ""}_`);
    }),
  );

  server.registerTool(
    "random_spell",
    {
      title: "🎲 Random Spell",
      description: "Pick a random spell, optionally from one category (Charm, Curse, Hex…).",
      inputSchema: { category: optQ("Optional category.") },
      annotations: { title: "Random Spell", ...READ_ONLY, idempotentHint: false },
    },
    safe(async ({ category }: any) => {
      const f = { category_cont: category };
      const n = await pdbTotal("spells", f);
      if (!n) return text(`🔍 No spells in category "${category}".`);
      const res = await pdbList("spells", f, { size: 1, page: 1 + Math.floor(Math.random() * n) });
      const a = attrs(res.items[0]);
      return text(`🎲 ${spellLine(res.items[0])}\n${facts([["Hand motion", a.hand], ["Creator", a.creator]])}\n\n_Source: ${SRC_PDB}_`);
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
      if (el.ok && el.data.length) {
        out += `\n\n**Elixirs also in ${SRC_WW}:** ${el.data.slice(0, 10).map((e: any) => `${e.name}${e.difficulty && e.difficulty !== "Unknown" ? ` (${e.difficulty})` : ""}`).join(", ")}`;
      } else if (!el.ok) out += `\n\n${WW_DOWN_NOTE}`;
      return text(out);
    }),
  );

  server.registerTool(
    "get_potion",
    {
      title: "⚗️ Get Potion",
      description: "One potion by name or slug with ingredients, difficulty and effects, merging PotterDB and Wizard World elixirs.",
      inputSchema: { name_or_slug: q("e.g. 'Felix Felicis'.") },
      annotations: { title: "Get Potion", ...READ_ONLY },
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
      return text(out + `\n_Sources: ${[r.item ? SRC_PDB : "", w ? SRC_WW : ""].filter(Boolean).join(", ")}_`);
    }),
  );

  // ---- books, chapters, movies ----
  async function allBooks() {
    return (await pdbList("books", {}, { size: 20, sort: "release_date" })).items;
  }
  async function allMovies() {
    return (await pdbList("movies", {}, { size: 20, sort: "release_date" })).items;
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
    },
    safe(async () => {
      const books = await allBooks();
      return text(`## 📚 Books\n${table(["#", "Title", "Pages", "Released"], books.map((b, i) => [i + 1, attrs(b).title, attrs(b).pages, attrs(b).release_date]))}\n\nUse \`get_book\` with a title or number.\n\n_Source: ${SRC_PDB}_`);
    }),
  );

  server.registerTool(
    "get_book",
    {
      title: "📖 Get Book",
      description: "Details and summary of one book plus its chapter list. Accepts a title, slug or number 1-7.",
      inputSchema: { title_or_number: q("e.g. 'Goblet of Fire' or '4'.") },
      annotations: { title: "Get Book", ...READ_ONLY },
    },
    safe(async ({ title_or_number }: any) => {
      const books = await allBooks();
      const r = pick(books, title_or_number);
      if (!r.item) return didYouMean("book", title_or_number, r.suggestions, "get_book");
      const b = attrs(r.item);
      const ch = await getChapters(r.item.id);
      return text(
        `## 📖 ${b.title}\n${facts([["Author", b.author], ["Pages", b.pages], ["Released", b.release_date], ["Dedication", b.dedication]])}\n\n${truncate(String(b.summary ?? ""), 900)}\n\n**Chapters (${ch.length}):** ${ch.map((c) => `${attrs(c).order}. ${attrs(c).title}`).join(" · ")}\n\n${link("Wiki", b.wiki) ?? ""}\n_Source: ${SRC_PDB}_`,
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
    },
    safe(async () => {
      const m = await allMovies();
      return text(`## 🎬 Movies\n${table(["#", "Title", "Director", "Runtime", "Released"], m.map((x, i) => [i + 1, attrs(x).title, list(attrs(x).directors), attrs(x).running_time, attrs(x).release_date]))}\n\nUse \`get_movie\` with a title or number.\n\n_Source: ${SRC_PDB}_`);
    }),
  );

  server.registerTool(
    "get_movie",
    {
      title: "🍿 Get Movie",
      description: "Details of one film: crew, budget, box office and summary. Accepts a title, slug or number.",
      inputSchema: { title_or_number: q("e.g. 'Prisoner of Azkaban' or '3'.") },
      annotations: { title: "Get Movie", ...READ_ONLY },
    },
    safe(async ({ title_or_number }: any) => {
      const movies = await allMovies();
      const r = pick(movies, title_or_number);
      if (!r.item) return didYouMean("movie", title_or_number, r.suggestions, "get_movie");
      const m = attrs(r.item);
      return text(
        `## 🍿 ${m.title}\n${facts([
          ["Released", m.release_date], ["Runtime", m.running_time], ["Rating", m.rating], ["Directors", list(m.directors)],
          ["Screenwriters", list(m.screenwriters)], ["Producers", list(m.producers)], ["Music", list(m.music_composers)],
          ["Budget", m.budget], ["Box office", m.box_office], ["Distributors", list(m.distributors)],
        ])}\n\n${truncate(String(m.summary ?? "").trim(), 800)}\n\n${[link("Trailer", m.trailer), link("Wiki", m.wiki)].filter(Boolean).join(" · ")}\n_Source: ${SRC_PDB} (community data; dates and figures may contain errors)_`,
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
    },
    safe(async () => {
      const ping = async (name: string, url: string) => {
        const t0 = Date.now();
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
          return [name, r.ok ? "✅ up" : `❌ HTTP ${r.status}`, `${Date.now() - t0} ms`, url];
        } catch (e) {
          return [name, `❌ ${e instanceof Error ? e.message : "unreachable"}`, `${Date.now() - t0} ms`, url];
        }
      };
      const rows = await Promise.all([
        ping(SRC_PDB, `${PDB}/spells?page%5Bsize%5D=1`),
        ping(SRC_WW, `${WW}/Houses`),
      ]);
      return text(`## 🩺 Sources\n${table(["Source", "Status", "Latency", "Probe"], rows)}\n\nIf Wizard World is down, tools still work from PotterDB.`);
    }),
  );

  return server;
}
