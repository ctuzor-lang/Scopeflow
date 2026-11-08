import { join } from "node:path";
import PDFDocument from "pdfkit";
import { crRef, formatMoney, getChangeRequest, listRevisions, type AssessmentPayload } from "./changes";
import { query } from "./db";
import { getDecision, type Decision } from "./decisions";
import { getProject, type Project } from "./projects";
import { contentTypeFor, storage } from "./storage";
import { tenantLogoKey, type Tenant } from "./tenant";

/** Everything a change control note shows, gathered for one decided change. */
export type ChangeNoteData = {
  tenant: Tenant;
  project: Project;
  ref: string;
  title: string;
  requestText: string;
  requestedBy: string | null;
  source: string;
  revNo: number;
  digest: string;
  assessment: AssessmentPayload;
  decision: Decision;
  history: { at: Date; text: string }[];
  logo: { data: Buffer; type: string } | null;
};

const BASIS: Record<string, string> = { fixed: "Fixed price", estimate: "Estimate", no_charge: "No charge" };

export async function changeNoteData(tenant: Tenant, projectId: string, number: number): Promise<ChangeNoteData | null> {
  const project = await getProject(tenant.id, projectId);
  const cr = project ? await getChangeRequest(tenant.id, projectId, number) : null;
  if (!project || !cr) return null;
  const decision = await getDecision(cr.id);
  if (!decision) return null;
  const revision = (await listRevisions(cr.id)).find((r) => r.revNo === decision.revNo);
  if (!revision) return null;

  const events = await query<{ action: string; detail: Record<string, unknown>; created_at: Date; who: string | null }>(
    `select e.action, e.detail, e.created_at, coalesce(u.display_name, u.email) as who
     from audit_event e left join app_user u on u.id = e.actor_user_id
     where e.tenant_id = $1 and (
       (e.target = $2 and e.action in ('change.raised', 'change.assessment_published', 'change.approved', 'change.declined', 'change.commented', 'change.withdrawn'))
       or (e.action = 'baseline.published' and e.target = $3 and e.detail->'includesChanges' @> to_jsonb($4::int))
     )
     order by e.id`,
    [tenant.id, `change:${cr.id}`, `project:${projectId}`, number],
  );
  const history = events.map((e) => {
    const who = e.who ?? "ScopeFlow";
    const text =
      e.action === "change.raised"
        ? `Change request logged by ${who}`
        : e.action === "change.assessment_published"
          ? `Assessment R${e.detail.revNo} sent to the client by ${who}`
          : e.action === "change.approved"
            ? `Approved by ${who} (R${e.detail.revNo})`
            : e.action === "change.declined"
              ? `Declined by ${who} (R${e.detail.revNo})`
              : e.action === "change.withdrawn"
                ? `Withdrawn by ${who}`
                : e.action === "baseline.published"
                  ? `Put into effect in agreed version ${e.detail.version}`
                  : e.detail.side === "client"
                    ? `Question from ${who}`
                    : `Reply from ${who}`;
    return { at: new Date(e.created_at), text };
  });

  let logo: ChangeNoteData["logo"] = null;
  const key = await tenantLogoKey(tenant.id);
  if (key && !key.endsWith(".webp")) {
    const data = await storage().get(key);
    if (data) logo = { data, type: contentTypeFor(key) };
  }

  return {
    tenant,
    project,
    ref: cr.ref,
    title: cr.title,
    requestText: cr.requestText,
    requestedBy: cr.requestedBy,
    source: cr.source,
    revNo: revision.revNo,
    digest: revision.digest,
    assessment: revision.payload,
    decision,
    history,
    logo,
  };
}

const FONT_DIR = join(process.cwd(), "node_modules", "@fontsource");
const FONTS = {
  body: join(FONT_DIR, "hanken-grotesk/files/hanken-grotesk-latin-400-normal.woff"),
  bodyBold: join(FONT_DIR, "hanken-grotesk/files/hanken-grotesk-latin-600-normal.woff"),
  display: join(FONT_DIR, "bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff"),
  heading: join(FONT_DIR, "bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff"),
  // The web-font file for Plex Mono doesn't load in pdfkit; a TTF converted from it is kept in assets/fonts (OFL).
  mono: join(process.cwd(), "assets", "fonts", "IBMPlexMono-Regular-latin.ttf"),
};

const INK = "#0e1a2b";
const MUTED = "#4f5d73";
const LINE = "#c8d1de";

const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(d);
const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(d);

/** Renders the note as an A4 PDF. */
export function renderChangeNote(d: ChangeNoteData, issuedAt = new Date()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 56, bottom: 72, left: 56, right: 56 },
      bufferPages: true,
      info: { Title: `${d.ref} change control note`, Author: d.tenant.branding.displayName, Creator: "ScopeFlow" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("body", FONTS.body);
    doc.registerFont("bold", FONTS.bodyBold);
    doc.registerFont("display", FONTS.display);
    doc.registerFont("heading", FONTS.heading);
    doc.registerFont("mono", FONTS.mono);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const accent = d.tenant.branding.accentColour;
    const a = d.assessment;

    // Header: brand on the left, note reference on the right.
    const top = doc.y;
    if (d.logo) {
      try {
        doc.image(d.logo.data, left, top, { fit: [160, 32] });
      } catch {
        d.logo = null;
      }
    }
    if (!d.logo) {
      doc.roundedRect(left, top, 28, 28, 5).fill(accent);
      doc.fillColor("#ffffff").font("display").fontSize(15).text(d.tenant.branding.displayName.charAt(0).toUpperCase(), left, top + 6, { width: 28, align: "center" });
      doc.fillColor(INK).font("display").fontSize(16).text(d.tenant.branding.displayName, left + 38, top + 5);
    }
    doc.fillColor(MUTED).font("mono").fontSize(8).text(`CCN-${d.ref.slice(3)} · ISSUED ${fmtDate(issuedAt).toUpperCase()}`, left, top + 4, { width, align: "right" });
    doc.y = top + 44;
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(2).strokeColor(INK).stroke();
    doc.moveDown(1.2);

    const eyebrow = (t: string) => {
      doc.fillColor(MUTED).font("mono").fontSize(8).text(t.toUpperCase(), left, doc.y, { characterSpacing: 1 });
      doc.moveDown(0.4);
    };
    const heading = (t: string) => {
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc.moveDown(0.8);
      doc.fillColor(INK).font("heading").fontSize(13).text(t, left, doc.y);
      doc.moveDown(0.4);
    };
    const para = (t: string, opts: { muted?: boolean } = {}) => {
      doc.fillColor(opts.muted ? MUTED : INK).font("body").fontSize(10).text(t, left, doc.y, { width, lineGap: 2 });
    };

    eyebrow("Change control note");
    doc.fillColor(INK).font("display").fontSize(22).text(d.title, left, doc.y, { width });
    doc.moveDown(0.8);

    // Key facts table.
    const facts: [string, string][] = [
      ["Client", d.project.clientName],
      ["Project", d.project.name],
      ["Contract reference", d.project.reference ?? "Not recorded"],
      ["Change request", `${d.ref}, assessment R${d.revNo}`],
      ["Agreed version changed", `Version ${a.sourceVersion} (${a.sourceDigest.slice(7, 19)})`],
      ["Outcome", d.decision.outcome === "approved" ? "Approved" : "Declined"],
    ];
    for (const [k, v] of facts) {
      const y = doc.y;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.fillColor(MUTED).font("mono").fontSize(8).text(k.toUpperCase(), left, y + 7, { width: 150 });
      doc.fillColor(INK).font("body").fontSize(10).text(v, left + 160, y + 6, { width: width - 160 });
      doc.y = Math.max(doc.y, y + 22) + 2;
    }
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();

    heading("What was requested");
    para(d.requestText);
    para(`${d.requestedBy ?? "Requester not recorded"} · by ${d.source}`, { muted: true });

    heading("What changes");
    para(a.scopeChange);
    if (a.affectedItems.length) {
      doc.moveDown(0.4);
      eyebrow(`Agreed items affected (version ${a.sourceVersion})`);
      for (const i of a.affectedItems) {
        doc.fillColor(INK).font("mono").fontSize(9).text(i.key, left, doc.y, { continued: true, width });
        doc.font("body").fontSize(10).text(`  ${i.title}`);
      }
    }

    heading("Commercial and schedule impact");
    const figures: [string, string][] = [
      [BASIS[a.price.basis], a.price.basis === "no_charge" ? "No charge" : `${formatMoney(a.price.amountMinor, a.price.currency)} excl. VAT`],
      ["Effort", `${a.effort.minDays}–${a.effort.maxDays} days`],
      ["Schedule", a.scheduleDays === 0 ? "No change" : `${a.scheduleDays > 0 ? "+" : ""}${a.scheduleDays} working days`],
    ];
    const colW = width / 3;
    const fy = doc.y;
    figures.forEach(([k, v], idx) => {
      const x = left + idx * colW;
      doc.rect(x, fy, colW, 52).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.fillColor(MUTED).font("mono").fontSize(8).text(k.toUpperCase(), x + 10, fy + 9, { width: colW - 20 });
      doc.fillColor(INK).font("display").fontSize(15).text(v, x + 10, fy + 24, { width: colW - 20 });
    });
    doc.y = fy + 62;
    if (a.assumptions) {
      eyebrow("Assumptions");
      para(a.assumptions);
      doc.moveDown(0.4);
    }
    if (a.risks) {
      eyebrow("Risks");
      para(a.risks);
    }

    heading("Decision record");
    const dd = d.decision;
    para(`${dd.outcome === "approved" ? "Approved" : "Declined"} by ${dd.decidedByName ?? dd.decidedBy} (${dd.decidedBy}) on ${fmtDateTime(dd.decidedAt)}.`);
    if (dd.authorityStatement) {
      doc.moveDown(0.5);
      const qy = doc.y;
      doc.fillColor(INK).font("bold").fontSize(10).text(`“${dd.authorityStatement}”`, left + 14, qy, { width: width - 14, lineGap: 2 });
      doc.moveTo(left + 2, qy).lineTo(left + 2, doc.y).lineWidth(2).strokeColor(accent).stroke();
    }
    if (dd.comment) {
      doc.moveDown(0.5);
      para(`Comment: ${dd.comment}`);
    }
    doc.moveDown(0.5);
    para(`Applies to assessment R${dd.revNo}, fingerprint ${dd.revisionDigest.slice(7)}`, { muted: true });

    heading("History");
    for (const h of d.history) {
      const y = doc.y;
      doc.fillColor(MUTED).font("mono").fontSize(8).text(fmtDateTime(h.at), left, y + 1, { width: 130 });
      doc.fillColor(INK).font("body").fontSize(10).text(h.text, left + 140, y, { width: width - 140 });
      doc.moveDown(0.2);
    }

    // Footer on every page.
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      // Writing inside the bottom margin would otherwise start a new page.
      doc.page.margins.bottom = 0;
      const fyy = doc.page.height - 50;
      doc.moveTo(left, fyy - 8).lineTo(left + width, fyy - 8).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.fillColor(MUTED).font("body").fontSize(7.5).text(
        (d.decision.outcome === "approved"
          ? `This note records ${d.ref} as approved. It varies the agreed scope only as described above; all other terms are unchanged. `
          : `This note records that ${d.ref} was declined. The agreed scope is unchanged. `) +
          `Generated by ScopeFlow for ${d.tenant.branding.displayName} on ${fmtDateTime(issuedAt)}.`,
        left,
        fyy,
        { width: width - 60, lineGap: 1 },
      );
      doc.text(`Page ${i + 1} of ${pages.count}`, left + width - 60, fyy, { width: 60, align: "right" });
    }
    doc.end();
  });
}

export const noteFileName = (d: ChangeNoteData) => `${d.ref}-change-control-note.pdf`;
export { crRef };
