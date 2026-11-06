import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/bricolage-grotesque/800.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { headers } from "next/headers";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { requestHost, resolveTenant } from "@/lib/tenant";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenant(requestHost(await headers()));
  return { title: tenant ? `ScopeFlow · ${tenant.branding.displayName}` : "ScopeFlow", robots: { index: false } };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Unknown addresses still render (pages show a 404); they just get the base theme.
  const tenant = await resolveTenant(requestHost(await headers()));
  const style = tenant ? ({ "--accent": tenant.branding.accentColour } as CSSProperties) : undefined;
  return (
    <html lang="en-GB" style={style}>
      <body>{children}</body>
    </html>
  );
}
