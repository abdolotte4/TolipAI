import { Link } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

export default function CookiePolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <h1 className="text-4xl font-bold mb-2 font-display">Cookie Policy</h1>
        <p className="text-muted-foreground text-sm mb-10">
          Effective Date: April 6, 2026 &nbsp;|&nbsp; Last Updated: August 5, 2026
        </p>

        <div className="prose prose-invert max-w-none space-y-10 text-muted-foreground">

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Who We Are</h2>
            <p>
              TolipAI is a brand operated by <strong className="text-foreground">Tolip Group LLC</strong>, a Wyoming Limited Liability Company. Our registered address is 1309 Coffeen Avenue STE 1200, Sheridan, Wyoming 82801. This Cookie Policy explains how TolipAI uses cookies and similar tracking technologies on <strong className="text-foreground">tolipai.com</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. What Are Cookies</h2>
            <p>
              Cookies are small text files placed on your device when you visit a website. They are widely used to make websites work efficiently, remember your preferences, and provide information to website owners. Cookies may be "session cookies" (deleted when you close your browser) or "persistent cookies" (stored on your device for a set period).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. Cookies We Use</h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-foreground font-semibold mb-1">3.1 Strictly Necessary Cookies</h3>
                <p>These cookies are essential for the website to function. They enable core features such as security, network management, and accessibility. You cannot opt out of these cookies.</p>
              </div>
              <div>
                <h3 className="text-foreground font-semibold mb-1">3.2 Functional Cookies</h3>
                <p>These cookies allow us to remember choices you make (such as your preferred language or region) and provide enhanced, personalized features. They may be set by us or by third-party providers whose services we use.</p>
              </div>
              <div>
                <h3 className="text-foreground font-semibold mb-1">3.3 Analytics Cookies</h3>
                <p>We may use analytics cookies to understand how visitors interact with our website — including which pages are visited most, time spent on pages, and errors encountered. This information helps us improve our platform. All analytics data is aggregated and anonymized.</p>
              </div>
              <div>
                <h3 className="text-foreground font-semibold mb-1">3.4 Marketing / Preference Cookies</h3>
                <p>These cookies may be used to deliver content relevant to your interests. TolipAI does not currently run third-party advertising campaigns. If this changes, this policy will be updated accordingly.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Third-Party Cookies</h2>
            <p>
              Some cookies on our website are set by third-party services we use, including:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong className="text-foreground">Stripe</strong> — payment processing (when you initiate a subscription)</li>
              <li><strong className="text-foreground">Analytics providers</strong> — aggregated, anonymized usage tracking</li>
            </ul>
            <p className="mt-3">
              Third-party cookies are governed by the respective third party's privacy and cookie policies. We have no control over those cookies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Managing Your Cookie Preferences</h2>
            <p>
              You can control and manage cookies in several ways:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-2">
              <li><strong className="text-foreground">Browser settings:</strong> Most browsers allow you to refuse or delete cookies through their settings. Consult your browser's help documentation for instructions.</li>
              <li><strong className="text-foreground">Opt-out tools:</strong> You may use opt-out tools provided by analytics vendors (e.g., Google Analytics opt-out browser add-on) where applicable.</li>
              <li><strong className="text-foreground">Do Not Track:</strong> Some browsers transmit a "Do Not Track" signal. We honor this signal where technically feasible.</li>
            </ul>
            <p className="mt-3">
              Please note that disabling certain cookies may affect the functionality of our website.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Cookie Retention</h2>
            <p>
              Session cookies are deleted when you close your browser. Persistent cookies remain on your device until they expire or you delete them. Retention periods vary by cookie type, typically ranging from 30 days to 2 years for persistent cookies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Changes to This Policy</h2>
            <p>
              We may update this Cookie Policy from time to time. When we do, we will update the "Last Updated" date at the top of this page. Continued use of our website after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Contact Us</h2>
            <p>
              If you have questions about our use of cookies, please contact us:
            </p>
            <ul className="list-none mt-2 space-y-1">
              <li><strong className="text-foreground">Company:</strong> Tolip Group LLC (operating as TolipAI)</li>
              <li><strong className="text-foreground">Address:</strong> 1309 Coffeen Avenue STE 1200, Sheridan, Wyoming 82801</li>
              <li><strong className="text-foreground">Email:</strong> <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a></li>
              <li><strong className="text-foreground">Phone:</strong> (659) 250-4618</li>
            </ul>
          </section>

          <section className="border-t border-border/50 pt-6 text-sm">
            <p>
              Related policies:{" "}
              <Link href="/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link>
              {" · "}
              <Link href="/terms-of-service" className="text-primary hover:underline">Terms of Service</Link>
              {" · "}
              <Link href="/acceptable-use" className="text-primary hover:underline">Acceptable Use Policy</Link>
              {" · "}
              <Link href="/compliance" className="text-primary hover:underline">Compliance</Link>
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
