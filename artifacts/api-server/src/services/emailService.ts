import { logger } from "../lib/logger";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) return false;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "TolipAI CRM", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
        textContent: opts.text,
      }),
    });
    return res.ok;
  } catch (err) {
    logger.error({ err }, "[emailService] Failed to send email");
    return false;
  }
}

export function buildNewLeadEmail(opts: {
  userName: string;
  address: string;
  leadId: number;
  campaignName: string;
  submittedBy: string;
}): string {
  const userName = escapeHtml(opts.userName);
  const address = escapeHtml(opts.address);
  const campaignName = escapeHtml(opts.campaignName);
  const submittedBy = escapeHtml(opts.submittedBy);
  const leadId = opts.leadId;
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #7367F0 0%, #28C76F 100%); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">TolipAI CRM</h1>
        <p style="color: rgba(255,255,255,0.75); margin: 4px 0 0;">New Lead Notification</p>
      </div>
      <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 16px;">Hello <strong>${userName}</strong>,</p>
        <p style="margin: 0 0 24px;">A new lead has been added to your <strong>${campaignName}</strong> campaign by <strong>${submittedBy}</strong>.</p>
        <div style="background: white; border: 1px solid #e5e7eb; border-left: 4px solid #7367F0; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
          <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280;">Property Address</p>
          <p style="margin: 0; font-size: 18px; font-weight: 600;">${address}</p>
        </div>
        <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">A follow-up task has been automatically created. Log in to review the lead and take action.</p>
        <a href="https://tolipai.com/crm/leads/${leadId}"
           style="display: inline-block; background: #7367F0; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">
          View Lead in TolipAI CRM
        </a>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="margin: 0; font-size: 12px; color: #9ea8ae;">Tolip Group LLC &bull; <a href="https://tolipai.com" style="color: #7367F0;">tolipai.com</a> &bull; Automated notification from TolipAI CRM</p>
      </div>
    </div>
  `;
}

// ── Onboarding Email Sequence ─────────────────────────────────────────────────

export function buildWelcomeOnboardingEmail(opts: {
  customerName: string;
  campaignName: string;
  loginUrl: string;
  email: string;
  tempPassword: string;
}): string {
  const name = escapeHtml(opts.customerName);
  const campaign = escapeHtml(opts.campaignName);
  const loginUrl = escapeHtml(opts.loginUrl);
  const email = escapeHtml(opts.email);
  const pw = escapeHtml(opts.tempPassword);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #D4AF37 0%, #B8860B 100%); padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #0a0e1a; margin: 0; font-size: 26px; font-weight: 800;">Welcome to TolipAI</h1>
        <p style="color: rgba(10,14,26,0.7); margin: 6px 0 0; font-size: 15px;">Your real estate acquisition infrastructure is live.</p>
      </div>
      <div style="background: #f9fafb; padding: 36px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 20px; font-size: 16px;">Hi <strong>${name}</strong>,</p>
        <p style="margin: 0 0 24px; font-size: 15px; color: #374151;">Your workspace <strong>${campaign}</strong> is ready. Below are your login credentials — please save them securely.</p>
        <div style="background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid #D4AF37; border-radius: 8px; padding: 20px; margin: 0 0 28px; font-family: monospace;">
          <p style="margin: 0 0 8px;"><strong>Login URL:</strong> <a href="${loginUrl}" style="color: #D4AF37;">${loginUrl}</a></p>
          <p style="margin: 0 0 8px;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 0;"><strong>Temp Password:</strong> <code style="background:#f3f4f6; padding: 2px 6px; border-radius: 4px;">${pw}</code></p>
        </div>
        <p style="margin: 0 0 16px; font-size: 14px; color: #6b7280;">Change your password immediately from account settings after first login.</p>
        <a href="${loginUrl}" style="display: inline-block; background: #D4AF37; color: #0a0e1a; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; margin-bottom: 28px;">Log In to Your CRM →</a>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0 0 20px;" />
        <p style="margin: 0 0 8px; font-size: 13px; color: #9ea8ae;"><strong>What happens next:</strong></p>
        <ul style="margin: 0 0 20px; padding-left: 18px; color: #6b7280; font-size: 13px; line-height: 1.8;">
          <li>Tomorrow: Quick-start guide for setting up your first campaign</li>
          <li>Day 3: Twilio dialer + AI SMS sequence walkthrough</li>
          <li>Day 7: Check-in from our team — how can we optimize your pipeline?</li>
        </ul>
        <p style="margin: 0; font-size: 12px; color: #9ea8ae;">Tolip Group LLC &bull; <a href="https://tolipai.com" style="color: #D4AF37;">tolipai.com</a> &bull; Reply to this email for support</p>
      </div>
    </div>
  `;
}

export function buildOnboardingDay1Email(opts: { customerName: string; loginUrl: string; campaignName: string }): string {
  const name = escapeHtml(opts.customerName);
  const loginUrl = escapeHtml(opts.loginUrl);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #7367F0 0%, #D4AF37 100%); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 22px;">Day 1 — Your Quick-Start Checklist</h1>
      </div>
      <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 20px;">Hi <strong>${name}</strong> — let's get your pipeline running today.</p>
        <p style="font-weight: 600; margin: 0 0 12px;">3 things to do in your first 24 hours:</p>
        <ol style="margin: 0 0 24px; padding-left: 20px; line-height: 2; color: #374151;">
          <li><strong>Add your first lead</strong> — paste an address from any list into the CRM and watch the AI score it instantly.</li>
          <li><strong>Configure your Twilio number</strong> — go to Settings → Twilio and enter your Account SID, Auth Token, and number.</li>
          <li><strong>Enable AI SMS follow-up</strong> — in Campaign Settings, flip on "AI SMS Auto-Reply" and customize the tone.</li>
        </ol>
        <a href="${loginUrl}" style="display: inline-block; background: #7367F0; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open My CRM →</a>
        <p style="margin: 24px 0 0; font-size: 12px; color: #9ea8ae;">Tolip Group LLC &bull; Reply with any questions</p>
      </div>
    </div>
  `;
}

export function buildOnboardingDay3Email(opts: { customerName: string; loginUrl: string }): string {
  const name = escapeHtml(opts.customerName);
  const loginUrl = escapeHtml(opts.loginUrl);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #28C76F 0%, #7367F0 100%); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 22px;">Day 3 — Activate Your AI Dialer</h1>
      </div>
      <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 20px;">Hi <strong>${name}</strong>,</p>
        <p style="margin: 0 0 20px; color: #374151;">Most TolipAI clients make their first offer within 72 hours of enabling the dialer. Here's how to unlock it:</p>
        <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
          <p style="margin: 0 0 10px; font-weight: 600;">🔥 Power Dialer</p>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">Go to <strong>Dialer → Power Dialer</strong>. Set your lead filters, click Start Session, and work through your list hands-free. AI coaching scores every call automatically.</p>
        </div>
        <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
          <p style="margin: 0 0 10px; font-weight: 600;">📱 AI SMS Sequences</p>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">Go to <strong>Sequences</strong> and create a 5-step follow-up. The AI personalizes each message based on lead status and response history.</p>
        </div>
        <a href="${loginUrl}" style="display: inline-block; background: #28C76F; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">Start Calling →</a>
        <p style="margin: 24px 0 0; font-size: 12px; color: #9ea8ae;">Tolip Group LLC &bull; Reply to this email for support</p>
      </div>
    </div>
  `;
}

export function buildOnboardingDay7Email(opts: { customerName: string; loginUrl: string }): string {
  const name = escapeHtml(opts.customerName);
  const loginUrl = escapeHtml(opts.loginUrl);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #D4AF37 0%, #28C76F 100%); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #0a0e1a; margin: 0; font-size: 22px;">Week 1 Check-In — How's It Going?</h1>
      </div>
      <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 20px;">Hi <strong>${name}</strong>,</p>
        <p style="margin: 0 0 20px; color: #374151;">You've had the platform for a week now. We want to make sure you're getting results. Here's what the top performers are doing at day 7:</p>
        <ul style="margin: 0 0 24px; padding-left: 20px; line-height: 2; color: #374151;">
          <li>50+ leads in the pipeline with at least 3 statuses populated</li>
          <li>AI SMS enabled with a customized personality for their market</li>
          <li>First deal scored using ARV + repair estimator</li>
          <li>At least one sequence actively running</li>
        </ul>
        <p style="margin: 0 0 24px; color: #374151;">If you haven't hit these marks yet — <strong>reply to this email</strong> and we'll personally walk you through setup. That's included in your subscription.</p>
        <a href="${loginUrl}/analytics" style="display: inline-block; background: #D4AF37; color: #0a0e1a; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700;">View My Analytics →</a>
        <p style="margin: 24px 0 0; font-size: 12px; color: #9ea8ae;">Tolip Group LLC &bull; Reply directly to this email — we read every response.</p>
      </div>
    </div>
  `;
}

export function buildOnboardingDay14Email(opts: { customerName: string; loginUrl: string }): string {
  const name = escapeHtml(opts.customerName);
  const loginUrl = escapeHtml(opts.loginUrl);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #0a0e1a 0%, #7367F0 100%); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #D4AF37; margin: 0; font-size: 22px;">2 Weeks In — Let's Optimize</h1>
      </div>
      <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 20px;">Hi <strong>${name}</strong>,</p>
        <p style="margin: 0 0 20px; color: #374151;">Two weeks in — your pipeline data is now meaningful. Here are three advanced features to unlock more deals this month:</p>
        <div style="display: flex; flex-direction: column; gap: 16px; margin: 0 0 24px;">
          <div style="background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid #D4AF37; border-radius: 8px; padding: 16px;">
            <p style="margin: 0 0 4px; font-weight: 600;">📊 Cash Buyer Match</p>
            <p style="margin: 0; color: #6b7280; font-size: 14px;">On any lead detail page, open the Cash Buyer Match panel. TolipAI cross-references your deal with our buyer database and ranks the best buyers by purchase history and market.</p>
          </div>
          <div style="background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid #7367F0; border-radius: 8px; padding: 16px;">
            <p style="margin: 0 0 4px; font-weight: 600;">🛰️ Satellite Property Analysis</p>
            <p style="margin: 0; color: #6b7280; font-size: 14px;">Use the Distressed Lead Generator to flag properties via satellite image AI before you even knock on the door.</p>
          </div>
          <div style="background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid #28C76F; border-radius: 8px; padding: 16px;">
            <p style="margin: 0 0 4px; font-weight: 600;">📞 Voicemail Drop</p>
            <p style="margin: 0; color: #6b7280; font-size: 14px;">In the BrowserDialer, hit the voicemail icon to drop a pre-recorded message without waiting for the beep. Works with your Power Dialer sessions.</p>
          </div>
        </div>
        <a href="${loginUrl}" style="display: inline-block; background: #7367F0; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">Explore Advanced Features →</a>
        <p style="margin: 24px 0 0; font-size: 12px; color: #9ea8ae;">Tolip Group LLC &bull; Questions? Reply to this email or book a call at <a href="https://calendly.com/tolipai/demo" style="color: #7367F0;">calendly.com/tolipai/demo</a></p>
      </div>
    </div>
  `;
}

export function buildTaskReminderEmail(opts: {
  userName: string;
  taskTitle: string;
  address: string | null;
  dueDate: string;
  leadId: number | null;
}): string {
  const userName = escapeHtml(opts.userName);
  const taskTitle = escapeHtml(opts.taskTitle);
  const address = opts.address ? escapeHtml(opts.address) : null;
  const dueDate = escapeHtml(opts.dueDate);
  const leadId = opts.leadId;
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #7367F0 0%, #28C76F 100%); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">TolipAI CRM</h1>
        <p style="color: rgba(255,255,255,0.75); margin: 4px 0 0;">Task Reminder</p>
      </div>
      <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 16px;">Hello <strong>${userName}</strong>,</p>
        <p style="margin: 0 0 24px;">You have a task due soon:</p>
        <div style="background: white; border: 1px solid #e5e7eb; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
          <p style="margin: 0 0 8px; font-weight: 600; font-size: 16px;">${taskTitle}</p>
          ${address ? `<p style="margin: 4px 0; color: #6b7280; font-size: 14px;">📍 ${address}</p>` : ""}
          <p style="margin: 4px 0; color: #f59e0b; font-size: 14px; font-weight: 600;">⏰ Due: ${dueDate}</p>
        </div>
        ${leadId ? `<a href="https://tolipai.com/crm/leads/${leadId}" style="display: inline-block; background: #7367F0; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Lead</a>` : ""}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="margin: 0; font-size: 12px; color: #9ea8ae;">Tolip Group LLC &bull; Automated reminder from TolipAI CRM</p>
      </div>
    </div>
  `;
}
