import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/bricolage-grotesque/800.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { tenantForRequest } from "@/lib/tenant";

const tenantHere = async () => {
  const c = await cookies();
  return tenantForRequest(await headers(), (name) => c.get(name)?.value);
};

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await tenantHere();
  return {
    title: tenant ? `ScopeFlow · ${tenant.branding.displayName}` : "ScopeFlow",
    robots: { index: false },
    icons: { icon: [{ url: "/brand/icon", type: "image/svg+xml" }] },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Unknown addresses still render (pages show a 404); they just get the base theme.
  const tenant = await tenantHere();
  const style = tenant ? ({ "--accent": tenant.branding.accentColour } as CSSProperties) : undefined;
  return (
    <html lang="en-GB" style={style}>
      <body>{children}</body>
    </html>
  );
}
