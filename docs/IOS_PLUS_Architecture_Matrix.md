# IOS-PLUS Architecture Matrix

## Purpose

Define a repo-ready architecture matrix that aligns each priority intelligence area to enabling technology, key dependencies, infrastructure requirements, governance touchpoints, and expected token-usage profile within the IOS-PLUS / iOSLENS platform.

## Platform framing

- iOSLENS is the governance brain.
- The Universal Compliance Decoding Matrix is the authoritative governance schema.
- The PostgreSQL engine on the Lamar University VM is the on-prem governance substrate.
- Microsoft is the enforcement body.
- IOS-PLUS is the implementation platform for governance core, MCP exposure, projection, and supporting intelligence services.

## Matrix

| Intelligence Area | Objective | Primary Systems | Core Tech Pattern | Key Dependencies | Infrastructure Requirements | Governance Considerations | Token Usage Profile |
|---|---|---|---|---|---|---|---|
| Predictive Student Success | Identify predictive markers for persistence and retention using Blackboard and Banner data | Blackboard Ultra, Banner | Analytics pipeline, feature extraction, governed retrieval, optional narrative generation | Blackboard access, Banner student data, identity context, audit/evidence store | Secure source connectivity, analytics compute, derived feature storage, monitoring | FERPA sensitivity, fairness, explainability, intervention-role visibility | Medium |
| Transcript Evaluation | Speed admission processing and improve consistency of transcript crosswalk/intake | Transcript sources, Banner, catalogs, academic policy records | Transcript parsing, normalization, equivalency rules, governed reviewer workflow | Transcript ingestion, Banner course/program data, articulation/policy mappings, audit/evidence | Document ingestion pipeline, parsing runtime, normalized data store, reviewer workflow support | Consistency, explainability, escalation to human review, student-record quality | Medium |
| Accreditation Review | Identify gaps and shortfalls across SACSCOC, ABET, AACSB, and related standards | Standards corpus, institutional evidence, outcomes, assessment records | Retrieval/indexing, standards mapping, evidence gap analysis, narrative review support | Standards documents, evidence repositories, outcomes data, assessment artifacts | Document store, search/indexing, secure evidence repository, reporting runtime | Standards versioning, reviewer traceability, evidence integrity | High |
| Course Outcome Alignment | Compare approved course outcomes with assessments, syllabi, and Blackboard data | Approved outcomes, syllabi, Blackboard Ultra, curriculum records | Syllabus parsing, assessment extraction, semantic/rule comparison, alignment reporting | Outcome registry, syllabus corpus, Blackboard content/assessment metadata, curriculum mappings | Extraction/indexing pipeline, metadata store, comparison compute | Faculty visibility, evidence fidelity, academic-governance boundaries | Medium/High |
| Faculty Workload Analysis | Estimate grading-assistance needs in large online courses based on assessment volume and cadence | Blackboard Ultra, Banner teaching assignments, workload rules | Metadata analytics, workload feature extraction, staffing recommendation support | LMS assessment metadata, enrollment/section data, Banner assignment data, workload rules | Analytics runtime, LMS extraction pipeline, section/enrollment feed, monitoring | Faculty transparency, fairness, staffing-use governance | Low/Medium |

## Shared architectural dependencies

- Governance core must evaluate actor, system, domain, and action context before exposing capability outputs.
- MCP endpoints must return rationale and traceability where appropriate.
- Audit/evidence services must record decision, source domains, and reviewer overrides.
- Microsoft projection should reflect governance classifications where downstream enforcement or identity posture is relevant.

## Recommended implementation order

1. Transcript Evaluation
2. Faculty Workload Analysis
3. Predictive Student Success
4. Course Outcome Alignment
5. Accreditation Review
