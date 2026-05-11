import type { CrmTokenPayload } from "./routes/crm/middleware";

declare global {
  namespace Express {
    interface Request {
      crmUser?: CrmTokenPayload;
    }
  }
}
