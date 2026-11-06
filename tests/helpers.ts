import { setMailerForTests, type Mail } from "../src/lib/mailer";
import { createTenant } from "../src/lib/operator";
import { resolveTenant, type Tenant } from "../src/lib/tenant";

export const sentMail: Mail[] = [];
setMailerForTests({
  async send(mail) {
    sentMail.push(mail);
  },
});

let n = 0;
export async function makeTenant(opts: { plan?: "pilot" | "white_label"; hostname?: string; verified?: boolean } = {}) {
  n += 1;
  const slug = `t${n}-${Math.random().toString(36).slice(2, 8)}`;
  const hostname = opts.hostname ?? `${slug}.example.test`;
  const { tenantId, userId } = await createTenant({
    slug,
    name: `Tenant ${n}`,
    plan: opts.plan ?? "pilot",
    hostname,
    hostnameVerified: opts.verified ?? true,
    adminEmail: `admin@${slug}.example.test`,
  });
  const tenant = (await resolveTenant(hostname)) as Tenant;
  return { tenant, tenantId, userId, hostname, adminEmail: `admin@${slug}.example.test` };
}

export function lastCodeFor(email: string): string {
  const mail = [...sentMail].reverse().find((m) => m.to === email);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No code emailed to ${email}`);
  return code;
}
