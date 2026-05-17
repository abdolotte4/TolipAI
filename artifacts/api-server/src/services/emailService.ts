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
        <p style="margin: 0; font-size: 12px; color: #9ea8ae;">TolipAI LLC &bull; <a href="https://tolipai.com" style="color: #7367F0;">tolipai.com</a> &bull; Automated notification from TolipAI CRM</p>
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
        <p style="margin: 0; font-size: 12px; color: #9ea8ae;">TolipAI LLC &bull; Automated reminder from TolipAI CRM</p>
      </div>
    </div>
  `;
}
