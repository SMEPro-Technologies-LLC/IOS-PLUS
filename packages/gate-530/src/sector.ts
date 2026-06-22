import { ComplianceDimension, PolicyRule } from './config.js';

export class SectorRegistry {
  private sectors = new Map<string, PolicyRule[]>();
  private readonly defaultSector = 'general';

  constructor() {
    this.registerSector('general', []);
    this.registerSector('healthcare', []);
    this.registerSector('finance', []);
    this.registerSector('education', []);
    this.registerSector('energy', []);
    this.registerSector('government', []);
  }

  getSectorRules(sector: string): PolicyRule[] {
    return this.sectors.get(sector) ?? this.sectors.get(this.defaultSector) ?? [];
  }

  getDefaultSector(): string {
    return this.defaultSector;
  }

  validateSector(sector: string): boolean {
    return this.sectors.has(sector);
  }

  registerSector(sector: string, rules: PolicyRule[]): void {
    this.sectors.set(sector, rules);
  }

  getSectors(): string[] {
    return Array.from(this.sectors.keys());
  }

  getSectorDimensions(sector: string): ComplianceDimension[] {
    const rules = this.getSectorRules(sector);
    const dims = new Set<ComplianceDimension>();
    for (const rule of rules) {
      dims.add(rule.dimension);
    }
    return Array.from(dims);
  }
}
