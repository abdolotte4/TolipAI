import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useEffect } from "react";

export default function PrivacyPolicy() {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-3">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm">Effective Date: April 6, 2026 &nbsp;|&nbsp; Last Updated: May 22, 2026</p>
          <div className="mt-6 h-px bg-gradient-to-r from-primary/50 to-transparent" />
        </div>

        <div className="prose max-w-none space-y-10 text-foreground/80">

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Introduction</h2>
            <p>
              <strong className="text-foreground">TolipAI LLC</strong> ("TolipAI," "we," "us," or "our"), a Wyoming Limited Liability Company
              (1095 Sugar View Dr Ste 500, Sheridan, WY 82801), is committed to protecting your privacy.
              This Privacy Policy explains how we collect, use, disclose, and safeguard information about you
              when you visit our website, use our services, or interact with us.
            </p>
            <p className="mt-3">
              By using our website or services, you consent to the practices described in this Privacy Policy.
              If you do not agree with this policy, please do not use our services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Information We Collect</h2>

            <p className="font-semibold text-foreground mb-2">Information You Provide Directly</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Name, email address, phone number, and company name submitted via our contact form or subscription checkout</li>
              <li>Communication preferences and service inquiries</li>
              <li>Payment information (processed by Stripe — we never store raw card data)</li>
              <li>SMS opt-in consent when you agree to receive marketing text messages from us</li>
            </ul>

            <p className="font-semibold text-foreground mt-4 mb-2">Information Collected Automatically</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>IP address, browser type, operating system, and referring URLs</li>
              <li>Pages visited, time spent on pages, and click-stream data</li>
              <li>Device identifiers and cookie data</li>
            </ul>

            <p className="font-semibold text-foreground mt-4 mb-2">Information from Third Parties</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Data enrichment providers used to improve our B2B outreach infrastructure (e.g., property records, publicly available contact data)</li>
              <li>Stripe for payment processing and subscription management</li>
              <li>Twilio for SMS and voice communication delivery</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Provide, maintain, and improve our managed marketing and data infrastructure services</li>
              <li>Process transactions and send related information, including purchase confirmations and invoices</li>
              <li>Send promotional communications, newsletters, and service updates (where you have opted in)</li>
              <li>Send SMS/text messages for marketing purposes where you have provided explicit consent</li>
              <li>Respond to comments, questions, and requests for customer service</li>
              <li>Monitor and analyze usage trends to improve the user experience</li>
              <li>Detect, investigate, and prevent fraudulent transactions and other illegal activities</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. SMS / Text Message Communications</h2>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
              <p className="font-semibold text-foreground mb-3">SMS Consent & Opt-In</p>
              <p>
                By providing your phone number and checking the SMS consent box on our contact form, you expressly consent to receive
                SMS/text messages from TolipAI for marketing updates and promotions. Message and data rates may apply.
                Message frequency varies.
              </p>
              <p className="mt-3 font-semibold text-foreground">To opt out:</p>
              <p className="mt-1">
                Reply <strong className="text-foreground">STOP</strong> to any SMS message to unsubscribe. You will receive a one-time confirmation
                and no further messages will be sent.
              </p>
              <p className="mt-3 font-semibold text-foreground">For help:</p>
              <p className="mt-1">
                Reply <strong className="text-foreground">HELP</strong> to any SMS message or contact us at{" "}
                <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a>.
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                We do not share SMS opt-in data or consent with third parties for their own marketing purposes.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Sharing of Information</h2>
            <p>We do not sell, trade, or rent your personal information to third parties. We may share information in the following limited circumstances:</p>
            <ul className="list-disc pl-6 mt-3 space-y-2">
              <li>
                <strong className="text-foreground">Service Providers</strong> — We share information with vendors and service providers who perform
                services on our behalf (e.g., Stripe for payments, Twilio for SMS/voice, cloud infrastructure providers).
                These parties are bound by contractual obligations to keep information confidential and use it only to provide the contracted services.
              </li>
              <li>
                <strong className="text-foreground">Legal Requirements</strong> — We may disclose information if required by law, court order,
                or government authority, or if we believe disclosure is necessary to protect our rights or the safety of others.
              </li>
              <li>
                <strong className="text-foreground">Business Transfers</strong> — In connection with any merger, acquisition, or sale of business assets,
                your information may be transferred. We will provide notice before information is transferred and becomes subject to a different privacy policy.
              </li>
              <li>
                <strong className="text-foreground">With Your Consent</strong> — We may share information for other purposes with your explicit consent.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Cookies & Tracking Technologies</h2>
            <p>
              We use cookies, web beacons, and similar tracking technologies to track activity on our website and hold certain information.
              Cookies are small files placed on your device.
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li><strong className="text-foreground">Essential cookies</strong> — Required for the website to function properly</li>
              <li><strong className="text-foreground">Analytics cookies</strong> — Help us understand how visitors interact with our website</li>
              <li><strong className="text-foreground">Preference cookies</strong> — Remember your settings and preferences (e.g., dark mode)</li>
            </ul>
            <p className="mt-3">
              You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent.
              However, if you do not accept cookies, some portions of our website may not function properly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Data Retention</h2>
            <p>
              We retain personal information for as long as necessary to fulfill the purposes for which it was collected,
              including for the purposes of satisfying any legal, accounting, or reporting requirements.
            </p>
            <p className="mt-3">
              When determining the appropriate retention period, we consider the amount, nature, and sensitivity of the personal
              information, the potential risk of harm from unauthorized use or disclosure, the purposes for which we process
              personal information, and applicable legal requirements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Data Security</h2>
            <p>
              We implement appropriate technical and organizational security measures to protect your personal information against
              accidental or unlawful destruction, loss, alteration, unauthorized disclosure, or access.
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>All data is transmitted over encrypted connections (TLS/HTTPS)</li>
              <li>Sensitive credentials (e.g., Twilio Auth Tokens) are encrypted at rest using AES-256</li>
              <li>Payment data is handled exclusively by Stripe (PCI DSS Level 1 certified) — we never store raw card numbers</li>
              <li>Access to personal data is restricted to authorized personnel on a need-to-know basis</li>
            </ul>
            <p className="mt-3">
              While we strive to use commercially acceptable means to protect your personal information,
              no method of transmission over the internet or electronic storage is 100% secure.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Your Rights & Choices</h2>
            <p>Depending on your location, you may have the following rights regarding your personal information:</p>
            <ul className="list-disc pl-6 mt-3 space-y-2">
              <li><strong className="text-foreground">Access</strong> — Request a copy of the personal information we hold about you</li>
              <li><strong className="text-foreground">Correction</strong> — Request correction of inaccurate or incomplete information</li>
              <li><strong className="text-foreground">Deletion</strong> — Request deletion of your personal information, subject to certain exceptions</li>
              <li><strong className="text-foreground">Opt-out of SMS</strong> — Reply STOP to any text message or contact us at info@tolipai.com</li>
              <li><strong className="text-foreground">Opt-out of email marketing</strong> — Click "unsubscribe" in any marketing email</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, please contact us at{" "}
              <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a>.
              We will respond to your request within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Children's Privacy</h2>
            <p>
              Our services are not directed to individuals under the age of 18. We do not knowingly collect personal information
              from children under 18. If we become aware that a child under 18 has provided us with personal information,
              we will take steps to delete that information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">11. Third-Party Links</h2>
            <p>
              Our website may contain links to third-party websites, including Stripe's billing portal and Calendly for scheduling.
              We are not responsible for the privacy practices of those websites and encourage you to review their privacy policies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">12. Changes to This Privacy Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new
              Privacy Policy on this page with an updated effective date. For material changes, we will notify you by email.
              Your continued use of our services after any change constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">13. Contact Us</h2>
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <p className="font-semibold text-foreground mb-3">TolipAI LLC</p>
              <p>1095 Sugar View Dr Ste 500, Sheridan, WY 82801</p>
              <p className="mt-2">📧 <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a></p>
              <p>📞 (555) 201-4892</p>
              <p className="mt-3 text-sm text-muted-foreground">
                For privacy-related inquiries, please include "Privacy Request" in the subject line.
              </p>
            </div>
          </section>

          <div className="pt-6 border-t border-border">
            <p className="text-sm text-muted-foreground">
              This Privacy Policy is governed by the laws of the State of Wyoming. For our full Terms of Service, visit{" "}
              <a href="/terms-of-service" className="text-primary underline hover:text-primary/80">
                tolipai.com/terms-of-service
              </a>.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
