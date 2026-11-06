import { sha256 } from "./crypto";
import type { Db } from "./db";

export type AuditInput = {
  tenantId: string;
  actorUserId?: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
};

type Row = {
  id: string;
  tenant_id: string;
  actor_user_id: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  created_at: Date;
  prev_digest: string | null;
  event_digest: string;
};

/** Stable JSON: keys sorted at every level, so the digest doesn't depend on key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

function digestOf(e: {
  prevDigest: string | null;
  tenantId: string;
  actorUserId: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
}): string {
  return sha256(
    [
      e.prevDigest ?? "",
      e.tenantId,
      e.actorUserId ?? "",
      e.action,
      e.target ?? "",
      canonicalJson(e.detail),
      e.createdAt.toISOString(),
    ].join("|"),
  );
}

/**
 * Appends an audit event, chained to the tenant's previous event.
 * Must be called inside a transaction (pass the transaction client) so the
 * per-tenant lock serialises writers and the chain never forks.
 */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [`audit:${input.tenantId}`]);
  const prev = await db.query<{ event_digest: string }>(
    "select event_digest from audit_event where tenant_id = $1 order by id desc limit 1",
    [input.tenantId],
  );
  const prevDigest = prev.rows[0]?.event_digest ?? null;
  // Millisecond precision so the stored timestamp round-trips exactly.
  const createdAt = new Date(Math.floor(Date.now()));
  const detail = input.detail ?? {};
  const eventDigest = digestOf({
    prevDigest,
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    target: input.target ?? null,
    detail,
    createdAt,
  });
  await db.query(
    `insert into audit_event (tenant_id, actor_user_id, action, target, detail, ip, created_at, prev_digest, event_digest)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.tenantId,
      input.actorUserId ?? null,
      input.action,
      input.target ?? null,
      JSON.stringify(detail),
      input.ip ?? null,
      createdAt,
      prevDigest,
      eventDigest,
    ],
  );
}

/** Recomputes the tenant's chain. Returns the id of the first broken event, or null if intact. */
export async function verifyAuditChain(db: Db, tenantId: string): Promise<string | null> {
  const rows = (
    await db.query<Row>("select * from audit_event where tenant_id = $1 order by id asc", [tenantId])
  ).rows;
  let prev: string | null = null;
  for (const r of rows) {
    const expected = digestOf({
      prevDigest: prev,
      tenantId: r.tenant_id,
      actorUserId: r.actor_user_id,
      action: r.action,
      target: r.target,
      detail: r.detail,
      createdAt: new Date(r.created_at),
    });
    if (r.prev_digest !== prev || r.event_digest !== expected) return r.id;
    prev = r.event_digest;
  }
  return null;
}
