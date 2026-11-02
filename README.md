# ⚡ Hogwarts MCP

A remote [MCP](https://modelcontextprotocol.io) server that gives Claude real tools for Harry Potter data.
Runs 100% in the cloud (Vercel Hobby, free) — nothing to install. Works as a **custom connector in claude.ai**
(Streamable HTTP, stateless, no auth) and in Claude Code.

Data comes from [PotterDB](https://docs.potterdb.com) (primary) and the
[Wizard World API](https://wizard-world-api.herokuapp.com/swagger/index.html) (secondary, optional — if it is down, every tool still works from PotterDB and says so).

> **Disclaimer:** the data is community-maintained, may be incomplete or inaccurate, and this project is not affiliated with J.K. Rowling or Warner Bros.

## Tools

| Tool | What it does |
|---|---|
| `search_characters` | Search ~5,400 characters by name, house, species, blood status (paginated) |
| `get_character` | Full profile, fuzzy name match + "did you mean", enriched with Wizard World elixirs |
| `house_roster` | House info (founder, colours, ghost, traits) + paginated member list |
| `random_character` | Random character, optionally from one house |
| `compare_characters` | Side-by-side table of two characters |
| `character_family` | Family of one character grouped by relation (parents, partner, children, in-laws…) |
| `family_tree` | Full graphical family tree (SVG card): ancestors on top, descendants below, partners linked, close relatives' own families merged in |
| `list_creatures` | General list of creatures / non-human species with character counts (paginated, searchable); click a species to see its members |
| `search_all` | One search across characters, spells, potions, books, chapters and movies, grouped by type |
| `today_in_wizarding_world` | Characters born/died on a day, books/films released on it, story events and cast birthdays (default today) |
| `hp_news` | Live Harry Potter headlines from Google News (HBO series, casting, new projects) |
| `cast_birthdays` | Film/series cast born on a given day, from Wikidata |
| `next_releases` | Upcoming Harry Potter releases with days remaining, from Wikidata |
| `book_editions` | Editions, ratings and translations of the books, from Open Library |
| `galleon_converter` | Real prices (ILS/USD/GBP/EUR) to Galleons, Sickles and Knuts at a live rate (the Galleon's value is a fan convention, overridable) |
| `search_spells` | Search spells by name, category, incantation, words in the effect |
| `get_spell` | One spell merged from both sources, showing which source gave each field (also finds spells by incantation, e.g. "Expelliarmus") |
| `random_spell` | Random spell, optionally by category |
| `search_potions` / `get_potion` | PotterDB potions + Wizard World elixirs with ingredients and difficulty |
| `list_books` / `get_book` | Books in order; details, summary and chapter list |
| `search_chapters` | Find chapters by words in title/summary |
| `list_movies` / `get_movie` | Films in order; crew, budget, box office |
| `sources_status` | Checks both APIs are reachable (with latency) |

All tools are read-only (`readOnlyHint`, `idempotentHint`, `openWorldHint`), return compact Markdown, drop empty fields, say how many results exist and how to get the next page, and name their source.

## Visual card (MCP Apps)

Every tool except `search_chapters` also returns structured data and points to a `ui://hogwarts/card.html` resource. Hosts that support [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) render it inline as a small themed card: house colours, spell-light colour, ingredient chips, side-by-side compare, book and movie covers, a family tree and source status lights. Hosts without support just show the Markdown text, so nothing is lost.

The card is interactive: Prev/Next buttons page through lists, clicking a list row or a family member opens that profile (with a Back button), and 🎲 Another redraws a random character or spell. These clicks call the tools again through the host.

The view is a single self-contained HTML file in `src/view.ts` that speaks the MCP Apps postMessage protocol directly.

> **Already connected before the cards existed?** claude.ai caches the tool list. Remove the connector and add it again, then start a new chat, or the cards will not show.

## Example prompts

- "Compare Harry Potter and Draco Malfoy."
- "Which spell is Expelliarmus? Show details."
- "Give me a random Ravenclaw and tell me about them."
- "List all Curses that cause pain."
- "What goes into Polyjuice Potion and how hard is it?"
- "Which chapters mention dragons?"

## Use it

**claude.ai:** `+` → **Add custom connector** → paste `https://hogwarts-mcp.vercel.app/mcp` → Add.
**Claude Code:** `claude mcp add --transport http hogwarts https://hogwarts-mcp.vercel.app/mcp`

## Develop

```bash
npm install
npm run dev        # http://localhost:3000/mcp
npm run typecheck
npm test           # calls every tool through a real MCP client against the live APIs
npm test -- https://hogwarts-mcp.vercel.app/mcp
```

## Deploy (Vercel Hobby)

```bash
npx vercel login
npx vercel --prod
```

`vercel.json` rewrites `/mcp` to the function in `api/mcp.ts`. No environment variables or secrets are needed.
The same code can run on any Fetch-API runtime (e.g. Cloudflare Workers) via `src/handler.ts`.

## Design notes

- **Stateless**: a fresh server + transport per request (`sessionIdGenerator: undefined`, JSON responses).
- **Rate limits**: PotterDB allows 900 requests/hour/IP. In-memory 1 h TTL cache, in-flight request de-duplication, short failure cache, friendly message on HTTP 429.
- **Robust**: 8 s timeouts, clear errors, never crashes on missing fields.
- **Abuse protection**: Zod schemas with max lengths and page sizes, 64 KB body limit.
- Caching is per serverless instance, so it is best-effort.

## License

[MIT](LICENSE) © GIAMAT13
