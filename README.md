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
| `search_spells` | Search spells by name, category, incantation, words in the effect |
| `get_spell` | One spell merged from both sources, showing which source gave each field (also finds spells by incantation, e.g. "Expelliarmus") |
| `random_spell` | Random spell, optionally by category |
| `search_potions` / `get_potion` | PotterDB potions + Wizard World elixirs with ingredients and difficulty |
| `list_books` / `get_book` | Books in order; details, summary and chapter list |
| `search_chapters` | Find chapters by words in title/summary |
| `list_movies` / `get_movie` | Films in order; crew, budget, box office |
| `sources_status` | Checks both APIs are reachable (with latency) |

All tools are read-only (`readOnlyHint`, `idempotentHint`, `openWorldHint`), return compact Markdown, drop empty fields, say how many results exist and how to get the next page, and name their source.

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
