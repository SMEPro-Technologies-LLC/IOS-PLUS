import type { ExecutionContext, NAICSProfile } from "@ios-plus/shared";
import type { Gate530EvaluationResult } from "@ios-plus/gate-530";

export interface ParkedContext {
  ctx: ExecutionContext;
  naicsProfile: NAICSProfile;
  requestHash: string;
  gateResult: Gate530EvaluationResult;
  createdAt: number;
}

export class QuarantineStore {
  private store = new Map<string, ParkedContext>();

  park(quarantineId: string, parked: ParkedContext, ttlMs = 24 * 60 * 60 * 1000): void {
    this.store.set(quarantineId, parked);
    setTimeout(() => {
      this.store.delete(quarantineId);
    }, ttlMs);
  }

  retrieve(quarantineId: string): ParkedContext | undefined {
    return this.store.get(quarantineId);
  }

  remove(quarantineId: string): void {
    this.store.delete(quarantineId);
  }

  list(): string[] {
    return Array.from(this.store.keys());
  }
}

export const quarantineStore = new QuarantineStore();
