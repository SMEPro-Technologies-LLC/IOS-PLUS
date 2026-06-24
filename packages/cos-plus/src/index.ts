export * from './types.js';
export * from './connection.js';
export {
  getAuditTableName,
  getAuditArchiveTableName,
  createAuditTable,
  createAuditArchiveTable,
  insertAuditEvent,
  getAuditTrail,
  getAuditCount,
  verifyWormIntegrity,
  getAuditRetentionPolicy,
  pruneAuditEvents,
} from './audit.js';
export {
  getWormTriggerNames,
  enforceWorm,
  verifyWormStatus,
  createWormTable,
  removeWorm,
  WormEnforcer,
} from './worm.js';
export {
  getEvidenceTableName,
  createEvidenceTable,
  storeEvidenceRecord,
  getEvidenceByRequestId,
  getEvidenceById,
  verifyEvidenceChain,
  searchEvidence,
  searchEvidenceCount,
} from './evidence-store.js';
export {
  createVectorTable,
  insertVector,
  searchSimilar,
  deleteVector,
  getVectorById,
  searchVectorContent,
} from './vector-store.js';
export {
  createMigrationTable,
  getMigrationStatus,
  runMigrations,
  verifyMigrationChecksum,
  getPendingMigrations,
} from './migrations.js';
export {
  applyGrants,
  verifyGrants,
  getGrantsForRole,
  getGrantsForTable,
  revokeAllGrants,
} from './grants.js';
export {
  checkTableExists,
  checkColumnExists,
  checkConstraintExists,
  checkTriggerExists,
  checkIndexExists,
  checkExtensionExists,
  verifyInvariants,
  InvariantVerifier,
} from './invariant.js';
