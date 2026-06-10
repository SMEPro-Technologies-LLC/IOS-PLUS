# Seed validation report

Generated: 2026-06-10
Source workbook: `SMEPro_COS_Universal_Compliance_Decoding_Matrix.xlsx`

**Nodes parsed:** 350  |  **valid:** 350  |  **rejected:** 0

## Per-sheet counts

- 01 – ENERGY: 54
- 02 – HEALTHCARE: 36
- 03 – FINANCE & BANKING: 30
- 04 – FOOD, DRUG & AG: 16
- 05 – MFG & TRANSPORT: 27
- 06 – TELECOM, ENV & DEFENSE: 20
- 07 – INSURANCE: 35
- 08 – REAL ESTATE & CONSTR: 10
- 09 – AGRICULTURE: 8
- 10 – MINING: 5
- 11 – WHOLESALE & RETAIL: 15
- 12 – PROFESSIONAL SVCS: 13
- 13 – EDUCATION: 10
- 14 – ARTS & ENTERTAINMENT: 9
- 15 – ACCOMMODATION & FOOD: 10
- 16 – ADMIN & WASTE SVCS: 9
- 17 – OTHER SERVICES: 9
- 18 – PUBLIC ADMIN: 9
- 19 – MGMT OF COMPANIES: 6
- CROSS-CUTTING REGS: 19

## Policy action distribution

- APPROVE: 108
- BLOCK: 192
- ESCALATE: 50

## Partitions (20)

- accommodation_food: 10
- admin_waste_svcs: 9
- agriculture: 8
- arts_entertainment: 9
- education: 10
- energy: 54
- finance_banking: 30
- food_drug_ag: 16
- healthcare: 36
- insurance: 35
- mfg_transport: 27
- mgmt_of_companies: 6
- mining: 5
- other_services: 9
- professional_svcs: 13
- public_admin: 9
- real_estate_constr: 10
- telecom_env_defense: 20
- wholesale_retail: 15
- xsc: 19

## Patches applied

- UCO-ENR-1037: Source row column shift (SIC in NAICS slot, cascading); crosswalk realigned, compliance chain rebuilt.

## Rejected rows

- none

## Warnings

- none

## Firecrawl monitors

- 137 payloads emitted (risk_weight>=8, Federal, CFR-citable); 10 high-risk federal nodes skipped (no parseable CFR citation — USC/state citations need manual page selection).
