/**
 * Wave 1 MVP — Entry Point
 * Wires configuration, database, auth, and starts the HTTP API server
 * @module api-index
 */

import dotenv from 'dotenv';
import { getApiServerConfig, validateApiServerConfig } from './api-config.js';
import { ApiDatabase } from './api-db.js';
import { ApiAuth } from './api-auth.js';
import { Gate530ApiServer } from './api-server.js';

// Load environment variables from .env if present
dotenv.config();

async function main(): Promise<void> {
  console.log('[Gate530Api] Starting Wave 1 MVP...');

  const config = getApiServerConfig();
  const validation = validateApiServerConfig(config);
  if (!validation.valid) {
    console.error('[Gate530Api] Configuration errors:', validation.errors.join(', '));
    process.exit(1);
  }

  console.log('[Gate530Api] Config loaded — port:', config.port, 'host:', config.host);

  // Initialize database
  const db = new ApiDatabase(config.database);
  try {
    await db.connect();
    console.log('[Gate530Api] Database connected');
  } catch (error) {
    console.error('[Gate530Api] Database connection failed:', error instanceof Error ? error.message : String(error));
    // Continue — /ready will report unhealthy, but server starts for debug
  }

  // Initialize auth
  const auth = new ApiAuth(config.jwt);
  console.log('[Gate530Api] Auth initialized — issuer:', config.jwt.issuer);

  // Initialize and start server
  const server = new Gate530ApiServer(config, db, auth);

  server.listen(() => {
    console.log(`[Gate530Api] Server listening on http://${config.host}:${config.port}`);
    console.log('[Gate530Api] Endpoints:');
    console.log('  POST /v1/evaluate  — Evaluate compliance decision');
    console.log('  GET  /v1/evidence/:id — Retrieve evidence by request ID');
    console.log('  GET  /health       — Liveness probe');
    console.log('  GET  /ready        — Readiness probe with DB check');
    console.log('  GET  /metrics      — Prometheus metrics');
    console.log('  POST /admin/rules  — Create policy rule (admin)');
    console.log('  DELETE /admin/rules/:id — Delete policy rule (admin)');
    console.log('  GET  /admin/audit  — Query audit events (admin)');
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Gate530Api] Received ${signal}, shutting down gracefully...`);
    await server.close();
    await db.disconnect();
    console.log('[Gate530Api] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Gate530Api] Fatal error:', err);
  process.exit(1);
});
