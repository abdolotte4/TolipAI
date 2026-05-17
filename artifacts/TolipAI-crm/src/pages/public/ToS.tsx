import { Link } from "wouter";
import { ArrowLeft, Shield } from "lucide-react";

const LAST_UPDATED = "May 2026";

const SECTIONS = [
  {
    id: "service",
    title: "1. Service Description",
    content: `TolipAI provides a real estate wholesaling platform including:`,
    list: [
      "Customer Relationship Management (CRM)",
      "AI-powered voice and SMS communication",
      "Property data and skip tracing tools",
      "Analytics and reporting",
      "Browser-based calling and power dialing",
      "Contract generation and e-signature",
    ],
    after: null,
  },
  {
    id: "responsibilities",
    title: "2. User Responsibilities",
    content: `You are solely responsible for:`,
    list: [
      "Compliance with TCPA, TSR, CAN-SPAM, and state telemarketing laws",
      "Obtaining proper consent before contacting any individual",
      "Maintaining Do-Not-Call list compliance",
      "Two-party consent for call recording where required by applicable law",
      "Legal use of skip trace data (not for FCRA-covered purposes)",
      "Content of AI-generated messages and calls",
    ],
    after: "Failure to comply with applicable laws may result in immediate account termination.",
  },
  {
    id: "ai-disclosure",
    title: "3. AI Voice Agent Disclosure",
    content: `Our AI voice agent technology may be used to answer inbound calls and qualify sellers. You must disclose to callers that they are speaking with an AI system if required by applicable law (including, without limitation, California Business & Professions Code §17941). TolipAI is not responsible for your failure to make required disclosures.`,
    list: null,
    after: null,
  },
  {
    id: "data",
    title: "4. Data Usage & Skip Tracing",
    content: `Property data and skip trace results are provided for real estate acquisition purposes only. You may not use this data for credit, employment, insurance, or tenant screening (FCRA-regulated purposes). Data is licensed, not sold, and may not be resold or redistributed to third parties.`,
    list: null,
    after: null,
  },
  {
    id: "recording",
    title: "5. Call Recording Consent",
    content: `By using our call recording features, you represent that you have obtained all necessary consents under applicable federal and state laws (including two-party consent states). TolipAI logs recording initiation but does not independently verify consent. You assume all liability for recording consent compliance.`,
    list: null,
    after: null,
  },
  {
    id: "liability",
    title: "6. Limitation of Liability",
    content: `IN NO EVENT SHALL TOLIPAI'S TOTAL LIABILITY EXCEED THE AMOUNT PAID BY YOU IN THE 12 MONTHS PRECEDING THE CLAIM. TOLIPAI IS NOT LIABLE FOR:`,
    list: [
      "TCPA fines or penalties arising from your use of the platform",
      "Data misuse by you or any of your campaign users",
      "Third-party API outages (Twilio, OpenAI, ATTOM, Propwire, etc.)",
      "AI-generated content that violates applicable laws",
      "Loss of leads, deals, or revenue caused by service interruptions",
    ],
    after: null,
  },
  {
    id: "indemnification",
    title: "7. Indemnification",
    content: `You agree to indemnify, defend, and hold harmless TolipAI LLC, its officers, employees, and agents from any claims, damages, fines, or expenses (including reasonable attorneys' fees) arising from:`,
    list: [
      "Your contact lists and lead sources",
      "Your messaging content (SMS, email, AI voice)",
      "Your failure to obtain required consent",
      "Your misuse of property data or skip trace results",
      "Your violation of any applicable law or regulation",
    ],
    after: null,
  },
  {
    id: "arbitration",
    title: "8. Arbitration & Dispute Resolution",
    content: `Any dispute arising from or relating to these Terms or your use of TolipAI shall be resolved by binding arbitration under the American Arbitration Association Commercial Rules. Arbitration shall take place in the State of Florida. You expressly waive any right to participate in a class action lawsuit or class-wide arbitration against TolipAI.`,
    list: null,
    after: "Nothing in this section prevents either party from seeking injunctive relief for intellectual property disputes.",
  },
  {
    id: "general",
    title: "9. General Terms",
    content: null,
    list: [
      "These Terms are governed by the laws of the State of Florida.",
      "We may update these Terms at any time with notice via email or in-app notification. Continued use constitutes acceptance.",
      "TolipAI reserves the right to suspend or terminate accounts for violations of these Terms.",
      "If any provision is found unenforceable, the remaining provisions remain in full effect.",
    ],
    after: null,
  },
];

export default function ToS() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="max-w-3xl mx-auto px-4 py-16">

        {/* Back link */}
        <Link href="/login">
          <a className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-10">
            <ArrowLeft className="w-4 h-4" />
            Back to TolipAI
          </a>
        </Link>

        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
              <Shield className="w-5 h-5 text-violet-400" />
            </div>
            <span className="text-xs font-semibold tracking-widest uppercase text-violet-400">Legal</span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">Terms of Service</h1>
          <p className="text-slate-400 text-sm">
            <strong className="text-slate-300">TolipAI LLC</strong> · Last updated: {LAST_UPDATED}<br />
            By accessing or using the TolipAI platform, you agree to be bound by these Terms of Service.
            If you do not agree, you may not use the platform.
          </p>

          {/* Jump links */}
          <div className="mt-6 flex flex-wrap gap-2">
            {SECTIONS.map(s => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/4 text-slate-400 hover:text-white hover:border-white/20 transition"
              >
                {s.title.split(". ")[1]}
              </a>
            ))}
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-10">
          {SECTIONS.map(section => (
            <section key={section.id} id={section.id} className="scroll-mt-8">
              <h2 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-white/8">
                {section.title}
              </h2>

              {section.content && (
                <p className={`text-slate-300 text-sm leading-relaxed ${section.list ? "mb-3" : ""} ${section.title.includes("6.") ? "font-mono text-xs tracking-wide uppercase" : ""}`}>
                  {section.content}
                </p>
              )}

              {section.list && (
                <ul className="space-y-2 mb-3">
                  {section.list.map((item, i) => (
                    <li key={i} className={`flex items-start gap-2.5 text-sm text-slate-300 ${section.title.includes("6.") ? "font-mono text-xs uppercase" : ""}`}>
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {section.after && (
                <p className="text-slate-400 text-sm italic leading-relaxed mt-3">
                  {section.after}
                </p>
              )}
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/8 text-center space-y-2">
          <p className="text-sm text-slate-400">
            Questions about these Terms?{" "}
            <a href="mailto:legal@tolipai.com" className="text-violet-400 hover:text-violet-300 underline underline-offset-2">
              legal@tolipai.com
            </a>
          </p>
          <p className="text-xs text-slate-700">
            TolipAI LLC · info@tolipai.com · Real estate wholesaling CRM platform
          </p>
        </div>
      </div>
    </div>
  );
}
