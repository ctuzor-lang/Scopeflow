import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config";

const globalForPool = globalThis as unknown as { __sfPool?: Pool };

export function pool(): Pool {
  if (!globalForPool.__sfPool) {
    globalForPool.__sfPool = new Pool({ connectionString: config().DATABASE_URL, max: 10 });
  }
  return globalForPool.__sfPool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(text, params);
  return res.rows;
}

export async function one<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run work in a single transaction; rolls back on any error. */
export async function tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export type Db = Pick<PoolClient, "query">;
