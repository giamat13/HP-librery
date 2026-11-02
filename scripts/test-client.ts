// Calls EVERY tool through a real MCP client. Usage: npm test [-- <url>]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? "http://localhost:3000/mcp";
const client = new Client({ name: "hogwarts-test", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

const calls: [string, Record<string, unknown>][] = [
  ["sources_status", {}],
  ["search_characters", { query: "weasley", house: "Gryffindor", limit: 3 }],
  ["search_characters", { query: "hermione grnger" }],
  ["get_character", { name_or_slug: "Severus Snape" }],
  ["character_family", { name_or_slug: "Harry Potter" }],
  ["family_tree", { name_or_slug: "Harry Potter" }],
  ["list_creatures", { limit: 8 }],
  ["list_creatures", { query: "dragon" }],
  ["get_character", { name_or_slug: "dumbledor" }],
  ["house_roster", { house: "slytherin", limit: 5 }],
  ["search_spells", { query: "lumos", limit: 3 }],
  ["search_spells", { category: "Curse", effect_contains: "pain", limit: 3 }],
  ["get_spell", { name_or_slug: "Expelliarmus" }],
  ["random_spell", { category: "Charm" }],
  ["random_character", { house: "Ravenclaw" }],
  ["search_potions", { query: "felix" }],
  ["get_potion", { name_or_slug: "Polyjuice Potion" }],
  ["list_books", {}],
  ["get_book", { title_or_number: "goblet of fire" }],
  ["search_chapters", { query: "dragon", limit: 3 }],
  ["list_movies", {}],
  ["get_movie", { title_or_number: "3" }],
  ["compare_characters", { a: "Harry Potter", b: "Draco Malfoy" }],
  ["get_character", { name_or_slug: "xqzvbn" }],
];

const tools = await client.listTools();
console.log(`Connected to ${url}. ${tools.tools.length} tools: ${tools.tools.map((t) => t.name).join(", ")}`);
const untested = tools.tools.filter((t) => !calls.some(([n]) => n === t.name)).map((t) => t.name);
let bad = 0;
for (const [name, args] of calls) {
  const t0 = Date.now();
  const r: any = await client.callTool({ name, arguments: args });
  const txt: string = r.content?.map((c: any) => c.text).join("\n") ?? "";
  const empty = txt.trim().length < 20;
  if (r.isError || empty) bad++;
  console.log(`\n=== ${name} ${JSON.stringify(args)} — ${Date.now() - t0}ms ${r.isError ? "ERROR" : empty ? "EMPTY" : "ok"} ===`);
  console.log(process.env.FULL ? txt : txt.split("\n").slice(0, 14).join("\n"));
}
console.log(`\nUntested tools: ${untested.join(", ") || "none"}. Problems: ${bad}`);
await client.close();
process.exit(bad || untested.length ? 1 : 0);
