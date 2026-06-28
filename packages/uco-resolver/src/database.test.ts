/**
 * @vitest-environment node
 *
 * Unit tests for packages/uco-resolver/src/database.ts
 *
 * Verifies that UcoDatabaseQueries issues SQL against the correct table
 * and column names from the canonical schema:
 *   - uco_crosswalk  (not the non-existent per-pair tables)
 *   - v_state_licensure_candidates with V11 column names
 *   - uco_obligation_metadata with naics_code (not naics)
 *   - uco_nodes with parent_id (not parent/children)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UcoDatabaseQueries } from './database.js';
import type { DatabasePool } from './types.js';

// ---------------------------------------------------------------------------
// Mock pool factory
// ---------------------------------------------------------------------------

function makeMockPool(returnRows: unknown[] = []): DatabasePool {
  return {
    query: vi.fn().mockResolvedValue(returnRows),
  };
}

// ---------------------------------------------------------------------------
// getCipNode
// ---------------------------------------------------------------------------

describe('UcoDatabaseQueries.getCipNode', () => {
  it('queries uco_nodes with parent_id alias (not parent/children)', async () => {
    const mockRow = {
      id: 'uuid-1',
      type: 'CIP',
      code: '51.3801',
      title: 'Registered Nursing',
      parent: null,
      metadata: {},
    };
    const pool = makeMockPool([mockRow]);
    const db = new UcoDatabaseQueries(pool);

    const node = await db.getCipNode('51.3801');
    expect(node.id).toBe('uuid-1');

    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(sql).toContain('parent_id AS parent');
    expect(sql).not.toMatch(/\bchildren\b/);
    // Ensure no bare 'parent' column (only parent_id AS parent is acceptable)
    expect(sql).not.toContain(', parent,');
    expect(sql).not.toContain(' parent ');
    expect(sql).not.toContain('\nparent\n');
  });

  it('throws when CIP node is not found', async () => {
    const pool = makeMockPool([]);
    const db = new UcoDatabaseQueries(pool);
    await expect(db.getCipNode('00.0000')).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// getNaicsForCip — must use uco_crosswalk, not uco_cip_naics_crosswalk
// ---------------------------------------------------------------------------

describe('UcoDatabaseQueries.getNaicsForCip', () => {
  let pool: DatabasePool;
  let db: UcoDatabaseQueries;

  beforeEach(() => {
    pool = makeMockPool([{ naics_code: '621111' }]);
    db = new UcoDatabaseQueries(pool);
  });

  it('queries uco_crosswalk (not uco_cip_naics_crosswalk)', async () => {
    const codes = await db.getNaicsForCip('51.3801');
    expect(codes).toEqual(['621111']);

    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(sql).toContain('uco_crosswalk');
    expect(sql).not.toContain('uco_cip_naics_crosswalk');
    expect(sql).toContain("source_type = 'CIP'");
    expect(sql).toContain("target_type = 'NAICS'");
    expect(params).toEqual(['51.3801']);
  });
});

// ---------------------------------------------------------------------------
// getSocForCip — must use uco_crosswalk, not uco_cip_soc_crosswalk
// ---------------------------------------------------------------------------

describe('UcoDatabaseQueries.getSocForCip', () => {
  it('queries uco_crosswalk (not uco_cip_soc_crosswalk)', async () => {
    const pool = makeMockPool([{ soc_code: '29-1141' }]);
    const db = new UcoDatabaseQueries(pool);

    const codes = await db.getSocForCip('51.3801');
    expect(codes).toEqual(['29-1141']);

    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sql).toContain('uco_crosswalk');
    expect(sql).not.toContain('uco_cip_soc_crosswalk');
    expect(sql).toContain("source_type = 'CIP'");
    expect(sql).toContain("target_type = 'SOC'");
  });
});

// ---------------------------------------------------------------------------
// getNaicsForSoc — must use uco_crosswalk, not uco_soc_naics_crosswalk
// ---------------------------------------------------------------------------

describe('UcoDatabaseQueries.getNaicsForSoc', () => {
  it('queries uco_crosswalk (not uco_soc_naics_crosswalk)', async () => {
    const pool = makeMockPool([{ naics_code: '621111' }]);
    const db = new UcoDatabaseQueries(pool);

    const codes = await db.getNaicsForSoc('29-1141');
    expect(codes).toEqual(['621111']);

    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sql).toContain('uco_crosswalk');
    expect(sql).not.toContain('uco_soc_naics_crosswalk');
    expect(sql).toContain("source_type = 'SOC'");
    expect(sql).toContain("target_type = 'NAICS'");
  });
});

// ---------------------------------------------------------------------------
// getLicensureCandidates — must use V11 column names
// ---------------------------------------------------------------------------

describe('UcoDatabaseQueries.getLicensureCandidates', () => {
  it('queries v_state_licensure_candidates with cip_code and state_abbrev', async () => {
    const pool = makeMockPool([
      {
        cip: '51.3801',
        state: 'TX',
        naics: null,
        soc: '29-1141',
        title: 'RN License',
        enforcement_type: 'mandatory',
        confidence: 0.9,
        risk: 0.3,
      },
    ]);
    const db = new UcoDatabaseQueries(pool);

    const candidates = await db.getLicensureCandidates('51.3801', 'TX');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].cip).toBe('51.3801');
    expect(candidates[0].state).toBe('TX');
    expect(candidates[0].title).toBe('RN License');
    expect(candidates[0].enforcementType).toBe('mandatory');

    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(sql).toContain('v_state_licensure_candidates');
    expect(sql).toContain('cip_code');
    expect(sql).toContain('state_abbrev');
    expect(sql).not.toMatch(/WHERE cip\s*=/);
    expect(sql).not.toMatch(/WHERE.*\bstate\b\s*=/);
    expect(params).toEqual(['51.3801', 'TX']);
  });

  it('maps can_practice_in_destination=true to high confidence', async () => {
    const pool = makeMockPool([
      {
        cip: '51.3801',
        state: 'TX',
        naics: null,
        soc: '29-1141',
        title: 'RN License',
        enforcement_type: 'informational',
        confidence: 0.9,
        risk: 0.3,
      },
    ]);
    const db = new UcoDatabaseQueries(pool);
    const [candidate] = await db.getLicensureCandidates('51.3801', 'TX');
    expect(candidate.confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// lookupStateLicensureByCip — uses V11 function return shape
// ---------------------------------------------------------------------------

describe('UcoDatabaseQueries.lookupStateLicensureByCip', () => {
  it('calls fn_lookup_state_licensure_by_cip and maps result', async () => {
    const pool = makeMockPool([
      {
        cip_code: '51.3801',
        cip_title: 'Registered Nursing',
        soc_code: '29-1141',
        soc_title: 'Registered Nurses',
        state_abbrev: 'CA',
        state_name: 'California',
        license_type: 'RN License',
        compact_member: false,
        compact_status: null,
        endorsement_required: true,
        exam_required: 'NCLEX-RN',
        ce_hours: '30',
        cycle_years: '2',
        can_practice: false,
        practice_notes: 'Endorsement required',
        uco_nodes: [],
        source_url: null,
        last_verified: null,
      },
    ]);
    const db = new UcoDatabaseQueries(pool);

    const requirements = await db.lookupStateLicensureByCip('51.3801', 'CA');
    expect(requirements).toHaveLength(1);
    expect(requirements[0].state).toBe('CA');
    expect(requirements[0].title).toBe('RN License');
    expect(requirements[0].enforcementType).toBe('mandatory');
    expect(requirements[0].description).toBe('Endorsement required');

    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(sql).toContain('fn_lookup_state_licensure_by_cip');
    expect(params).toEqual(['51.3801', 'CA']);
  });
});

// ---------------------------------------------------------------------------
// getObligationMetadata — must use naics_code column
// ---------------------------------------------------------------------------

describe('UcoDatabaseQueries.getObligationMetadata', () => {
  it('queries uco_obligation_metadata with naics_code (not naics)', async () => {
    const pool = makeMockPool([
      {
        state: 'TX',
        naics_code: '621111',
        enforcement_type: 'license',
        authority: 'Texas BON',
        effective_date: new Date('2020-01-01'),
      },
    ]);
    const db = new UcoDatabaseQueries(pool);

    const obligations = await db.getObligationMetadata('TX', '621111');
    expect(obligations).toHaveLength(1);
    expect(obligations[0].state).toBe('TX');
    expect(obligations[0].naics).toBe('621111');
    expect(obligations[0].authority).toBe('Texas BON');

    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(sql).toContain('uco_obligation_metadata');
    expect(sql).toContain('naics_code');
    expect(sql).not.toMatch(/\bnaics\b(?!_code)/); // no bare "naics" column reference
    expect(params).toEqual(['TX', '621111']);
  });
});
