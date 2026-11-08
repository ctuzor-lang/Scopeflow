import type { Metadata } from "next";
import { headers } from "next/headers";
import { TourJourney, type TourStep } from "@/components/TourJourney";
import { CHAYSE_MARK_PATH } from "@/lib/brandIcon";
import { config } from "@/lib/config";
import { isDemoHost, requestHost } from "@/lib/tenant";
import { startDemoAction } from "../demo/actions";

export const metadata: Metadata = {
  title: "ScopeFlow by Chayse · How it works",
  description: "Agree scope changes with your clients in minutes, with a record both sides trust.",
  robots: { index: true },
};

const AGENCY: TourStep[] = [
  { title: "Set up the agreed scope", text: "Import the scope you agreed from a spreadsheet, check it, and publish it as version 1.", image: "/tour/agency-1.jpg", alt: "Scope draft with items grouped by section and a publish panel" },
  { title: "Log every change as it arrives", text: "Record each request in the client's words, the moment it comes in. Nothing gets lost in email.", image: "/tour/agency-2.jpg", alt: "List of change requests with their status and next step" },
  { title: "Assess the impact", text: "Pick the agreed items it affects, then set effort, price and schedule. AI can suggest a first draft.", image: "/tour/agency-3.jpg", alt: "Impact assessment form for a change request" },
  { title: "Send it for a decision", text: "The client gets an email to sign in. Figures stay inside the portal, never in the email.", image: "/tour/agency-4.jpg", alt: "Change request waiting for the client's decision" },
  { title: "Put it into the agreed scope", text: "Update the draft and publish version 2. It records which approved changes it includes.", image: "/tour/agency-5.jpg", alt: "Agreed versions with what changed between them" },
];

const CLIENT: TourStep[] = [
  { title: "One email, no password", text: "Clients sign in with a one-time code sent to their work email, to a portal in your branding.", image: "/tour/client-1.jpg", alt: "Branded sign-in page asking for a work email" },
  { title: "See everything waiting for them", text: "Decisions waiting come first, with a plain explanation of how it works.", image: "/tour/client-2.jpg", alt: "Client portal listing changes waiting for a decision" },
  { title: "Understand exactly what changes", text: "Cost, effort and timeline up front, plus which agreed items are affected.", image: "/tour/client-3.jpg", alt: "Client view of a change with price, effort and schedule" },
  { title: "Approve with one tick", text: "The approval names the exact revision and its fingerprint, so nobody approves something they didn't see.", image: "/tour/client-4.jpg", alt: "Approval box with the authority statement" },
  { title: "Both keep the same record", text: "A change control note (PDF) records who decided what, and when. It's the same for both sides.", image: "/tour/client-5.jpg", alt: "Decision record with a link to the change control note" },
];

export default async function TourPage({ searchParams }: { searchParams: Promise<{ busy?: string }> }) {
  const { busy } = await searchParams;
  const onDemoHost = isDemoHost(requestHost(await headers()));
  const demoHost = config().DEMO_HOSTNAME;

  const TryButton = ({ big }: { big?: boolean }) =>
    onDemoHost ? (
      <form action={startDemoAction}>
        <button type="submit" className={`btn accent${big ? " tour-big" : ""}`}>
          Try it yourself, no sign-up
        </button>
      </form>
    ) : demoHost ? (
      <a href={`https://${demoHost}/tour`} className={`btn accent${big ? " tour-big" : ""}`}>
        Try it yourself, no sign-up
      </a>
    ) : null;

  return (
    <div className="tour">
      <header className="topbar">
        <div className="wrap">
          <a href="https://chayse.com" className="brand" style={{ marginRight: "auto" }}>
            <svg className="brand-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
              <rect width="32" height="32" rx="6" fill="#1d70f8" />
              <path d={CHAYSE_MARK_PATH} fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
            </svg>
            <span className="brand-text">
              <span className="brand-name">ScopeFlow</span>
              <span className="brand-sub">by Chayse Consulting</span>
            </span>
          </a>
          <TryButton />
        </div>
      </header>

      <main id="main">
        <section className="wrap tour-hero">
          <div className="eyebrow">Scope and change control for consultancies</div>
          <h1>Agree scope changes in minutes, with a record both sides trust.</h1>
          <p className="tour-lede">
            ScopeFlow keeps the scope you agreed, every change your client asks for, what it costs, and who approved it, in one
            place. Your client decides in a branded portal. You both get the same signed record.
          </p>
          {busy ? (
            <p className="note" role="alert">The demo is busy right now. Please try again in a few minutes.</p>
          ) : null}
          <div className="tour-ctas">
            <TryButton big />
            <a href="#journey-agency" className="btn">
              See how it works
            </a>
          </div>
          <ul className="tour-points">
            <li><strong>No more scope creep by email.</strong> Every request is logged against a numbered agreed version.</li>
            <li><strong>Nothing approved by accident.</strong> Approvals bind to the exact revision the client saw.</li>
            <li><strong>Your brand, not ours.</strong> Clients see your name, colours and web address.</li>
          </ul>
        </section>

        <section className="tour-band" id="journey-agency">
          <div className="wrap">
            <div className="eyebrow">For your team</div>
            <h2>From agreed scope to approved change</h2>
            <TourJourney id="agency" label="The consultancy's journey" steps={AGENCY} />
          </div>
        </section>

        <section className="tour-band alt" id="journey-client">
          <div className="wrap">
            <div className="eyebrow">For your client</div>
            <h2>A clear decision, without the back-and-forth</h2>
            <TourJourney id="client" label="The client's journey" steps={CLIENT} />
          </div>
        </section>

        <section className="wrap tour-end">
          <h2>See it with a real project</h2>
          <p className="tour-lede">
            The demo gives you a private sample project with changes at every stage. Switch between your view and the
            client&apos;s with one click. It takes about five minutes, and nothing you do leaves your sandbox.
          </p>
          <div className="tour-ctas">
            <TryButton big />
            <a href="https://chayse.com/contact/" className="btn">
              Talk to Chayse
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <span>© Chayse Consulting</span>
          <span>ScopeFlow</span>
        </div>
      </footer>
    </div>
  );
}
