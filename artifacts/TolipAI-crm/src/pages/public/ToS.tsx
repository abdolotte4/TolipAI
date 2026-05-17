import { Link } from "wouter";
import { ArrowLeft, Shield } from "lucide-react";

const LAST_UPDATED = "May 15, 2026";
const EFFECTIVE_DATE = "May 15, 2026";

interface Section {
  id: string;
  title: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    body: (
      <>
        <p>
          These Terms of Service ("Terms") constitute a legally binding agreement between you ("User," "you," or "your") and TolipAI LLC ("TolipAI," "we," "us," or "our"), governing your access to and use of the TolipAI platform, including all software, services, tools, APIs, and related documentation (collectively, the "Service").
        </p>
        <p className="mt-3">
          By creating an account, clicking "I Agree," or otherwise accessing or using the Service, you represent that you have read, understood, and agree to be bound by these Terms and our Privacy Policy (incorporated herein by reference). If you do not agree to these Terms, you may not access or use the Service.
        </p>
        <p className="mt-3">
          If you are using the Service on behalf of an organization or entity, you represent and warrant that you have the authority to bind that organization to these Terms, and "you" refers collectively to you and that organization.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "2. Eligibility & Account Registration",
    body: (
      <>
        <p>To use the Service, you must:</p>
        <ul className="mt-3 space-y-2">
          {[
            "Be at least 18 years of age or the legal age of majority in your jurisdiction",
            "Have the legal capacity to enter into a binding contract",
            "Not be prohibited from using the Service under any applicable law",
            "Provide accurate, current, and complete registration information",
            "Maintain the security of your account credentials and promptly notify us of any unauthorized use",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4">
          You are solely responsible for all activity that occurs under your account. TolipAI reserves the right to refuse service, terminate accounts, or remove content at its sole discretion. You may not share your login credentials with third parties or allow multiple individuals to access the platform under a single user account unless expressly permitted by your subscription plan.
        </p>
      </>
    ),
  },
  {
    id: "license",
    title: "3. License Grant & Restrictions",
    body: (
      <>
        <p>
          Subject to your compliance with these Terms and timely payment of all applicable fees, TolipAI grants you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Service solely for your internal business purposes in connection with real estate acquisition and wholesaling activities.
        </p>
        <p className="mt-3">You may <strong className="text-white">not</strong>:</p>
        <ul className="mt-3 space-y-2">
          {[
            "Copy, modify, distribute, sell, resell, or sublicense any part of the Service",
            "Reverse engineer, decompile, or disassemble any portion of the Service",
            "Use the Service to build a competing product or service",
            "Scrape, crawl, or harvest data from the Service using automated means without written permission",
            "Use the Service in any manner that violates applicable law or these Terms",
            "Remove or obscure any proprietary notices, labels, or marks on the Service",
            "Attempt to gain unauthorized access to any portion of the Service or its related systems",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    id: "subscription",
    title: "4. Subscriptions, Billing & Payment",
    body: (
      <>
        <p>
          Access to certain features of the Service requires a paid subscription. By subscribing, you authorize TolipAI (or its payment processor) to charge your designated payment method on a recurring basis at the then-current subscription rate.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Billing Cycle</h3>
            <p className="text-sm text-slate-300">Subscriptions are billed monthly or annually in advance, as selected at signup. Your subscription automatically renews at the end of each billing period unless cancelled.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Price Changes</h3>
            <p className="text-sm text-slate-300">TolipAI reserves the right to modify pricing at any time. We will provide at least 30 days' advance notice of price changes via email or in-app notification. Continued use of the Service after the effective date constitutes acceptance of the new pricing.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Cancellation</h3>
            <p className="text-sm text-slate-300">You may cancel your subscription at any time through your account settings or by contacting support. Cancellation takes effect at the end of the current billing period. You will retain access to paid features until the period ends.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Refunds</h3>
            <p className="text-sm text-slate-300">All fees are non-refundable except as required by applicable law or as expressly stated in a separate written agreement. TolipAI may, at its sole discretion, provide credits or pro-rated refunds in cases of service outages exceeding 24 hours.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Taxes</h3>
            <p className="text-sm text-slate-300">You are responsible for all taxes, levies, or duties imposed by taxing authorities on your subscription fees, excluding taxes based on TolipAI's net income.</p>
          </div>
        </div>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "5. Acceptable Use Policy",
    body: (
      <>
        <p>You agree to use the Service only for lawful purposes and in a manner consistent with these Terms. Prohibited uses include, without limitation:</p>
        <ul className="mt-3 space-y-2">
          {[
            "Sending unsolicited commercial messages (spam) or contacting individuals on the National Do Not Call Registry without a valid exemption",
            "Violating the Telephone Consumer Protection Act (TCPA), Telemarketing Sales Rule (TSR), CAN-SPAM Act, or any state or local equivalent",
            "Using the platform for harassment, intimidation, threats, or discriminatory conduct",
            "Transmitting malware, viruses, or any other malicious code",
            "Attempting to interfere with or disrupt the integrity or performance of the Service",
            "Impersonating any person or entity, or falsely claiming an affiliation",
            "Using skip trace data for credit, employment, insurance, tenant screening, or any purpose regulated by the Fair Credit Reporting Act (FCRA)",
            "Violating any applicable local, state, national, or international law or regulation",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 italic text-slate-400 text-sm">
          TolipAI reserves the right to suspend or terminate your account immediately and without notice if we determine, in our sole discretion, that you have engaged in any prohibited use.
        </p>
      </>
    ),
  },
  {
    id: "ai-disclosure",
    title: "6. AI Voice Agent & Automated Communications",
    body: (
      <>
        <p>
          The Service includes AI-powered voice agent technology ("AI Agent") that may answer inbound calls and conduct outbound communication on your behalf. By enabling and deploying the AI Agent, you acknowledge and agree to the following:
        </p>
        <ul className="mt-3 space-y-2">
          {[
            "You are solely responsible for ensuring that all AI Agent communications comply with applicable law, including laws requiring disclosure that a caller is an AI or automated system (e.g., California Business & Professions Code §17941, and similar statutes in other jurisdictions).",
            "You must configure AI Agent scripts and personas that are accurate, non-deceptive, and compliant with FTC regulations prohibiting unfair or deceptive practices.",
            "You must not use the AI Agent to make calls to individuals who have requested not to be contacted, are on any applicable Do Not Call list, or have not provided required consent.",
            "TolipAI is not responsible for AI-generated content that violates applicable law, including content related to fair housing, discrimination, consumer protection, or telemarketing.",
            "AI Agent calls may be recorded subject to the call recording provisions below. You are responsible for obtaining all legally required consents prior to enabling recording.",
            "AI-generated transcripts and summaries are provided 'as-is' and may not be perfectly accurate. You should not rely on them as the sole basis for business decisions.",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    id: "recording",
    title: "7. Call Recording & TCPA Compliance",
    body: (
      <>
        <p>
          The Service provides call recording capabilities. By using these features, you represent and warrant that:
        </p>
        <ul className="mt-3 space-y-2">
          {[
            "You have obtained all legally required consents from all parties to a recorded call under applicable federal law (including 18 U.S.C. § 2511) and all applicable state laws (including two-party or all-party consent states such as California, Illinois, Pennsylvania, and others).",
            "You have implemented all required call disclosures and consent mechanisms for any automated or prerecorded messages sent using the Service.",
            "You maintain records of all consents obtained and will provide such records to TolipAI upon request.",
            "You will not use recorded calls in violation of applicable wiretapping, eavesdropping, or privacy laws.",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-300">
          TolipAI logs recording initiation events but does not independently verify consent. You assume all liability arising from the use of call recording features, including any TCPA fines, penalties, or litigation arising from your use of the platform.
        </p>
      </>
    ),
  },
  {
    id: "data",
    title: "8. Data, Skip Tracing & Privacy",
    body: (
      <>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Skip Trace Data</h3>
            <p className="text-sm text-slate-300">Property data and skip trace results ("Data") are provided for real estate acquisition purposes only. You may not use Data for any purpose regulated by the Fair Credit Reporting Act (FCRA), including credit, employment, insurance, tenant screening, or government licensing decisions. Data is licensed, not sold, and may not be resold, redistributed, or shared with third parties without TolipAI's prior written consent.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Your Data</h3>
            <p className="text-sm text-slate-300">You retain ownership of all data you upload or input into the Service ("User Data"). You grant TolipAI a non-exclusive, worldwide license to process and store User Data solely to provide and improve the Service. TolipAI will not sell your User Data to third parties.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Data Security</h3>
            <p className="text-sm text-slate-300">TolipAI implements industry-standard security measures to protect your data. However, no method of electronic storage is 100% secure, and TolipAI cannot guarantee absolute security. You are responsible for maintaining the security of your account credentials.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Data Retention</h3>
            <p className="text-sm text-slate-300">Upon termination of your account, TolipAI may retain your data for up to 90 days before deletion, unless a longer period is required by law. You may request export of your data prior to account termination.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Privacy Policy</h3>
            <p className="text-sm text-slate-300">Our collection and use of personal information is governed by our Privacy Policy, which is incorporated into these Terms by reference. By using the Service, you consent to the data practices described in our Privacy Policy.</p>
          </div>
        </div>
      </>
    ),
  },
  {
    id: "third-party",
    title: "9. Third-Party Services & Integrations",
    body: (
      <>
        <p>
          The Service integrates with third-party providers including, without limitation, Twilio (telephony), OpenAI (AI processing), Stripe (payments), ATTOM Data, Propwire, and others (collectively, "Third-Party Services"). By using integrations with Third-Party Services, you agree that:
        </p>
        <ul className="mt-3 space-y-2">
          {[
            "Your use of Third-Party Services is subject to each provider's own terms of service and privacy policies, which you are responsible for reviewing and accepting.",
            "TolipAI is not responsible for the availability, accuracy, or reliability of any Third-Party Services.",
            "Service outages or limitations caused by Third-Party Services do not entitle you to a refund or service credit except as expressly provided in these Terms.",
            "TolipAI may add, modify, or discontinue integrations with Third-Party Services at any time with reasonable notice.",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    id: "ip",
    title: "10. Intellectual Property",
    body: (
      <>
        <p>
          The Service and all content, features, and functionality therein — including but not limited to software, text, graphics, logos, icons, images, audio clips, and data compilations — are and will remain the exclusive property of TolipAI LLC and its licensors, protected by United States and international copyright, trademark, patent, trade secret, and other intellectual property laws.
        </p>
        <p className="mt-3">
          These Terms do not grant you any right, title, or interest in the Service or TolipAI's intellectual property, except for the limited license expressly granted in Section 3. The TolipAI name, logo, and all related product names are trademarks of TolipAI LLC. You may not use these marks without prior written permission.
        </p>
        <p className="mt-3">
          Any feedback, suggestions, or ideas you provide regarding the Service ("Feedback") may be used by TolipAI without restriction and without compensation to you. You hereby assign to TolipAI all rights in and to any Feedback.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "11. Service Availability & Modifications",
    body: (
      <>
        <p>
          TolipAI strives to maintain high availability of the Service but does not guarantee uninterrupted or error-free access. We reserve the right to:
        </p>
        <ul className="mt-3 space-y-2">
          {[
            "Perform scheduled or emergency maintenance that may temporarily interrupt service availability",
            "Modify, update, or discontinue any feature or aspect of the Service at any time with or without notice",
            "Impose usage limits or restrictions to maintain service quality for all users",
            "Update these Terms at any time; material changes will be communicated via email or in-app notification with at least 30 days' advance notice where practicable",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-300">
          Your continued use of the Service after any modification to these Terms constitutes acceptance of the updated Terms.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    title: "12. Termination & Suspension",
    body: (
      <>
        <p>
          <strong className="text-white">Termination by You:</strong> You may terminate your account at any time by contacting support or using the account cancellation feature. Termination does not entitle you to a refund of any prepaid fees.
        </p>
        <p className="mt-3">
          <strong className="text-white">Termination by TolipAI:</strong> TolipAI may suspend or terminate your access to the Service immediately and without prior notice if:
        </p>
        <ul className="mt-3 space-y-2">
          {[
            "You breach any provision of these Terms",
            "You fail to pay any fees when due",
            "TolipAI reasonably believes your use of the Service poses a legal, security, or reputational risk",
            "Required by applicable law or regulation",
            "TolipAI discontinues the Service",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-300">
          Upon termination, your license to use the Service immediately terminates. Sections 6, 7, 8, 10, 13, 14, 15, 16, and 17 of these Terms survive termination.
        </p>
      </>
    ),
  },
  {
    id: "disclaimer",
    title: "13. Disclaimer of Warranties",
    body: (
      <>
        <p className="font-mono text-xs text-slate-300 uppercase tracking-wide leading-relaxed">
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. TOLIPAI DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS. TOLIPAI DOES NOT WARRANT THE ACCURACY, COMPLETENESS, OR RELIABILITY OF ANY DATA, CONTENT, OR INFORMATION PROVIDED THROUGH THE SERVICE, INCLUDING SKIP TRACE DATA, AI-GENERATED CONTENT, PROPERTY VALUATIONS, OR MARKET ANALYSES.
        </p>
        <p className="mt-3 font-mono text-xs text-slate-300 uppercase tracking-wide leading-relaxed">
          SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OF IMPLIED WARRANTIES, SO THE ABOVE EXCLUSIONS MAY NOT APPLY TO YOU.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    title: "14. Limitation of Liability",
    body: (
      <>
        <p className="font-mono text-xs text-slate-300 uppercase tracking-wide leading-relaxed">
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL TOLIPAI, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, SUPPLIERS, OR LICENSORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES, INCLUDING WITHOUT LIMITATION LOSS OF PROFITS, LOSS OF DATA, LOSS OF GOODWILL, BUSINESS INTERRUPTION, OR COST OF SUBSTITUTE SERVICES, ARISING OUT OF OR IN CONNECTION WITH THESE TERMS OR YOUR USE OF THE SERVICE, EVEN IF TOLIPAI HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
        </p>
        <p className="mt-3 font-mono text-xs text-slate-300 uppercase tracking-wide leading-relaxed">
          IN NO EVENT SHALL TOLIPAI'S TOTAL CUMULATIVE LIABILITY TO YOU ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE EXCEED THE GREATER OF: (A) THE TOTAL FEES PAID BY YOU TO TOLIPAI IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO LIABILITY, OR (B) ONE HUNDRED DOLLARS ($100.00).
        </p>
        <p className="mt-3 text-sm text-slate-400 italic">
          Specific excluded liabilities include: TCPA fines or penalties arising from your use; data misuse by you or your users; third-party API outages (Twilio, OpenAI, ATTOM, Propwire, etc.); AI-generated content violations; and loss of leads, deals, or revenue from service interruptions.
        </p>
      </>
    ),
  },
  {
    id: "indemnification",
    title: "15. Indemnification",
    body: (
      <>
        <p>
          You agree to indemnify, defend, and hold harmless TolipAI LLC, its parent, subsidiaries, affiliates, officers, directors, employees, attorneys, agents, successors, and assigns from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to:
        </p>
        <ul className="mt-3 space-y-2">
          {[
            "Your use of or inability to use the Service",
            "Your contact lists, lead sources, and calling campaigns",
            "Your messaging content (SMS, email, AI voice, or any other communication channel)",
            "Your failure to obtain required consent from any individual prior to contacting them",
            "Your violation of any applicable law or regulation, including the TCPA, TSR, CAN-SPAM, or state equivalents",
            "Your misuse of skip trace data, property records, or any Data provided through the Service",
            "Your violation of any third party's rights, including privacy, publicity, intellectual property, or contractual rights",
            "Any claim by a third party arising from your use of AI Agent features",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-300">
          TolipAI reserves the right to assume exclusive control of any matter subject to indemnification, in which case you agree to cooperate with TolipAI in asserting any available defenses.
        </p>
      </>
    ),
  },
  {
    id: "arbitration",
    title: "16. Dispute Resolution & Arbitration",
    body: (
      <>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Informal Resolution</h3>
            <p className="text-sm text-slate-300">Before filing any formal legal action, the parties agree to attempt to resolve any dispute informally by contacting TolipAI at legal@tolipai.com. The parties will negotiate in good faith for a period of 30 days before proceeding to arbitration.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Binding Arbitration</h3>
            <p className="text-sm text-slate-300">Except as provided below, any dispute, claim, or controversy arising out of or relating to these Terms or your use of the Service shall be resolved by binding arbitration administered by the American Arbitration Association ("AAA") under its Commercial Arbitration Rules. The arbitration shall take place in Broward County, Florida, or, at the option of the consumer, via telephone or video conference.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Class Action Waiver</h3>
            <p className="text-sm text-slate-300 font-semibold uppercase text-[11px] tracking-wide">YOU AND TOLIPAI EXPRESSLY WAIVE ANY RIGHT TO PURSUE ANY CLASS ACTION LAWSUIT, CLASS-WIDE ARBITRATION, PRIVATE ATTORNEY GENERAL ACTION, OR ANY OTHER REPRESENTATIVE PROCEEDING. ALL DISPUTES MUST BE BROUGHT ON AN INDIVIDUAL BASIS ONLY.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Exceptions to Arbitration</h3>
            <p className="text-sm text-slate-300">Either party may seek injunctive or other equitable relief in any court of competent jurisdiction to prevent actual or threatened infringement, misappropriation, or violation of intellectual property rights. Small claims court disputes may also be resolved without arbitration.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Governing Law</h3>
            <p className="text-sm text-slate-300">These Terms shall be governed by and construed in accordance with the laws of the State of Florida, without regard to its conflict of law provisions. For any matters not subject to arbitration, the parties consent to exclusive jurisdiction and venue in the state and federal courts located in Broward County, Florida.</p>
          </div>
        </div>
      </>
    ),
  },
  {
    id: "general",
    title: "17. General Provisions",
    body: (
      <>
        <div className="space-y-3 text-sm text-slate-300">
          <p><strong className="text-white">Entire Agreement:</strong> These Terms, together with the Privacy Policy and any applicable Order Form or Subscription Agreement, constitute the entire agreement between you and TolipAI regarding the Service and supersede all prior agreements and understandings.</p>
          <p><strong className="text-white">Severability:</strong> If any provision of these Terms is found to be invalid, illegal, or unenforceable, the remaining provisions shall continue in full force and effect.</p>
          <p><strong className="text-white">Waiver:</strong> TolipAI's failure to enforce any right or provision of these Terms shall not constitute a waiver of such right or provision.</p>
          <p><strong className="text-white">Assignment:</strong> You may not assign or transfer any rights or obligations under these Terms without TolipAI's prior written consent. TolipAI may freely assign these Terms, including in connection with a merger, acquisition, or sale of assets.</p>
          <p><strong className="text-white">Force Majeure:</strong> TolipAI shall not be liable for any delay or failure to perform resulting from causes beyond its reasonable control, including natural disasters, acts of government, telecommunications failures, or cyberattacks.</p>
          <p><strong className="text-white">Notices:</strong> TolipAI may provide notices via email, in-app notification, or by posting to its website. Notices to TolipAI must be sent to legal@tolipai.com or by certified mail to TolipAI LLC, Florida.</p>
          <p><strong className="text-white">Updates to Terms:</strong> TolipAI reserves the right to update these Terms at any time. We will notify you of material changes with at least 30 days' notice. Continued use of the Service after the effective date of changes constitutes your acceptance.</p>
        </div>
      </>
    ),
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
          <p className="text-slate-400 text-sm leading-relaxed">
            <strong className="text-slate-300">TolipAI LLC</strong>
            <br />
            Effective Date: {EFFECTIVE_DATE}
            <br />
            Last Updated: {LAST_UPDATED}
            <br /><br />
            By accessing or using the TolipAI platform, you agree to be bound by these Terms of Service.
            If you do not agree, you may not access or use the platform.
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
        <div className="space-y-12">
          {SECTIONS.map(section => (
            <section key={section.id} id={section.id} className="scroll-mt-8">
              <h2 className="text-lg font-semibold text-white mb-4 pb-2 border-b border-white/8">
                {section.title}
              </h2>
              <div className="text-slate-300 text-sm leading-relaxed">
                {section.body}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/8 space-y-4">
          <div className="rounded-xl bg-violet-500/5 border border-violet-500/15 p-4">
            <p className="text-sm text-slate-300 leading-relaxed">
              <strong className="text-white">Questions or Legal Notices?</strong><br />
              For questions about these Terms, data requests, or to submit a legal notice, contact us at{" "}
              <a href="mailto:legal@tolipai.com" className="text-violet-400 hover:text-violet-300 underline underline-offset-2">
                legal@tolipai.com
              </a>
              {" "}or{" "}
              <a href="mailto:info@tolipai.com" className="text-violet-400 hover:text-violet-300 underline underline-offset-2">
                info@tolipai.com
              </a>
            </p>
          </div>
          <p className="text-xs text-slate-700 text-center">
            TolipAI LLC · State of Florida · Real Estate Wholesaling CRM Platform
            <br />
            © {new Date().getFullYear()} TolipAI LLC. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
