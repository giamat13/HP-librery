# Contributing

Thanks for helping! Quick start:

```bash
npm install
npm run dev          # http://localhost:3000/mcp
npm run typecheck
npm test             # calls every tool through a real MCP client (live APIs)
npm test -- https://your-deployment.vercel.app/mcp   # test a deployed URL
```

Guidelines
- Keep tools few and genuinely working; every tool needs a short description, a Zod schema with limits, and read-only annotations.
- Every result must name its data source (PotterDB / Wizard World) and never crash on missing fields.
- Don't add secrets or auth. Be kind to the upstream APIs (cache, no bulk crawling).
- Open an issue before large changes.
