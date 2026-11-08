// public: browsers ask for /favicon.ico by habit; send them to the workspace's own icon.
export function GET() {
  return new Response(null, { status: 308, headers: { Location: "/brand/icon", "Cache-Control": "public, max-age=86400" } });
}
