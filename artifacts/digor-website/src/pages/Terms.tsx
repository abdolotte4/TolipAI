import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useEffect } from "react";

export default function Terms() {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-3">Terms of Service</h1>
          <p className="text-muted-foreground text-sm">Effective Date: April 6, 2026 &nbsp;|&nbsp; Last Updated: April 6, 2026</p>
          <div className="mt-6 h-px bg-gradient-to-r from-primary/50 to-transparent" />
        </div>

        <div className="prose max-w-none space-y-10 text-foreground/80">

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Agreement to Terms</h2>
            <p>
              By subscribing to any service offered by <strong className="text-foreground">TolipAI LLC</strong> ("TolipAI," "we," "us," or "our"),
              a Wyoming Limited Liability Company (1095 Sugar View Dr Ste 500, Sheridan, WY 82801),
              you ("Client," "you," or "your") agree to be bound by these Terms of Service ("Terms").
              If you do not agree to these Terms, do not subscribe or use our services.
            </p>
            <p className="mt-3">
              By clicking the agreement checkbox and completing payment, you confirm that you have read, understood, and accept these Terms in full.
              This agreement is legally binding upon both parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Services</h2>
            <p>
              TolipAI LLC provides managed B2B marketing and data infrastructure services for real estate investors, including but not limited to:
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Managed Data Engineering &amp; Contact Enrichment</li>
              <li>Outreach Operations Management</li>
              <li>Technical CRM Infrastructure Setup</li>
              <li>Human-in-the-Loop QA Protocol</li>
              <li>Operational Compliance Framework</li>
              <li>Dedicated Account Management</li>
              <li>Monthly Performance Reporting</li>
            </ul>
            <p className="mt-3">
              The specific scope of services delivered is defined by the subscription plan selected at the time of purchase.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. Subscription &amp; Billing</h2>
            <p>
              All subscriptions are billed on a recurring monthly basis. By subscribing, you authorize TolipAI LLC to automatically charge
              your payment method on file each billing period until you cancel.
            </p>
            <p className="mt-3">
              Billing is processed securely through Stripe. Your payment information is never stored on our servers.
              By subscribing, you also agree to{" "}
              <a href="https://stripe.com/legal/consumer" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
                Stripe's Consumer Terms
              </a>.
            </p>
            <p className="mt-3">
              Subscription fees are due on the same calendar day each month as the original subscription date. If a payment fails,
              we will attempt to retry the charge. Continued failure may result in service suspension.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Non-Refundable Policy</h2>
            <div className="bg-red-50 border border-red-200 rounded-xl p-5">
              <p className="font-semibold text-red-600 mb-2">⚠ All payments are non-refundable.</p>
              <p>
                Due to the immediate deployment of managed services, dedicated resources, and proprietary data infrastructure
                upon subscription activation, <strong className="text-foreground">all subscription fees are non-refundable</strong> once a billing period has commenced.
                No partial refunds, prorated credits, or exceptions will be made for any reason, including but not limited to:
              </p>
              <ul className="list-disc pl-6 mt-3 space-y-1">
                <li>Failure to use the service</li>
                <li>Dissatisfaction with results</li>
                <li>Change of business direction</li>
                <li>Technical issues on the Client's end</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Cancellation Policy</h2>

            <p className="font-semibold text-foreground mb-2">Cancelling Future Billing</p>
            <p>
              You may cancel your subscription at any time to stop future charges. Cancellation can be completed through either of the following methods:
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-2">
              <li>
                <strong className="text-foreground">Stripe Self-Service Portal</strong> — Log in to your Stripe billing portal
                and cancel directly. This is the fastest method and takes effect immediately.
              </li>
              <li>
                <strong className="text-foreground">Official Email Request</strong> — Send a cancellation request to{" "}
                <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a>{" "}
                with the subject line: <em>"Subscription Cancellation Request — [Your Account Email]"</em>
              </li>
            </ul>
            <p className="mt-4">
              Cancellation requests submitted through any other channel (phone, chat, social media, etc.) will not be accepted.
              Your cancellation takes effect at the end of the current billing period. You will retain access to services
              until that date. No further charges will be made after a confirmed cancellation.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mt-6">
              <p className="font-semibold text-amber-700 mb-2">3-Day Billing Inquiry Window</p>
              <p>
                Service is non-refundable. For billing inquiries or technical support, please contact us{" "}
                <strong className="text-foreground">by email only</strong> at{" "}
                <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a>{" "}
                within <strong className="text-foreground">3 calendar days</strong> of the charge date.
              </p>
              <p className="mt-3">
                If no billing inquiry is received via official email within 3 calendar days of a billing charge,
                the service for that period is deemed <strong className="text-foreground">provided and satisfied</strong>.
                After this window, no reversal of that period's charge will be considered under any circumstances,
                regardless of cancellation method used.
              </p>
              <p className="mt-3 text-sm text-amber-600/80">
                Note: Cancelling your subscription through Stripe stops future billing but does not entitle you to a refund
                for the current billing period. All billing inquiries must be submitted via email within the 3-day window.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Dispute Resolution</h2>
            <p>
              Before initiating any chargeback or payment dispute with your card issuer or bank, you agree to first contact
              TolipAI LLC directly at <span className="text-primary">info@tolipai.com</span> to attempt resolution.
              Unauthorized chargebacks may result in immediate service termination and may be contested with full documentation
              of ToS acceptance, service delivery records, and communication logs.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Client Responsibilities</h2>
            <p>You agree to:</p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Provide accurate and complete information at the time of subscription</li>
              <li>Maintain a valid payment method on file</li>
              <li>Respond to onboarding requests within a reasonable timeframe</li>
              <li>Comply with all applicable laws in connection with your use of our services</li>
              <li>Not misuse or attempt to reverse-engineer any proprietary systems or data provided</li>
              <li>Client acknowledges that TolipAI LLC does not share SMS opt-in data or consent with third parties for marketing purposes, and Client agrees to maintain similar privacy standards for any data enriched through our infrastructure.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, TolipAI LLC shall not be liable for any indirect, incidental, special,
              consequential, or punitive damages, including but not limited to lost profits, lost revenue, lost business opportunities,
              or data loss arising out of or related to your use of our services.
            </p>
            <p className="mt-3">
              Our total aggregate liability for any claims under these Terms shall not exceed the total amount paid by you
              to TolipAI LLC in the 30 days immediately preceding the event giving rise to the claim.
            </p>
            <p className="mt-3">
              TolipAI LLC provides infrastructure and support services; we do not guarantee specific financial outcomes,
              conversion rates, or a minimum number of closed real estate transactions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Modifications to Terms</h2>
            <p>
              TolipAI LLC reserves the right to modify these Terms at any time. Changes will be posted on this page with an updated
              effective date. Your continued use of our services after any change constitutes acceptance of the revised Terms.
              For material changes, we will notify you by email at least 14 days in advance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the State of Wyoming,
              without regard to its conflict of law provisions. Any disputes shall be resolved in the courts of Sheridan County, Wyoming.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">11. Contact</h2>
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <p className="font-semibold text-foreground mb-3">TolipAI LLC</p>
              <p>1095 Sugar View Dr Ste 500, Sheridan, WY 82801</p>
              <p className="mt-2">📧 <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a></p>
              <p>📞 (555) 201-4892</p>
            </div>
          </section>

          <div className="pt-6 border-t border-border">
            <p className="text-sm text-muted-foreground">
              By subscribing to any TolipAI LLC service, you acknowledge that you have read these Terms of Service,
              understand them, and agree to be bound by them. These Terms, together with Stripe's{" "}
              <a href="https://stripe.com/legal/consumer" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
                Consumer Terms
              </a>,
              constitute the entire agreement between you and TolipAI LLC with respect to the subject matter hereof.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
