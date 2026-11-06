import { Client } from "pg";
import { afterAll, beforeAll } from "vitest";
import { migrate } from "../scripts/migrate";
import { pool } from "../src/lib/db";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost/scopeflow_test?host=/tmp";
process.env.SECRET_KEY = "test-secret-key-that-is-long-enough-0123456789";
process.env.MAIL_TRANSPORT = "console";
process.env.STORAGE_DIR = "./storage-test";
delete process.env.DEV_TENANT_SLUG;

beforeAll(async () => {
  // Fresh schema for each test file.
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("drop schema public cascade; create schema public;");
  await c.end();
  await migrate(process.env.DATABASE_URL!, () => {});
});

afterAll(async () => {
  await pool().end();
  (globalThis as { __sfPool?: unknown }).__sfPool = undefined;
});
