import { EmbeddingConfig } from './types.js';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  private dimensions: number;
  private seed: number;

  constructor(config: Pick<EmbeddingConfig, 'dimensions'>) {
    this.dimensions = config.dimensions ?? 384;
    this.seed = 0;
  }

  async embed(text: string): Promise<number[]> {
    return this.generateVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generateVector(t)));
  }

  /**
   * Deterministic mock embedding generator.
   * Uses a simple hash-based PRNG so the same text always produces the same vector.
   */
  private generateVector(text: string): number[] {
    const hash = this.fnv1a(text);
    const vec: number[] = [];
    let state = hash;

    for (let i = 0; i < this.dimensions; i++) {
      state = this.lcg(state);
      // Normalize to [-1, 1] and then L2-normalize
      vec.push(state / 2147483647);
    }

    return this.l2Normalize(vec);
  }

  /** FNV-1a 32-bit hash for deterministic seeding */
  private fnv1a(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  /** Linear congruential generator for deterministic pseudo-random values */
  private lcg(seed: number): number {
    return (seed * 1103515245 + 12345) & 0x7fffffff;
  }

  /** L2-normalize a vector */
  private l2Normalize(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vec;
    return vec.map((v) => v / norm);
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private config: EmbeddingConfig;
  private dimensions: number;

  constructor(config: EmbeddingConfig) {
    this.config = config;
    this.dimensions = config.dimensions ?? 1536;

    if (!config.apiKey) {
      throw new Error('OpenAIEmbeddingProvider requires an API key in the embedding config');
    }
  }

  async embed(_text: string): Promise<number[]> {
    // Stub: no actual API call. Production code would call OpenAI embeddings API here.
    throw new Error(
      'OpenAIEmbeddingProvider.embed() is not yet implemented. ' +
        'Configure with a valid OpenAI API key and implement the fetch call to https://api.openai.com/v1/embeddings'
    );
  }

  async embedBatch(_texts: string[]): Promise<number[][]> {
    // Stub: no actual API call.
    throw new Error(
      'OpenAIEmbeddingProvider.embedBatch() is not yet implemented. ' +
        'Configure with a valid OpenAI API key and implement the batch fetch call to https://api.openai.com/v1/embeddings'
    );
  }

  getModel(): string {
    return this.config.model ?? 'text-embedding-3-small';
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

export type { EmbeddingConfig };
export type { EmbeddingProvider };
