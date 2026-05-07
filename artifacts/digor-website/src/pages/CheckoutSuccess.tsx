import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle, ArrowRight } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function CheckoutSuccess() {
  const [sessionData, setSessionData] = useState<any>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (sessionId) {
      fetch(`${API_BASE}/api/stripe/session/${sessionId}`)
        .then(r => r.json())
        .then(d => setSessionData(d.session))
        .catch(() => {});
    }
  }, []);

  const customerEmail = sessionData?.customer_details?.email || sessionData?.metadata?.customerEmail;
  const customerName = sessionData?.customer_details?.name || sessionData?.metadata?.customerName;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-32 text-center">
        <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-8">
          <CheckCircle className="w-12 h-12 text-green-500" />
        </div>

        <h1 className="text-4xl font-bold text-foreground mb-4">Welcome to TolipAI!</h1>
        <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
          Your subscription is confirmed. {customerName ? `Thank you, ${customerName}.` : ""} You'll receive a confirmation receipt
          {customerEmail ? <> at <span className="text-primary">{customerEmail}</span></> : " at your email address"}.
        </p>

        <div className="bg-card border border-border rounded-2xl p-6 mb-8 text-left shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4">What happens next?</h2>
          <div className="space-y-4">
            {[
              { step: "1", title: "Confirmation Email", desc: "You'll receive an invoice and subscription confirmation from Stripe within minutes." },
              { step: "2", title: "Account Setup", desc: "Our team will reach out within 1 business day to kick off your onboarding." },
              { step: "3", title: "Dedicated Manager", desc: "You'll be assigned a dedicated account manager who will guide your setup end-to-end." },
              { step: "4", title: "Service Activation", desc: "Your managed marketing infrastructure will be fully operational within 5–7 business days." },
            ].map(item => (
              <div key={item.step} className="flex gap-4">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0 text-primary font-bold text-sm">
                  {item.step}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-muted border border-border rounded-xl p-4 mb-8 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">Need to cancel or have questions?</p>
          <p>Send an email to <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a> — cancellation requires an official email request per our Terms of Service.</p>
        </div>

        <Link href="/">
          <a className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors">
            Back to Home <ArrowRight className="w-4 h-4" />
          </a>
        </Link>
      </main>
      <Footer />
    </div>
  );
}
