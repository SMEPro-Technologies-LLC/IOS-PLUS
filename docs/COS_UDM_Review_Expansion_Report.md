# COS+ UDM Review Expansion Report

## Executive Summary

This report documents the Universal Decoding Matrix (UDM) traversal implementation within the COS+ Database layer of the IOS+ platform, specifically supporting destination-state licensure determinations for higher education and healthcare compliance workflows.

## Universal Decoding Matrix (UDM) Overview

The UDM is a governed ontology that maps educational programs (CIP codes) to occupational classifications (SOC codes) to industry classifications (NAICS codes) to state-level regulatory obligations (licensure, certification, registration).

### Traversal Paths Implemented

```
Path 1 (Direct): CIP ──► NAICS ──► State Obligation
Path 2 (Two-hop): CIP ──► SOC ──► NAICS ──► State Obligation
```

### Ranked Result Criteria

Results are ranked by:

1. **Direct Match**: Direct CIP → NAICS mappings rank highest
2. **Confidence**: Higher confidence crosswalk scores rank higher
3. **Risk**: Lower risk scores (more certain obligations) rank higher

## Database Schema

### Core Tables

#### `uco_nodes`
Stores ontology nodes for CIP, NAICS, and SOC codes.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| type | VARCHAR(20) | Node type: CIP, NAICS, SOC |
| code | VARCHAR(20) | Standardized code |
| title | VARCHAR(500) | Human-readable title |
| description | TEXT | Extended description |
| parent_id | UUID | Parent node (hierarchical) |
| metadata | JSONB | Flexible metadata |
| created_at | TIMESTAMPTZ | Creation timestamp |

#### `uco_crosswalk`
Maps between ontology node types.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| source_type | VARCHAR(20) | Source node type |
| source_code | VARCHAR(20) | Source code |
| target_type | VARCHAR(20) | Target node type |
| target_code | VARCHAR(20) | Target code |
| match_type | VARCHAR(20) | Match classification |
| confidence | DECIMAL(3,2) | Confidence score (0.00-1.00) |
| created_at | TIMESTAMPTZ | Creation timestamp |

#### `uco_obligation_metadata`
State-level regulatory obligations.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| state | VARCHAR(2) | US state abbreviation |
| naics_code | VARCHAR(20) | NAICS code |
| soc_code | VARCHAR(20) | SOC code (optional) |
| enforcement_type | VARCHAR(50) | License/Certificate/Registration/Other |
| title | VARCHAR(500) | Obligation title |
| authority | VARCHAR(500) | Issuing authority |
| effective_date | DATE | When obligation became effective |
| expiration_date | DATE | When obligation expires (optional) |
| metadata | JSONB | Flexible metadata |
| created_at | TIMESTAMPTZ | Creation timestamp |

### Views

#### `v_state_licensure_candidates`

Derives licensure candidates by joining:

1. `uco_nodes` (CIP) → `uco_crosswalk` (CIP→NAICS) → `uco_nodes` (NAICS)
2. `uco_nodes` (CIP) → `uco_crosswalk` (CIP→SOC) → `uco_nodes` (SOC) → `uco_crosswalk` (SOC→NAICS) → `uco_nodes` (NAICS)
3. NAICS → `uco_obligation_metadata` (by state and naics_code)

Filters to `enforcement_type = 'License/Certificate'`.

Columns:
- `cip_code`, `cip_title`
- `naics_code`, `naics_title`
- `soc_code`, `soc_title` (nullable)
- `state`
- `enforcement_type`
- `obligation_title`
- `authority`
- `confidence`
- `risk_score`

### Functions

#### `fn_lookup_state_licensure_by_cip(student_cip TEXT, destination_state TEXT)`

Returns a ranked set of `LicensureRequirement` records.

**Algorithm:**

1. Lookup CIP node in `uco_nodes`
2. Find direct CIP → NAICS crosswalks
3. Find CIP → SOC → NAICS crosswalks (two-hop)
4. Union all NAICS codes found
5. Join to `uco_obligation_metadata` for destination_state
6. Filter to `enforcement_type = 'License/Certificate'`
7. Rank by: direct match first, confidence descending, risk ascending
8. Return as JSON array of licensure requirements

**Example:**

```sql
SELECT * FROM fn_lookup_state_licensure_by_cip('51.3801', 'CA');
```

Returns licensure requirements for a Nursing student (CIP 51.3801) looking to practice in California.

## Confidence and Risk Scoring

### Confidence Calculation

```
confidence = base_confidence × path_multiplier × recency_factor
```

Where:
- `base_confidence`: From crosswalk `confidence` column (0.00-1.00)
- `path_multiplier`: 1.0 for direct CIP→NAICS, 0.85 for CIP→SOC→NAICS
- `recency_factor`: Based on `effective_date` (newer = higher)

### Risk Scoring

```
risk_score = obligation_complexity × enforcement_strictness × reciprocity_factor
```

Where:
- `obligation_complexity`: Based on number of prerequisite requirements
- `enforcement_strictness`: 1.0 for mandatory licensure, 0.7 for certification, 0.4 for registration
- `reciprocity_factor`: 1.0 if no reciprocity agreements, 0.5 if reciprocity exists

## API Integration

The UDM traversal is exposed via the IOS+ middleware:

### Endpoint

```
GET /v1/compliance/licensure/state-lookup
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `student_cip` | string | Yes | CIP code (e.g., "51.3801") |
| `destination_state` | string | Yes | 2-letter state code (e.g., "CA") |

### Response

```json
{
  "request_id": "uuid",
  "student_cip": "51.3801",
  "destination_state": "CA",
  "results": [
    {
      "cip_code": "51.3801",
      "cip_title": "Registered Nursing/Registered Nurse",
      "naics_code": "621111",
      "naics_title": "Offices of Physicians",
      "soc_code": "29-1141",
      "soc_title": "Registered Nurses",
      "state": "CA",
      "enforcement_type": "License/Certificate",
      "obligation_title": "Registered Nurse License",
      "authority": "California Board of Registered Nursing",
      "confidence": 0.95,
      "risk_score": 0.30
    }
  ],
  "ranked_by": "direct_match, confidence, risk",
  "generated_at": "2026-01-15T10:30:00Z"
}
```

## Data Sources and Coverage

### CIP Codes
- Source: National Center for Education Statistics (NCES)
- Coverage: 2020 CIP taxonomy
- Update frequency: Annual

### SOC Codes
- Source: Bureau of Labor Statistics (BLS)
- Coverage: 2018 SOC taxonomy
- Update frequency: Every 10 years

### NAICS Codes
- Source: U.S. Census Bureau / OMB
- Coverage: 2022 NAICS taxonomy
- Update frequency: Every 5 years

### State Licensure Data
- Source: State licensing boards, NCSBN, FSBPT
- Coverage: All 50 states + DC
- Update frequency: Quarterly review

## Crosswalk Methodology

### CIP → NAICS Direct Mapping

Based on:
1. O*NET occupational preparation mapping
2. Employment outcomes by CIP (IPEDS/NCES)
3. Industry placement surveys

### CIP → SOC Mapping

Based on:
1. Standard CIP-SOC crosswalk (NCES)
2. O*NET educational requirements
3. Career pathway alignment

### SOC → NAICS Mapping

Based on:
1. BLS industry-occupation matrix
2. O*NET industry distribution data
3. Employment by industry and occupation

## Gap Analysis

### Known Limitations

1. **Temporal Coverage**: Crosswalks may not reflect rapid industry changes (e.g., AI-related occupations)
2. **Multi-State Licensure**: Compact nursing licenses and interstate reciprocity agreements require manual verification
3. **Emerging Professions**: New occupations may not yet have established CIP/SOC mappings
4. **Specialty Variations**: Healthcare specialties with state-specific scopes of practice

### Planned Expansions

1. **L5 Field Dictionary Integration**: Map UDM traversal to specific RRC and ONRR form fields
2. **Cross-Form Validation**: Ensure licensure determinations align with other compliance forms
3. **Temporal Tracking**: Track when licensure requirements change over time
4. **Reciprocity Engine**: Automated detection of interstate licensure compacts and reciprocity agreements

## Implementation Timeline

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Core CIP→NAICS→State traversal | ✅ Implemented |
| 2 | CIP→SOC→NAICS two-hop traversal | ✅ Implemented |
| 3 | v_state_licensure_candidates view | ✅ Implemented |
| 4 | fn_lookup_state_licensure_by_cip function | ✅ Implemented |
| 5 | API endpoint integration | ✅ Implemented |
| 6 | Confidence and risk scoring refinement | 🔄 In Progress |
| 7 | Multi-state reciprocity detection | 📋 Planned |
| 8 | L5 field dictionary alignment | 📋 Planned |
| 9 | Automated crosswalk validation | 📋 Planned |
| 10 | Real-time regulatory update ingestion | 📋 Future |

## Compliance Implications

The UDM licensure traversal supports several compliance requirements:

1. **State Authorization**: Ensuring educational programs meet state licensure prerequisites
2. **Gainful Employment**: Connecting program outcomes to licensure requirements
3. **Program Integrity**: Validating that advertised career outcomes align with actual licensure paths
4. **Student Disclosures**: Providing accurate licensure information to prospective students
5. **Audit Evidence**: Creating signed evidence of licensure determinations for regulatory review

## Audit Trail Integration

All licensure lookups are recorded in the COS+ audit trail:

```sql
INSERT INTO audit_events (table_name, operation, record_id, actor_id, actor_type, new_data)
VALUES ('licensure_lookup', 'SELECT', :request_id, :user_id, 'api_client', :result_json);
```

This creates an immutable record of:
- Who requested the licensure lookup
- What CIP and state were queried
- What results were returned
- When the lookup occurred

## References

- CIP 2020: https://nces.ed.gov/ipeds/cipcode/
- SOC 2018: https://www.bls.gov/soc/
- NAICS 2022: https://www.census.gov/naics/
- NCSBN: https://www.ncsbn.org/
- O*NET: https://www.onetonline.org/

## Contact

For questions about the UDM implementation or licensure data coverage, contact:
- Engineering: engineering@smeprotech.com
- Compliance: compliance@smeprotech.com
