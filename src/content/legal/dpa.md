# Data Processing Addendum

**Version 1.1** · Effective September 2, 2026

This Data Processing Addendum ("**DPA**") forms part of the Master Services Agreement (the "**Agreement**") between **Nitin Bhatnagar, an individual doing business as Obra** ("**Provider**") and the contractor who accepted the Agreement ("**Contractor**"). Capitalized terms not defined here have the meaning given in the Agreement.

---

## 1. Scope and Roles

**1.1 What this covers.** This DPA governs Provider's handling of **Personal Information** collected from visitors to Contractor's Site through lead forms and, when the Pro Tier is configured and enabled, appointment booking and payment flows.

**1.2 Roles under the CCPA.** For that Personal Information:

- **Contractor is the "Business."** Contractor determines why and how it is collected and used.
- **Provider is a "Service Provider."** Provider processes it only on Contractor's behalf, for the purposes set out in this DPA.

**1.3 Definitions.** "Personal Information," "Business," "Service Provider," "Consumer," "process," "sell," and "share" have the meanings given in the California Consumer Privacy Act of 2018 as amended by the California Privacy Rights Act, Cal. Civ. Code § 1798.100 _et seq._ (the "**CCPA**").

---

## 2. What Provider Processes

**2.1 Categories of Personal Information.**

| Category               | Fields                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifiers            | Name, phone number, email address, ZIP code, and service address                                                                               |
| Commercial information | Project or service type, approximate square footage, timeline, selected service, appointment time, amount, currency, and payment/refund status |
| Free-text and files    | Messages, booking notes, and optional attachments a visitor chooses to provide                                                                 |
| Calendar information   | Selected appointment time, availability observations, Google Calendar event identifiers, and event delivery status                             |
| Payment references     | Stripe customer, Checkout Session, PaymentIntent, Charge, refund, and dispute identifiers and status; card details remain with Stripe          |
| Internet activity      | IP address and browser user agent, used or captured for security, rate limiting, and hosting logs                                              |

**2.2 Categories of Consumers.** Visitors to Contractor's Site who submit a lead form or request an appointment — typically homeowners and property owners in Contractor's service area.

**2.3 Purpose of processing.** Provider processes Personal Information to deliver and manage leads; check appointment availability; create, update, cancel, and reconcile bookings; route visitor payments to Contractor through Stripe Connect; send transactional communications; handle refunds and disputes; and operate, secure, audit, support, and debug the Site.

**2.4 Duration.** Processing continues for the Agreement term and applicable retention periods described in Section 5.

---

## 3. Provider's Obligations as a Service Provider

Provider certifies that it understands the restrictions in this Section and will comply with them. Provider **shall not**:

**3.1** Sell or share Personal Information, as "sell" and "share" are defined in the CCPA. **Provider does not and will not sell or share Personal Information collected through Contractor's Site.**

**3.2** Retain, use, or disclose Personal Information for any purpose other than the specific purpose of performing the Services specified in the Agreement, including retaining, using, or disclosing it for a commercial purpose other than performing those Services, or as otherwise permitted by the CCPA.

**3.3** Retain, use, or disclose Personal Information outside the direct business relationship between Provider and Contractor.

**3.4** Combine Personal Information received from Contractor with personal information Provider receives from another source, except as permitted under CCPA regulations for a service provider performing services on behalf of more than one business.

**3.5** Use Personal Information for cross-context behavioral advertising.

**3.6** Use Personal Information to build or improve a profile of any Consumer, or to train any machine-learning or artificial-intelligence model.

Provider will notify Contractor promptly if Provider determines it can no longer meet these obligations.

---

## 4. Subprocessors

**4.1 Authorization.** Contractor authorizes Provider to engage the subprocessors listed below. Each is bound by contractual terms no less protective than this DPA.

**4.2 Current subprocessors.**

| Subprocessor                      | Purpose                                                                                                   | Data it receives                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel Inc.**                   | Hosting, serverless execution, logging                                                                    | Submitted lead and booking data transits hosting infrastructure; IP address and request metadata may appear in function logs                                                             |
| **Supabase, Inc.**                | Database, authentication, and private object storage                                                      | Lead, booking, customer, service, calendar, payment-reference, audit, consent, and attachment records                                                                                    |
| **Resend (Plus Five Five, Inc.)** | Transactional email delivery                                                                              | Recipient email address and the contents of lead, booking, payment, cancellation, refund, and operational messages                                                                       |
| **Google LLC**                    | Maps and, for configured Pro accounts, Google Calendar                                                    | Map request information; appointment time, service details, customer email as an event attendee, and calendar event identifiers                                                          |
| **Pipedream, Inc.**               | Google account connection and calendar event delivery for configured Pro accounts                         | Contractor account reference, selected calendar identifiers, trigger data, appointment details, and provider event metadata                                                              |
| **Cloudflare, Inc.**              | Domain registration, DNS, security, and edge request handling                                             | Domain registration details and request/network metadata; visitor form content may transit its network                                                                                   |
| **Stripe, Inc.**                  | Contractor subscription billing and visitor payments to configured Pro contractors through Stripe Connect | Contractor billing details; visitor name, email, service/amount metadata, and payment, refund, and dispute records. Stripe receives and stores card details directly; Provider does not. |

**4.3 Feature activation.** Google Calendar, Pipedream, and Stripe Connect process visitor data only for Pro accounts after those integrations and live booking are configured and enabled. Twilio (SMS alerts) and Anthropic (AI editing assistant) are not used for visitor lead or booking data under the current Starter and Pro offer unless this DPA and the applicable disclosures are updated before processing begins.

**4.4 Changes.** Provider will give Contractor at least **thirty (30) days' notice** before adding or replacing a subprocessor that will process Personal Information. If Contractor reasonably objects on data-protection grounds, Contractor may terminate the Agreement without penalty before the change takes effect.

---

## 5. Retention and Storage

> **This section describes what the system actually does. It is deliberately specific.**

**5.1 Persistent records.** Provider stores lead submissions and, for Pro booking, customer, appointment, consent, provider-reference, delivery, refund/dispute, audit, and optional attachment records in Supabase. These records support Contractor access, delivery, idempotency, security, reconciliation, customer service, and legal obligations.

**5.2 Where copies may exist.**

- **Supabase** — the system of record for lead, booking, consent, provider-reference, audit, and optional attachment data.
- **Contractor and customer inboxes** — copies of transactional lead and booking messages; recipients control their own retention.
- **Resend** — message logs and content under its retention schedule.
- **Google Calendar and Pipedream** — appointment/event and trigger records for configured Pro accounts.
- **Stripe** — subscription and connected-account payment, refund, and dispute records under Stripe's retention obligations.
- **Hosting and edge logs** — request and security metadata under provider retention schedules.
- **Operational monitoring** — delivery status, provider identifiers, error classes, and audit events used to diagnose failures.

**5.3 Retention and deletion.** Database records are retained under Provider's approved, data-class-specific policies and legal-hold requirements. Where automatic deletion has not been operationally approved, Provider retains the record rather than deleting it without proven authority. Provider will assist Contractor with verified access, correction, export, or deletion requests and will preserve records when law, fraud prevention, payment disputes, security, or legal hold requires it. Copies held independently by Contractor or a provider may follow that party's retention obligations.

**5.4 Operational controls.** Provider uses private database/storage access, immutable audit records, signed provider callbacks, restricted worker credentials, idempotency controls, and encryption supplied by its infrastructure providers. Live booking, workers, and provider delivery remain disabled until the associated production controls and retention decisions are verified.

---

## 6. Operational Monitoring

**6.1 Current behavior.** Website Leads are stored in Supabase for Contractor access. The current Website Leads path does not send lead emails or copy a monitoring inbox. For enabled transactional delivery paths, Provider may process recipient addresses, message content, delivery status, provider identifiers, and error classes through the subprocessors listed in Section 4.

**6.2 Restrictions.** Provider uses operational delivery and audit data only to provide, secure, support, reconcile, and diagnose the Services, subject to Section 3. Provider will not use visitor Personal Information to contact or market to the Consumer on its own behalf.

---

## 7. Security

**7.1 Measures in place.** Provider maintains the following:

- TLS encryption for all data in transit between the visitor, the Site, and subprocessors
- Encryption at rest as provided by Supabase, hosting, email, calendar, and payment subprocessors
- Input validation and schema enforcement on all submitted data
- Bot filtering on submission endpoints
- Access to production infrastructure restricted to Provider and credentialed personnel
- Secrets held in environment configuration, never in source control

**7.2 Proportionality.** Provider is a small business. The measures above are proportionate to contact, project, appointment, service-address, and payment-reference data. Stripe processes card and financial account details directly; Provider does not store full card numbers. Provider does not intentionally collect government identifiers, health information, or biometric data through Contractor's Site, and Contractor must not configure the Site to collect them.

**7.3 Personnel.** Provider will ensure that anyone authorized to process Personal Information is bound by confidentiality obligations.

---

## 8. Security Incidents

**8.1 Notice.** Provider will notify Contractor **without undue delay and no later than seventy-two (72) hours** after becoming aware of a security incident affecting Personal Information processed under this DPA.

**8.2 Contents.** The notice will describe, to the extent known: the nature of the incident, the categories and approximate number of Consumers affected, the likely consequences, and the measures taken or proposed.

**8.3 Cooperation.** Provider will reasonably cooperate with Contractor's investigation and with any notification Contractor is required to make under Cal. Civ. Code § 1798.82 or other applicable law.

**8.4 Who notifies Consumers.** As the Business, **Contractor is responsible for notifying affected Consumers and any regulator**, unless the parties agree otherwise in writing.

---

## 9. Consumer Rights Requests

**9.1 Requests to Provider.** If a Consumer contacts Provider directly to exercise a CCPA right, Provider will not respond substantively and will forward the request to Contractor within **five (5) business days**.

**9.2 Assistance.** Provider will provide reasonable assistance, at no additional charge, to help Contractor respond to verified requests to know, delete, correct, or opt out, subject to Section 5.3 and any applicable retention or legal-hold requirement.

**9.3 Contractor's responsibility.** Contractor is responsible for verifying requests, responding within statutory deadlines, and maintaining any required records.

---

## 10. Audit

On written request, no more than once per twelve-month period, Provider will provide Contractor with reasonable written information about its processing under this DPA sufficient for Contractor to confirm compliance. Provider is not obligated to permit on-site inspection or to disclose information about other customers.

---

## 11. Termination

**11.1** This DPA remains in effect while Provider processes Personal Information under the Agreement.

**11.2** On termination of the Agreement, Provider will stop admitting new lead and booking data and will return or delete Personal Information on Contractor's verified request under Section 5.3, except where retention is required for law, security, fraud prevention, payment/refund/dispute resolution, audit integrity, or legal hold.

---

## 12. General

**12.1 Precedence.** If this DPA conflicts with the Agreement on the subject of personal information, this DPA controls.

**12.2 Governing law.** California law governs this DPA.

**12.3 Changes.** Provider may update this DPA on thirty (30) days' notice, consistent with Section 1.4 of the Agreement.

**12.4 Contact.** Privacy questions: privacy@obra.com.

---

_Data Processing Addendum v1.1 · September 2, 2026 · Incorporated by reference into the Master Services Agreement._
