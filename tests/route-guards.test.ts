import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Next renders a page alongside its layout and can skip the layout entirely for some requests,
// so every page must check who is signed in itself (security review F1).
const PUBLIC_PAGES = new Set(["src/app/login/page.tsx", "src/app/login/code/page.tsx"]);
const REDIRECT_ONLY = new Set(["src/app/projects/[projectId]/page.tsx"]);
const GUARD = /\b(requireUser|requireClient|agencyUser|currentUser)\(/;
const ROUTE_GUARD = /\buserForSession\(|^\s*\/\/ public:/m;
const PUBLIC_ROUTES = new Set(["src/app/api/health/route.ts", "src/app/brand/logo/route.ts", "src/app/projects/template.csv/route.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("every page and route checks access itself", () => {
  const files = walk("src/app");
  it.each(files.filter((f) => f.endsWith("page.tsx") && !PUBLIC_PAGES.has(f) && !REDIRECT_ONLY.has(f)))("%s", (f) => {
    expect(readFileSync(f, "utf8")).toMatch(GUARD);
  });
  it.each(files.filter((f) => f.endsWith("route.ts") && !PUBLIC_ROUTES.has(f)))("%s", (f) => {
    expect(readFileSync(f, "utf8")).toMatch(ROUTE_GUARD);
  });
  it("redirect-only pages render nothing", () => {
    for (const f of REDIRECT_ONLY) expect(readFileSync(f, "utf8")).not.toMatch(/query|list|get[A-Z]/);
  });
});
