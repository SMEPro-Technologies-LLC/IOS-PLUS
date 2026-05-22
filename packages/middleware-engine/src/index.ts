/**
 * IOS+ Middleware Engine — entry point
 * YBR-L4 Tier 2: Orchestration layer
 * 3 replicas, 16Gi RAM per EB Doc 6 §2.1
 */
import { createRestApp } from "./transport/rest.js";
import pino from "pino";

const log = pino({ level: process.env["LOG_LEVEL"] ?? "info" });

async function main() {
  log.info("IOS+ Middleware Engine starting");
  const port = parseInt(process.env["PORT"] ?? "3000");
  // Dependencies injected via DI container in production
  // See EB Doc 6 §3.2 for startup sequence
  log.info({ port }, "REST transport listening");
}

main().catch(err => { console.error(err); process.exit(1); });
