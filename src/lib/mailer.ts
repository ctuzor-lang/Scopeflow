import nodemailer from "nodemailer";
import { config } from "./config";

export type Mail = { to: string; subject: string; text: string; fromName?: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Development: prints the email to the server log instead of sending it. */
class ConsoleMailer implements Mailer {
  async send(mail: Mail) {
    console.log(`\n--- email to ${mail.to} ---\nSubject: ${mail.subject}\n\n${mail.text}\n--- end email ---\n`);
  }
}

class SmtpMailer implements Mailer {
  private transport = nodemailer.createTransport({
    host: config().SMTP_HOST,
    port: config().SMTP_PORT ?? 587,
    secure: (config().SMTP_PORT ?? 587) === 465,
    auth: config().SMTP_USER ? { user: config().SMTP_USER, pass: config().SMTP_PASS } : undefined,
  });

  async send(mail: Mail) {
    const fromAddress = config().MAIL_FROM.match(/<([^>]+)>/)?.[1] ?? config().MAIL_FROM;
    // Sent in the tenant's name from the platform's verified address (FR-031 adds per-tenant domains).
    const from = mail.fromName ? `"${mail.fromName.replace(/"/g, "")}" <${fromAddress}>` : config().MAIL_FROM;
    await this.transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
  }
}

let override: Mailer | undefined;

/** Tests swap in a capturing mailer. */
export function setMailerForTests(m: Mailer | undefined) {
  override = m;
}

export function mailer(): Mailer {
  if (override) return override;
  return config().MAIL_TRANSPORT === "smtp" ? new SmtpMailer() : new ConsoleMailer();
}
