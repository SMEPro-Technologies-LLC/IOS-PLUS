-- ============================================================
-- IOS+ COS+ Database — V6 Seed Crosswalk
-- Flyway migration: V6__seed_crosswalk.sql
-- Populates code_crosswalk mappings for local testing
-- ============================================================

INSERT INTO code_crosswalk (code_system, source_code, target_system, target_code, confidence, notes) VALUES
  ('CIP', '11.0101', 'NAICS', '5415', 1.000, 'Computer and Information Sciences to IT Systems Design'),
  ('SOC', '15-1211', 'NAICS', '5415', 1.000, 'Computer Systems Analysts to IT Systems Design'),
  ('SIC', '7373', 'NAICS', '5415', 1.000, 'Computer Integrated Systems Design to IT Systems Design');
