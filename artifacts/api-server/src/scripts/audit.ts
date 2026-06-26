import { logger } from "../lib/logger";
import { getNextApiKey } from "../services/propertyApi";

export async function auditApiServer() {
  const results = {
    auth: { passed: 0, failed: 0, issues: [] as string[] },
    security: { passed: 0, failed: 0, issues: [] as string[] },
    dataQuality: { passed: 0, failed: 0, issues: [] as string[] },
    performance: { passed: 0, failed: 0, issues: [] as string[] },
  };

  logger.info("Starting API Server Audit...");

  // 1. Auth check
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    results.auth.passed++;
  } else {
    results.auth.failed++;
    results.auth.issues.push("JWT_SECRET is missing or too short");
  }

  // 2. Tools PIN check
  if (process.env.TOOLS_PIN) {
    results.auth.passed++;
  } else {
    results.auth.failed++;
    results.auth.issues.push("TOOLS_PIN is missing");
  }

  // 3. Database connection
  if (process.env.DATABASE_URL) {
    results.dataQuality.passed++;
  } else {
    results.dataQuality.failed++;
    results.dataQuality.issues.push("DATABASE_URL is missing");
  }

  // 4. External APIs
  const propertyKey = getNextApiKey();
  if (propertyKey) {
    results.performance.passed++;
  } else {
    results.performance.failed++;
    results.performance.issues.push("No PropertyAPI keys available");
  }

  if (process.env.SCRAPER_ENGINE_URL) {
    results.performance.passed++;
  } else {
    results.performance.failed++;
    results.performance.issues.push("SCRAPER_ENGINE_URL is missing");
  }

  logger.info({ results }, "API Server Audit Complete");
  return results;
}
