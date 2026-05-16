import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

export function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: "Invalid query parameters",
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}

// ── Shared schemas ─────────────────────────────────────────────────────────────

export const twilioConfigSchema = z.object({
  accountSid: z.string().min(1, "Account SID is required").regex(/^AC/, "Account SID must start with 'AC'"),
  authToken: z.string().min(1, "Auth Token is required"),
  phoneNumber: z.string().optional().default(""),
  twilioEnabled: z.boolean().optional().default(true),
  apiKeySid: z.string().optional().default(""),
  apiKeySecret: z.string().optional().default(""),
  voiceAppSid: z.string().optional().default(""),
});

export const leadCreateSchema = z.object({
  sellerName: z.string().min(1, "Seller name is required").max(255),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  leadSource: z.string().max(100).optional().nullable(),
  propertyType: z.string().max(100).optional().nullable(),
  status: z.enum(["new", "contacted", "qualified", "under_contract", "closed", "dead"]).optional().default("new"),
  beds: z.number().int().min(0).max(100).optional().nullable(),
  baths: z.string().max(10).optional().nullable(),
  sqft: z.number().int().min(0).max(100000).optional().nullable(),
  condition: z.number().int().min(1).max(5).optional().nullable(),
  askingPrice: z.string().optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  assignedTo: z.number().int().positive().optional().nullable(),
  campaignId: z.number().int().positive().optional().nullable(),
});

export const taskCreateSchema = z.object({
  title: z.string().min(1, "Task title is required").max(500),
  description: z.string().max(5000).optional().nullable(),
  dueDate: z.string().datetime({ offset: true }).optional().nullable().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional().default("pending"),
  leadId: z.number().int().positive().optional().nullable(),
  assignedTo: z.number().int().positive().optional().nullable(),
});

export const smsSendSchema = z.object({
  to: z.string().min(7, "Phone number is required").max(30),
  body: z.string().min(1, "Message body is required").max(1600),
  leadId: z.number().int().positive().optional().nullable(),
});
