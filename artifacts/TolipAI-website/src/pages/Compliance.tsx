import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useEffect } from "react";

export default function Compliance() {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-3">Compliance & Acceptable Use</h1>
          <p className="text-muted-foreground text-sm">Effective Date: April 6, 2026 &nbsp;|&nbsp; Last Updated: June 28, 2026</p>
          <div className="mt-6 h-px bg-gradient-to-r from-primary/50 to-transparent" />
        </div>

        <div className="prose max-w-none space-y-10 text-foreground/80">

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Platform Purpose</h2>
            <p>
              TolipAI provides workflow automation, CRM support, property analysis, and administrative operations tools for real estate professionals. TolipAI is a brand operated by <strong className="text-foreground">Tolip Group LLC</strong>, a Wyoming limited liability company (1309 Coffeen Avenue STE 1200, Sheridan, Wyoming 82801).
            </p>
            <p className="mt-3">
              Our platform is designed to support real estate professionals in organizing lead pipelines, evaluating properties, automating CRM workflows, and managing administrative operations — all in compliance with applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Prohibited Uses</h2>
            <p>
              TolipAI services may not be used for any of the following:
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-2">
              <li>Unlawful robocalling, spam, spoofing, or impersonation</li>
              <li>Harassment or threatening communications of any kind</li>
              <li>Deceptive marketing, false advertising, or misleading representations</li>
              <li>Communications to recipients without legally required consent</li>
              <li>Any activity that violates the Telephone Consumer Protection Act (TCPA), CAN-SPAM Act, Do Not Call regulations, or applicable state privacy and consumer protection laws</li>
              <li>Credit eligibility determinations, employment screening, tenant screening, or insurance underwriting</li>
              <li>Consumer reporting purposes regulated under the Fair Credit Reporting Act (FCRA), unless expressly authorized in writing by Tolip Group LLC</li>
              <li>Any activity that constitutes fraud, deception, or a violation of any applicable federal, state, or local law or regulation</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. User Responsibilities</h2>
            <p>
              Users are responsible for ensuring all imported contacts, records, property information, and communications are lawfully sourced and used for permitted business purposes.
            </p>
            <p className="mt-3">
              Specifically, users agree to:
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-2">
              <li>Obtain all legally required consents before initiating any communications through or in connection with TolipAI tools</li>
              <li>Honor all opt-out requests promptly and maintain required suppression lists</li>
              <li>Use only lawfully sourced property records and contact data</li>
              <li>Comply with all applicable data protection, privacy, real estate licensing, and consumer protection requirements</li>
              <li>Not use TolipAI tools to circumvent any applicable legal requirement</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Data Sourcing Standards</h2>
            <p>
              Any property records, contact information, or other data imported into TolipAI CRM must be lawfully sourced. TolipAI does not verify the provenance of client-provided data. Clients bear full responsibility for ensuring their data sources and use cases comply with applicable law.
            </p>
            <p className="mt-3">
              TolipAI tools support the organization and analysis of client-provided records for permitted real estate business purposes. We do not provide data sourcing, contact enrichment, or lookup services as part of the standard platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. FCRA Disclosure</h2>
            <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl p-5">
              <p className="font-semibold text-amber-800 dark:text-amber-200 mb-2">Important Notice Regarding FCRA</p>
              <p>
                TolipAI is not a consumer reporting agency as defined under the Fair Credit Reporting Act (FCRA), and TolipAI's services are not consumer reports. TolipAI services may not be used for any purpose regulated under the FCRA, including but not limited to: credit eligibility, employment eligibility, tenant screening, insurance underwriting, or any other purpose listed in 15 U.S.C. § 1681b — unless expressly authorized in writing by Tolip Group LLC.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. No Legal or Financial Advice</h2>
            <p>
              TolipAI does not provide legal, financial, tax, investment, credit, or compliance advice. Nothing on this platform or in our communications should be construed as legal or financial advice. Users should consult qualified legal counsel for guidance on compliance with applicable laws governing their use of CRM tools, communications, and property research data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Enforcement</h2>
            <p>
              Tolip Group LLC reserves the right to suspend or terminate access to TolipAI services for any user found to be in violation of this Acceptable Use Policy, our Terms of Service, or applicable law. Violations may also be reported to appropriate regulatory authorities.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Reporting Concerns</h2>
            <p>
              If you have concerns about potential misuse of TolipAI's platform, or if you believe you have received communications in violation of this policy, please contact us:
            </p>
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm mt-4">
              <p className="font-semibold text-foreground mb-3">Tolip Group LLC</p>
              <p>1309 Coffeen Avenue STE 1200, Sheridan, Wyoming 82801</p>
              <p className="mt-2">📧 <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a></p>
              <p>📞 (659) 250-4618</p>
              <p className="mt-3 text-sm text-muted-foreground">
                For compliance concerns, include "Compliance Concern" in the subject line.
              </p>
            </div>
          </section>

          <div className="pt-6 border-t border-border">
            <p className="text-sm text-muted-foreground">
              This Compliance & Acceptable Use Policy is incorporated by reference into TolipAI's{" "}
              <a href="/terms-of-service" className="text-primary underline hover:text-primary/80">Terms of Service</a>.
              By using TolipAI's platform, you agree to comply with this policy in full.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              © 2026 Tolip Group LLC. TolipAI is a brand operated by Tolip Group LLC. All rights reserved.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
