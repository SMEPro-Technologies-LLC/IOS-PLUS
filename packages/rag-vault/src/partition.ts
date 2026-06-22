import {
  UcoPartition,
  PartitionStrategy,
  ComplianceLevel,
  Actor,
  RetrievalQuery,
} from './types.js';

const DEFAULT_PARTITIONS: UcoPartition[] = [
  {
    id: 'general',
    name: 'General Knowledge',
    sectors: ['general'],
    complianceLevel: 'public',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'healthcare_phi',
    name: 'Healthcare PHI',
    sectors: ['healthcare'],
    complianceLevel: 'regulated',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'financial_pii',
    name: 'Financial PII',
    sectors: ['finance'],
    complianceLevel: 'regulated',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'education_records',
    name: 'Education Records',
    sectors: ['education'],
    complianceLevel: 'confidential',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'regulatory_compliance',
    name: 'Regulatory Compliance',
    sectors: ['government', 'general'],
    complianceLevel: 'restricted',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'operational_security',
    name: 'Operational Security',
    sectors: ['government', 'energy'],
    complianceLevel: 'confidential',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
];

export type { PartitionStrategy };

export class UcoPartitionManager {
  private partitions: Map<string, UcoPartition> = new Map();
  private strategy: PartitionStrategy;

  constructor(strategy: PartitionStrategy = 'uco') {
    this.strategy = strategy;
    for (const p of DEFAULT_PARTITIONS) {
      this.partitions.set(p.id, { ...p });
    }
  }

  registerPartition(
    id: string,
    name: string,
    sectors: string[],
    complianceLevel: ComplianceLevel,
    description?: string,
    parentPartitionId?: string
  ): void {
    if (this.partitions.has(id)) {
      throw new Error(`Partition "${id}" is already registered`);
    }

    const now = new Date();
    const partition: UcoPartition = {
      id,
      name,
      sectors,
      complianceLevel,
      createdAt: now,
      updatedAt: now,
      description,
      parentPartitionId,
      childPartitionIds: [],
    };

    this.partitions.set(id, partition);

    if (parentPartitionId) {
      const parent = this.partitions.get(parentPartitionId);
      if (parent) {
        parent.childPartitionIds = parent.childPartitionIds ?? [];
        parent.childPartitionIds.push(id);
      }
    }
  }

  getPartition(id: string): UcoPartition {
    const partition = this.partitions.get(id);
    if (!partition) {
      throw new Error(`Partition "${id}" not found`);
    }
    return { ...partition };
  }

  getPartitionsForSector(sector: string): UcoPartition[] {
    return Array.from(this.partitions.values()).filter((p) =>
      p.sectors.includes(sector)
    );
  }

  getPartitionForQuery(query: RetrievalQuery): UcoPartition {
    // Direct partition override
    if (query.partition) {
      return this.getPartition(query.partition);
    }

    // Sector-based inference
    if (query.sector) {
      const sectorPartitions = this.getPartitionsForSector(query.sector);
      if (sectorPartitions.length > 0) {
        // Return the most specific (highest compliance level) partition
        const complianceOrder: ComplianceLevel[] = [
          'public',
          'internal',
          'restricted',
          'confidential',
          'regulated',
        ];
        return sectorPartitions.sort(
          (a, b) =>
            complianceOrder.indexOf(b.complianceLevel) -
            complianceOrder.indexOf(a.complianceLevel)
        )[0];
      }
    }

    // Actor-based inference
    if (query.actorId) {
      // In a real system, we'd look up the actor and infer from their roles.
      // Fallback to general partition.
      return this.getPartition('general');
    }

    // Default fallback
    return this.getPartition('general');
  }

  validateAccess(partition: UcoPartition | string, actor: Actor): boolean {
    const p =
      typeof partition === 'string' ? this.getPartition(partition) : partition;

    if (!p) return false;

    // Check explicit partition access
    if (actor.partitionAccess.includes(p.id)) return true;
    if (p.parentPartitionId && actor.partitionAccess.includes(p.parentPartitionId)) return true;

    // Check sector overlap
    const sectorOverlap = p.sectors.some((s) => actor.sectors.includes(s));
    if (!sectorOverlap) return false;

    // Check clearance level
    const clearanceOrder: ComplianceLevel[] = [
      'public',
      'internal',
      'restricted',
      'confidential',
      'regulated',
    ];
    const actorClearance = clearanceOrder.indexOf(actor.clearanceLevel);
    const requiredClearance = clearanceOrder.indexOf(p.complianceLevel);

    return actorClearance >= requiredClearance;
  }

  getAllPartitions(): UcoPartition[] {
    return Array.from(this.partitions.values()).map((p) => ({ ...p }));
  }

  getStrategy(): PartitionStrategy {
    return this.strategy;
  }
}

export type { UcoPartition, ComplianceLevel };
