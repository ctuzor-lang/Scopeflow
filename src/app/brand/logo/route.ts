import { NextResponse, type NextRequest } from "next/server";
import { contentTypeFor, storage } from "@/lib/storage";
import { tenantForRequest, tenantLogoKey } from "@/lib/tenant";

/** Serves the logo of the tenant that owns this address, and no other. */
export async function GET(request: NextRequest) {
  const tenant = await tenantForRequest(request.headers, (name) => request.cookies.get(name)?.value);
  if (!tenant) return new NextResponse(null, { status: 404 });
  const key = await tenantLogoKey(tenant.id);
  if (!key) return new NextResponse(null, { status: 404 });
  const data = await storage().get(key);
  if (!data) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeFor(key),
      "Cache-Control": "private, max-age=300",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
