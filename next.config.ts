import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Self-contained server output: copy .next/standalone to the server and run `node server.js`.
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "pdfkit", "exceljs"],
  // The PDF uses the brand fonts from node_modules; make sure they ship with the standalone build.
  outputFileTracingIncludes: { "/**/note.pdf": ["./node_modules/@fontsource/**/*.woff", "./assets/fonts/*", "./node_modules/pdfkit/js/data/**/*"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
