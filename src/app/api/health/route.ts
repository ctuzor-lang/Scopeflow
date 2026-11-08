import { query } from "@/lib/db";

/** For the deploy script and uptime checks: is the app up and can it reach its database? */
export async function GET() {
  try {
    await query("select 1");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
