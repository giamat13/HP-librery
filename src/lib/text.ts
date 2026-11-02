// Text helpers: normalisation, fuzzy matching, Markdown formatting.

export function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugify(s: string): string {
  return norm(s).replace(/ /g, "-");
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 similarity between a query and a candidate name. */
export function similarity(query: string, candidate: string): number {
  const q = norm(query);
  const c = norm(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  let best = 1 - lev(q, c) / Math.max(q.length, c.length);
  if (c.includes(q) || q.includes(c)) best = Math.max(best, 0.85);
  const cw = c.split(" ");
  for (const w of q.split(" ")) {
    for (const x of cw) best = Math.max(best, (1 - lev(w, x) / Math.max(w.length, x.length)) * 0.8);
  }
  return best;
}

export function bestMatches<T>(query: string, items: T[], nameOf: (t: T) => string, n = 5): { item: T; score: number }[] {
  return items
    .map((item) => ({ item, score: similarity(query, nameOf(item)) }))
    .filter((x) => x.score > 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export function clean(v: unknown): unknown {
  if (v == null) return undefined;
  if (typeof v === "string") {
    const t = v.replace(/\s+/g, " ").trim();
    return t === "" ? undefined : t;
  }
  if (Array.isArray(v)) {
    const a = v.map(clean).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  return v;
}

export function truncate(s: string, n = 400): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export function list(v: unknown, max = 6): string | undefined {
  const c = clean(v);
  if (c === undefined) return undefined;
  const a = Array.isArray(c) ? (c as unknown[]).map(String) : [String(c)];
  const shown = a.slice(0, max).join(", ");
  return a.length > max ? `${shown} … (+${a.length - max} more)` : shown;
}

/** Bullet lines "- **Label:** value" skipping empty values. */
export function facts(rows: [string, unknown][]): string {
  return rows
    .map(([k, v]) => {
      const c = typeof v === "string" ? clean(v) : Array.isArray(v) ? list(v) : clean(v);
      return c === undefined ? "" : `- **${k}:** ${c}`;
    })
    .filter(Boolean)
    .join("\n");
}

export function table(headers: string[], rows: unknown[][]): string {
  const esc = (x: unknown) => String(clean(x) ?? "—").replace(/\|/g, "\\|");
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}

export function pageFooter(total: number, shown: number, page: number, perPage: number, tool: string): string {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const next = page < pages ? ` For more, call \`${tool}\` again with \`page: ${page + 1}\`.` : "";
  return `\n---\n_Showing ${shown} of ${total} result${total === 1 ? "" : "s"} (page ${page}/${pages}).${next}_`;
}

export const SRC_PDB = "PotterDB";
export const SRC_WW = "Wizard World";
