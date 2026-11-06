import { z } from "zod";
import { recordAudit } from "./audit";
import { randomToken } from "./crypto";
import { tx } from "./db";
import { MAX_LOGO_BYTES, detectImageType, storage } from "./storage";

/** Validates and stores a tenant logo, then points the branding at it. */
export async function saveLogo(params: {
  tenantId: string;
  actorUserId: string;
  data: Buffer;
  ip?: string | null;
}): Promise<SaveResult> {
  if (params.data.length === 0) return { ok: false, error: "Choose a logo file to upload" };
  if (params.data.length > MAX_LOGO_BYTES) return { ok: false, error: "Logos must be 512 KB or smaller" };
  const type = detectImageType(params.data);
  if (!type) return { ok: false, error: "Upload a PNG, JPEG or WebP image" };
  const key = `tenants/${params.tenantId}/logo-${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "")}.${type}`;
  await storage().put(key, params.data);
  await tx(async (db) => {
    await db.query("update tenant_branding set logo_key = $2, updated_at = now() where tenant_id = $1", [
      params.tenantId,
      key,
    ]);
    await recordAudit(db, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: "branding.logo_updated",
      target: `tenant:${params.tenantId}`,
      detail: { key, bytes: params.data.length, type },
      ip: params.ip,
    });
  });
  return { ok: true };
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Buttons put white text on the accent colour, so it needs 4.5:1 against white (WCAG AA). */
export const MIN_ACCENT_CONTRAST = 4.5;

export const brandingInput = z.object({
  displayName: z.string().trim().min(1, "Enter a display name").max(80, "Keep the display name under 80 characters"),
  accentColour: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^#[0-9a-f]{6}$/, "Use a colour in the form #1b68ea")
    .refine((hex) => contrastRatio(hex, "#ffffff") >= MIN_ACCENT_CONTRAST, {
      message: "That colour is too light for white button text. Choose a darker shade.",
    }),
  poweredByVisible: z.boolean(),
});

export type BrandingInput = z.infer<typeof brandingInput>;

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Saves branding for a tenant. The caller must already have checked the user is
 * an admin of this tenant. Plans other than white_label always show the credit.
 */
export async function saveBranding(params: {
  tenantId: string;
  plan: string;
  actorUserId: string;
  input: unknown;
  ip?: string | null;
}): Promise<SaveResult> {
  const parsed = brandingInput.safeParse(params.input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const value = { ...parsed.data, poweredByVisible: params.plan === "white_label" ? parsed.data.poweredByVisible : true };
  await tx(async (db) => {
    const before = await db.query(
      "select display_name, accent_colour, powered_by_visible from tenant_branding where tenant_id = $1 for update",
      [params.tenantId],
    );
    await db.query(
      `update tenant_branding set display_name = $2, accent_colour = $3, powered_by_visible = $4, updated_at = now()
       where tenant_id = $1`,
      [params.tenantId, value.displayName, value.accentColour, value.poweredByVisible],
    );
    await recordAudit(db, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: "branding.updated",
      target: `tenant:${params.tenantId}`,
      detail: { before: before.rows[0] ?? null, after: value },
      ip: params.ip,
    });
  });
  return { ok: true };
}
