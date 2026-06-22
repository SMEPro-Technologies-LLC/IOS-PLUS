export type UcoPartition = {
  id: string;
  name: string;
  sector: string;
  schemaName: string;
  tables: readonly string[];
  createdAt: string;
  updatedAt: string;
};

export type RetrievalQuery = {
  partitionId: string;
  tableName: string;
  columns: readonly string[];
  filters: Record<string, unknown>;
  orderBy?: readonly string[];
  limit: number;
  offset: number;
};

export type RetrievalResult = {
  query: RetrievalQuery;
  rows: readonly Record<string, unknown>[];
  totalCount: number;
  durationMs: number;
  executedAt: string;
};

export type SectorAwareConfig = {
  sector: string;
  partitions: readonly UcoPartition[];
  defaultSchema: string;
  routingRules: Record<string, string>;
  cacheTTLSeconds: number;
};
