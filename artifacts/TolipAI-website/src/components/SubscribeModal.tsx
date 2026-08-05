import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shield, TrendingUp, CheckCircle } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Plan = "full" | "half" | "performance";
type Step = "plan" | "form" | "redirecting";

const PLANS: Record<Plan, { label: string; price: number; priceId: string; leads: string; desc: string; badge?: string; note?: string }> = {
  full: {
    label: "Full Package",
    price: 1500,
    priceId: "price_1TJLsdIRQyNh8s19OjY6WyAH",
    leads: "Full CRM & Workflow Automation",
    desc: "Full TolipAI CRM access, workflow automation, AI property analysis tools, pipeline management, reporting dashboards, and CRM administration support.",
  },
  performance: {
    label: "Growth Infrastructure",
    price: 1000,
    priceId: "price_1TJR0HIRQyNh8s19lwWYhofS",
    leads: "CRM Platform & Operational Support",
    desc: "CRM platform access, workflow automation, reporting tools, and operational support for your real estate team.",
  },
  half: {
    label: "Half Package",
    price: 750,
    priceId: "price_1TJLsdIRQyNh8s19y3Fhwjih",
    leads: "Core CRM Functionality",
    desc: "Core CRM functionality, pipeline tracking, AI-assisted property analysis tools, and essential workflow automation.",
  },
};

export function SubscribeModal({ isOpen, onClose }: SubscribeModalProps) {
  const [step, setStep] = useState<Step>("plan");
  const [selectedPlan, setSelectedPlan] = useState<Plan>("full");
  const [form, setForm] = useState({ name: "", email: "", company: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const reset = () => {
    setStep("plan");
    setSelectedPlan("full");
    setForm({ name: "", email: "", company: "" });
    setErrors({});
    setLoading(false);
    setApiError("");
  };

  const handleClose = () => {
    onClose();
    setTimeout(reset, 300);
  };

  const validateForm = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Full name is required";
    if (!form.email.trim()) e.email = "Email address is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Please enter a valid email";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    setApiError("");

    try {
      const res = await fetch(`${API_BASE}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: PLANS[selectedPlan].priceId,
          email: form.email,
          name: form.name,
          company: form.company,
          agreedToTerms: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setApiError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      setStep("redirecting");
      window.location.href = data.url;
    } catch {
      setApiError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  };

  const plan = PLANS[selectedPlan];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 25 }}
            className="w-full max-w-lg bg-[#0f1728] border border-[#1f2937] rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="bg-[#0a0e1a] px-6 py-4 flex items-center justify-between border-b border-[#1f2937]">
              <div>
                <h2 className="text-lg font-bold text-white">TOLIPAI<span className="text-[#d4af37]">.</span> Platform Plans</h2>
                <p className="text-xs text-gray-400">CRM &amp; Workflow Automation Plans</p>
              </div>
              <button onClick={handleClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-[#1f2937]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[80vh] overflow-y-auto">

              {/* STEP 1: Select Plan */}
              {step === "plan" && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">Choose Your Package</h3>
                  <p className="text-sm text-gray-400 mb-5">Select the managed infrastructure tier for your real estate operation.</p>

                  <div className="space-y-3 mb-6">
                    {(Object.entries(PLANS) as [Plan, typeof PLANS[Plan]][]).map(([key, p]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedPlan(key)}
                        className={`w-full text-left p-5 rounded-xl border-2 transition-all ${selectedPlan === key ? "border-[#d4af37] bg-[#d4af37]/10" : "border-[#1f2937] bg-[#111827] hover:border-[#374151]"}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selectedPlan === key ? "border-[#d4af37]" : "border-[#374151]"}`}>
                                {selectedPlan === key && <div className="w-2 h-2 rounded-full bg-[#d4af37]" />}
                              </div>
                              <span className="font-bold text-white">{p.label}</span>
                              {p.badge && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                  {p.badge}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-300 pl-6 leading-relaxed">{p.desc}</p>
                            {p.note && (
                              <p className="text-xs text-amber-400/80 pl-6 mt-1.5 leading-relaxed">{p.note}</p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-2xl font-bold text-[#d4af37]">${p.price.toLocaleString()}</span>
                            <p className="text-xs text-gray-400">/month</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    {[
                      { icon: Shield, label: "Secure Checkout" },
                      { icon: TrendingUp, label: "Proven Results" },
                      { icon: CheckCircle, label: "Quality Assured" },
                    ].map(({ icon: Icon, label }) => (
                      <div key={label} className="text-center p-3 bg-[#111827] rounded-lg border border-[#1f2937]">
                        <Icon className="w-4 h-4 text-[#d4af37] mx-auto mb-1" />
                        <p className="text-xs text-gray-400">{label}</p>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setStep("form")}
                    className="w-full py-3.5 bg-[#d4af37] text-[#0a0e1a] font-bold rounded-xl hover:bg-[#b8962e] transition-colors text-sm"
                  >
                    Get Started — {plan.label} ${plan.price.toLocaleString()}/mo
                  </button>
                  <p className="text-center text-xs text-gray-500 mt-3">Recurring subscription · Cancel anytime via email</p>
                </div>
              )}

              {/* STEP 2: Contact Form → directly to Stripe */}
              {step === "form" && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">Your Information</h3>
                  <p className="text-sm text-gray-400 mb-5">We'll use this to set up your account. You'll review and agree to terms on the next page.</p>

                  <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-3 mb-5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{plan.label}</p>
                      <p className="text-xs text-gray-400">{plan.leads}</p>
                    </div>
                    <span className="text-[#d4af37] font-bold">${plan.price.toLocaleString()}<span className="text-xs text-gray-400">/mo</span></span>
                  </div>

                  <form onSubmit={handleFormSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Full Name *</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full px-4 py-3 bg-[#0a0e1a] border border-[#374151] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d4af37] transition-colors text-sm"
                        placeholder="John Smith"
                      />
                      {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Email Address *</label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        className="w-full px-4 py-3 bg-[#0a0e1a] border border-[#374151] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d4af37] transition-colors text-sm"
                        placeholder="john@company.com"
                      />
                      {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Company Name</label>
                      <input
                        type="text"
                        value={form.company}
                        onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                        className="w-full px-4 py-3 bg-[#0a0e1a] border border-[#374151] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d4af37] transition-colors text-sm"
                        placeholder="Acme Real Estate LLC"
                      />
                    </div>

                    {apiError && (
                      <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3 text-sm text-red-300">
                        {apiError}
                      </div>
                    )}

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setStep("plan")}
                        disabled={loading}
                        className="flex-1 py-3 border border-[#374151] text-gray-300 rounded-xl hover:bg-[#1f2937] transition-colors text-sm font-medium disabled:opacity-50"
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 py-3.5 bg-[#d4af37] text-[#0a0e1a] font-bold rounded-xl hover:bg-[#b8962e] transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {loading ? (
                          <>
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Preparing...
                          </>
                        ) : (
                          <>
                            <Shield className="w-4 h-4" />
                            Proceed to Payment
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-center text-xs text-gray-500">
                      Secured by Stripe · You'll review and agree to terms on the next page
                    </p>
                  </form>
                </div>
              )}

              {/* Redirecting */}
              {step === "redirecting" && (
                <div className="text-center py-10">
                  <div className="w-16 h-16 bg-[#d4af37]/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <Shield className="w-8 h-8 text-[#d4af37]" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Redirecting to Stripe...</h3>
                  <p className="text-gray-400 text-sm">Taking you to our secure payment page. Please do not close this window.</p>
                </div>
              )}

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
