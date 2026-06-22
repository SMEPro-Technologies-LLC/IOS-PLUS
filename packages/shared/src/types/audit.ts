export type AuditEvent = {
  id: string;
  tableName: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  recordId: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  actorId: string;
  actorType: string;
  timestamp: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type WormStatus = {
  tableName: string;
  enabled: boolean;
  lockedAt: string | null;
  retentionDays: number;
  immutable: boolean;
};

export type AuditRetentionPolicy = {
  tableName: string;
  retentionDays: number;
  archiveAfterDays: number;
  wormEnabled: boolean;
  lastArchivedAt?: string;
};
