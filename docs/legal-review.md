# ScopeFlow legal review (draft, 8 Nov 2026)

Prepared by Claude as a brief for a solicitor (England and Wales). Not legal advice. It flags issues and proposes wording; a qualified solicitor should confirm each item before ScopeFlow is used with real clients or sold to other consultancies.

## 1. Are approvals in ScopeFlow binding?

**Probably yes, for business clients, provided the underlying contract allows it.**

- An electronic signature is valid if the signer intends to authenticate the document. The Law Commission (2019) confirmed that ticking an "I accept" box can be a signature (Electronic Communications Act 2000 s.7; Neocleous v Rees [2019]). ScopeFlow's evidence trail supports this: an emailed one-time code ties the approver to their address, and each decision records the exact revision and fingerprint, time, IP address and browser. The decision cannot be edited, and the audit log is hash-chained.
- **Biggest risk: the contract's own variation clause.** Many contracts say variations must be "in writing and signed by authorised representatives of both parties". The Supreme Court enforces such clauses (Rock Advertising v MWB [2018] UKSC 24). An electronic tick can usually satisfy "in writing" and "signed", but not if the clause demands a particular form (a director's signature, wet ink, or a deed). **Action:** put a clause in every client contract expressly accepting ScopeFlow approvals (draft in §5).
- **Authority.** The client company is bound only if the person approving had actual or apparent authority. Apparent authority comes from what the client represents, not from whom Chayse chose to invite. At present the agency invites approvers. **Action:** have the client nominate approvers in writing (the contract clause in §5 does this). Optionally, record "nominated by … on …" against each approver invitation (product change; not built yet).
- **Consumers.** These terms assume business clients. Consumer projects bring the Consumer Rights Act 2015 and Consumer Contracts Regulations (cancellation rights, unfair-terms tests). Don't use ScopeFlow with consumers without separate advice.

## 2. The approval statement

**Before:**
> I am authorised to approve this change on behalf of {client}. I approve {CR} assessment R{n} at a fixed price of £X excluding VAT, with a schedule impact of N working days. My approval applies to this revision only.

Gaps: it didn't name the project or say the approval is a variation of an existing agreement. It didn't tie the approval to the content fingerprint. For estimates, "at an estimated £X" left open whether the client was agreeing to pay £X or a different final amount.

**Now live in the code (pending solicitor sign-off):**
> I confirm I am authorised by {client} to approve changes to {project}. On behalf of {client}, I approve {CR} as set out in assessment R{n} (fingerprint {12 chars}), for a fixed price of £X excluding VAT | for an estimated £X excluding VAT, to be charged as set out in our agreement | at no additional charge, with a schedule impact of ±N working days | with no change to the schedule. This varies the agreed scope under the change control terms of our agreement with {agency}; all other terms are unchanged. My approval applies to this revision only.

Points for the solicitor:

1. **"Excluding VAT"** is hard-coded. That's right for a VAT-registered UK supplier. It's wrong for a non-registered consultancy, and possibly for overseas clients (reverse charge). It should become a per-workspace setting before white-label sale.
2. **Estimates.** Decide how estimates are charged: time and materials at contract rates, or capped at the estimate (or the estimate plus x%). Then state that in the contract. The statement points to "our agreement" for this.
3. **"Working days"** should be defined in the contract (Mon–Fri excluding England and Wales bank holidays).
4. **Assumptions and risks** are shown above the tick box and form part of "assessment R{n}". Confirm they should bind both parties, or whether assumptions failing should reopen the price. If the latter, the contract should say so.
5. **Declines** carry no statement. That's fine, as a decline changes nothing.

The change control note (PDF) quotes the statement word for word. Its footer previously said the note "varies the agreed scope" even for declined changes. That is now fixed: declined notes say the scope is unchanged.

## 3. Data protection (UK GDPR / DPA 2018)

| Item | Status | Action |
| --- | --- | --- |
| Roles | For its own projects, Chayse is the **controller**. For white-label customers, Chayse is their **processor**. | Article 28 data processing agreement in the white-label contract. |
| Personal data held | Names, work emails, IP addresses and browsers on decisions and sign-ins, and anything typed in requests, comments and scope items. | Keep to business contact data; tell users not to put sensitive data in requests. |
| Privacy notice | **Missing.** Users see no notice. | Publish a notice (draft outline in §6) and link it from the sign-in page and portal footer. |
| Lawful basis | Legitimate interests (running the project and keeping evidence of agreed changes) and contract. | Record a short legitimate interests assessment. |
| Retention | Decisions and the audit log are deliberately immutable, so erasure requests can't simply delete them. Art. 17(3)(e) (legal claims) supports keeping them. | Set a period: for example, 6 years after the project ends (Limitation Act 1980, contract claims). Add a tenant/project purge procedure for that point. |
| Sub-processors | one.com (hosting and mail, EU/Denmark: covered by UK adequacy for the EEA). Anthropic (AI suggestions, US). | List them in the privacy notice and DPA. For Anthropic, rely on its Data Processing Addendum and the transfer mechanism it offers (UK IDTA/Addendum, or UK Extension to the DPF if certified). Confirm which applies. |
| AI | Off by default per workspace. Sends only the request text and agreed items, with no prices. A person accepts each suggestion, so there is no solely automated decision (Art. 22 not engaged). | Disclose in the privacy notice and white-label DPA; keep it off for any client who objects. |
| Cookies | One strictly necessary sign-in cookie; no analytics. | No consent banner needed (PECR reg. 6(4)); mention it in the privacy notice. |
| ICO fee | — | Confirm Chayse has paid the ICO data protection fee. |
| Security (Art. 32) | See the security review. | Fix any high-severity findings before client use; keep the review on file. |

## 4. Selling ScopeFlow white-label

- **Contract pack needed:** SaaS subscription terms (licence, fees, service levels, support, suspension, liability cap, IP ownership, confidentiality, termination and data return), the Article 28 DPA with a sub-processor schedule, and an acceptable use policy.
- **End-user terms:** short portal terms for client users (accounts are personal; don't share codes; approvals are recorded). The tenant consultancy, not Chayse, should be the contracting party with its own clients.
- **Brand clearance:** a "SCOPEFLOW" mark was registered internationally by The Scope GmbH & Co. KG (2016, classes including 42 software design and 35 business services). The US extension was cancelled in 2024; status elsewhere (EU, UK) is unclear. **Have a trade mark search done at UKIPO and EUIPO before marketing under the ScopeFlow name.**
- **Liability:** if a disputed approval leads to a fee dispute between a consultancy and its client, the subscription terms should exclude Chayse's liability for the content of assessments and decisions.

## 5. Draft change control clause (for Chayse client contracts)

> **Changes.** Either party may request a change to the Services. [Supplier] will record each request and its assessment (scope, price, timing, assumptions and risks) in its online change control system (currently "ScopeFlow"). The Client nominates in writing the individuals authorised to approve changes ("Approvers") and may change them by notice. A change is agreed when an Approver approves the specific revision of its assessment in that system. That approval is the Client's signed, written agreement to vary this Agreement for the purposes of clause [variation clause], and binds the Client as if signed by an authorised signatory. Prices are stated excluding VAT. Where an assessment is an estimate, the Services will be charged [on a time and materials basis at the rates in Schedule [x] / up to the estimate plus [x]% without further approval]. "Working days" means Monday to Friday excluding bank holidays in England and Wales. Each party may rely on the system's records, including its change control notes, as evidence of the agreed change.

Make sure the contract's general variation clause cross-refers to this, so the two don't conflict.

## 6. Privacy notice outline (to be completed with Chayse's details)

1. Who we are: Chayse Consulting [legal entity, address, company number], and the contact for privacy questions.
2. What we collect: name, work email, organisation, role on the project, sign-in and decision records (time, IP address, browser), and what you write in requests, comments and questions.
3. Why and lawful basis: to run the project and keep a reliable record of agreed changes (legitimate interests; contract).
4. Who we share it with: the consultancy running your project; hosting and email (one.com, EU); AI suggestions, if enabled (Anthropic, US, under [transfer mechanism]).
5. How long: for the project and [6] years after, then deleted. Approval records can't be edited during that time.
6. Cookies: one essential sign-in cookie; no tracking.
7. Your rights: access, correction, objection, restriction, and erasure where it applies; complaints to the ICO.
