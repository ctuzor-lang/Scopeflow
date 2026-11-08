import type { NextRequest } from "next/server";
import { brandIconSvg } from "@/lib/brandIcon";
import { tenantForRequest } from "@/lib/tenant";

// public: the browser-tab icon for whichever workspace this address belongs to.
export async function GET(request: NextRequest) {
  const tenant = await tenantForRequest(request.headers, (name) => request.cookies.get(name)?.value);
  return new Response(brandIconSvg(tenant), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
