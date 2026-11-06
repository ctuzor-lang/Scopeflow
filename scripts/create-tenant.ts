/**
 * Platform-operator command: create a tenant and its first admin.
 *
 *   npm run tenant:create -- --slug chayse --name "Chayse Consulting" \
 *     --admin-email you@chayse.com --hostname app.chayse.com --verified
 *
 * --verified marks the hostname as verified; use it only for domains you control.
 */
import { parseArgs } from "node:util";
import { createTenant } from "../src/lib/operator";
import { pool } from "../src/lib/db";

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    name: { type: "string" },
    plan: { type: "string", default: "pilot" },
    "admin-email": { type: "string" },
    "admin-name": { type: "string" },
    hostname: { type: "string" },
    verified: { type: "boolean", default: false },
    accent: { type: "string" },
  },
});

async function main() {
  if (!values.slug || !values.name || !values["admin-email"]) {
    throw new Error("Required: --slug, --name, --admin-email");
  }
  const plan = values.plan as "pilot" | "agency" | "white_label";
  if (!["pilot", "agency", "white_label"].includes(plan)) throw new Error("--plan must be pilot, agency or white_label");
  const result = await createTenant({
    slug: values.slug,
    name: values.name,
    plan,
    accentColour: values.accent,
    hostname: values.hostname,
    hostnameVerified: values.verified,
    adminEmail: values["admin-email"],
    adminName: values["admin-name"],
  });
  console.log(`Created tenant ${values.slug} (${result.tenantId}); admin user ${result.userId}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
