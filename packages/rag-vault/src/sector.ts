import {
  RetrievalResult,
  SectorType,
  ComplianceLevel,
} from './types.js';

const SECTORS: SectorType[] = [
  'general',
  'healthcare',
  'finance',
  'education',
  'energy',
  'government',
];

export type { SectorType, ComplianceLevel };

export class SectorKnowledgeMap {
  private sectorToKnowledge: Map<string, Set<string>> = new Map();
  private knowledgeToSectors: Map<string, Set<string>> = new Map();
  private relevanceScores: Map<string, Map<string, number>> = new Map();

  constructor() {
    for (const sector of SECTORS) {
      this.sectorToKnowledge.set(sector, new Set());
    }
  }

  mapKnowledge(sector: string, knowledgeId: string, relevanceScore: number = 1.0): void {
    if (!SECTORS.includes(sector as SectorType)) {
      throw new Error(`Unknown sector: "${sector}". Valid sectors: ${SECTORS.join(', ')}`);
    }

    // Sector -> Knowledge
    const sectorSet = this.sectorToKnowledge.get(sector);
    if (sectorSet) {
      sectorSet.add(knowledgeId);
    }

    // Knowledge -> Sector
    if (!this.knowledgeToSectors.has(knowledgeId)) {
      this.knowledgeToSectors.set(knowledgeId, new Set());
    }
    this.knowledgeToSectors.get(knowledgeId)!.add(sector);

    // Relevance scores
    if (!this.relevanceScores.has(sector)) {
      this.relevanceScores.set(sector, new Map());
    }
    this.relevanceScores.get(sector)!.set(knowledgeId, relevanceScore);
  }

  getKnowledgeForSector(sector: string): string[] {
    const set = this.sectorToKnowledge.get(sector);
    return set ? Array.from(set) : [];
  }

  getSectorsForKnowledge(knowledgeId: string): string[] {
    const set = this.knowledgeToSectors.get(knowledgeId);
    return set ? Array.from(set) : [];
  }

  validateSectorKnowledge(sector: string, knowledgeId: string): boolean {
    const set = this.sectorToKnowledge.get(sector);
    return set ? set.has(knowledgeId) : false;
  }

  getRelevanceScore(sector: string, knowledgeId: string): number {
    return this.relevanceScores.get(sector)?.get(knowledgeId) ?? 0;
  }

  getAllSectors(): SectorType[] {
    return [...SECTORS];
  }
}

export class SectorAwareFilter {
  filter(results: RetrievalResult, sector: string): RetrievalResult {
    const validDocs = results.documents.filter((rd) => {
      const tags = rd.document.sectorTags;
      if (tags.length === 0) return true; // Untagged documents are universally valid
      return tags.includes(sector) || tags.includes('general');
    });

    return {
      ...results,
      documents: validDocs.map((rd, i) => ({ ...rd, rank: i + 1 })),
      totalCount: validDocs.length,
      metadata: {
        ...results.metadata,
        sectorFilter: true,
      },
    };
  }

  rank(results: RetrievalResult, sector: string): RetrievalResult {
    const scored = results.documents.map((rd) => {
      const tags = rd.document.sectorTags;
      let sectorScore = 0;

      if (tags.includes(sector)) {
        sectorScore = 1.0;
      } else if (tags.includes('general')) {
        sectorScore = 0.5;
      } else if (tags.length === 0) {
        sectorScore = 0.3;
      } else {
        sectorScore = 0.0;
      }

      // Combine with existing score
      const combinedScore = rd.score * 0.7 + sectorScore * 0.3;
      return { ...rd, score: combinedScore, sectorScore };
    });

    const sorted = scored.sort((a, b) => b.score - a.score);

    return {
      ...results,
      documents: sorted.map((rd, i) => ({ ...rd, rank: i + 1 })),
      metadata: {
        ...results.metadata,
        sectorFilter: true,
      },
    };
  }
}
