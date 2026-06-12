# Merge Plan — UCO Migrations & Moonshot Stack Triage

**Tracking issue:** [#13](https://github.com/SMEPro-Technologies-LLC/IOS-PLUS/issues/13)
**Last verified against GitHub API:** 2026-06-12

This document codifies the merge order, dependency graph, and cleanup checklist for the
currently open pull requests so the repository can return to a clean merge state.
Execute the steps top-to-bottom; each step lists its verification gate.

---

## 1. Current state (verified)

| PR | Title | State | Base branch | Depends on |
|----|-------|-------|-------------|------------|
| [#4](https://github.com/SMEPro-Technologies-LLC/IOS-PLUS/pull/4) | UCO workbook ingestion pipeline + obligation metadata (V8 migration) | open, **draft** | `main` | — |
| [#5](https://github.com/SMEPro-Technologies-LLC/IOS-PLUS/pull/5) | UCO amendments intake unit (V9 migration move + webhook receiver + smoke runbook update) | open, ready | `main` | **#4** (hard) |
| [#6](https://github.com/SMEPro-Technologies-LLC/IOS-PLUS/pull/6) | UCO amendments intake unit: V9 placement + Firecrawl receiver + smoke/runbook updates | open, **draft** | `main` | **#4** (hard); duplicates #5 |
| [#8](https://github.com/SMEPro-Technologies-LLC/IOS-PLUS/pull/8) | Deterministic audit harness, scoped coverage gates, governance scaffolding | open, **draft** | `main` | — (independent) |
| [#9](https://github.com/SMEPro-Technologies-LLC/IOS-PLUS/pull/9) | Harden IOS+ state preservation and backpressure (Moonshot Phase 1) | open, **draft** | `main` | — |
| [#10](https://github.com/SMEPro-Technologies-LLC/IOS-PLUS/pull/10) | Phase 2 Moonshot executable verification harness (flag-gated) | open, ready | `main` | re-evaluate after #9 |
| [#12](https://github.com/SMEPro-Technologies-LLC/IOS-PLUS/pull/12) | Preserve quarantined context on tenant mismatch; close inflight leaks | open, **draft** | `copilot/harden-ios-state-preservation` (PR #9's branch) | **#9** (stacked) |

Repository facts backing the dependency claims:

- `db/migrations/` currently contains V1–V7 only. PR #4 introduces
  `V8__uco_obligation_metadata.sql`; PRs #5/#6 move `V9__uco_amendments.sql` from the
  repo root into `db/migrations/`.
- Flyway runs with `outOfOrder=false`. If V9 reaches `main` before V8, Flyway records
  V9 as the schema-history high-water mark and **silently skips V8** when it later
  lands (no immediate error), leaving `uco_obligation_metadata` absent. This is why
  the #4 → (#5 or #6) order is a hard requirement.
- PR #12 targets PR #9's head branch (`copilot/harden-ios-state-preservation`), so it
  is a stacked PR and must be retargeted/rebased onto `main` after #9 merges.

---

## 2. Merge order

```
#4 (V8) ──► #5 (V9, keep) ──► [close #6 as duplicate]
#8 (independent — land when CI + review pass)
#9 (Phase 1) ──► #12 (rebase onto main) ──► #10 (re-evaluate, rebase, re-run CI)
```

1. **Merge PR #4 first.** It contains the V8 DB migration and ingestion pipeline that
   both #5 and #6 require. Mark it ready for review, assign reviewers, and ensure CI
   passes before merging.
2. **Reconcile #5 vs #6 — keep #5.** #5 is non-draft and ready; #6 is a draft with
   near-identical scope (same V9 move, same Firecrawl receiver semantics, same
   Runbook V9 row). Diff the two branches; if #6 contains any unique required commits,
   cherry-pick them into #5's branch first. Then close #6 with a comment pointing to
   #5 and this plan.
3. **Merge #5 after #4 is on `main`.** Rebase #5 onto `main` post-#4 so the
   V8 → V9 ordering is preserved in the Flyway schema history.
4. **Land #8 independently.** It does not block, and is not blocked by, the UCO or
   Moonshot work. Confirm readiness with CI and reviewers, then merge whenever green.
5. **Merge #9 (Phase 1), then #12.** Once #9 is on `main`, retarget #12 to `main`,
   rebase it, and re-run CI. If #12 has accumulated unrelated changes, split it into
   a smaller focused PR before merging.
6. **Re-evaluate #10 (Phase 2) after #9 merges.** If #10 depends on Phase 1 behavior,
   rebase onto `main` and re-run CI before merging.

---

## 3. Cleanup checklist

- [ ] **Action A** — Prioritize PR #4: mark ready for review, assign reviewers
      (suggested: @cosudm + domain owners), confirm CI green, merge.
- [ ] **Action B** — Compare #5 and #6; port any unique commits from #6 into #5;
      close #6 with an explanatory comment; merge #5 after #4.
- [ ] **Action C** — After #9 merges, retarget and rebase #12 onto `main`; split out
      unrelated changes into a focused PR if needed.
- [ ] **Action D** — Before merging any migration PR, run CI plus the smoke checks for
      the V8 → V9 ordering on a disposable compose stack per the PRs' runbooks
      (see `Runbook.md` §5 smoke checks and `docs/db_rollback_playbook.md`).
- [ ] **Action E** *(optional)* — Create a temporary `merge-plan` / `triage` label and
      apply it to #4, #5, #6, #8, #9, #10, #12 to track progress.
- [ ] **Follow-up** — Post a short smoke-run checklist comment on #4 and #5 confirming
      the runbook items are satisfied before merge.

---

## 4. Migration-ordering smoke check (Action D detail)

On a disposable stack, verify Flyway applies V8 before V9 and that both objects exist:

```bash
docker compose up -d cosplus-db
docker compose run --rm flyway migrate
docker compose exec cosplus-db psql -U cos_admin -d cosplus -c \
  "SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank;"
docker compose exec cosplus-db psql -U cos_admin -d cosplus -c \
  "\dt uco_obligation_metadata; \dt uco_amendments;"
```

Expected: schema history shows V8 then V9, both `success = true`, and both tables
present. If V9 appears without V8, **stop** — do not merge; rebase the V9 PR onto a
`main` that already contains V8.

---

## 5. Non-goals

- No destructive actions (force-pushes, branch deletions, history rewrites) are part
  of this plan.
- This document coordinates human merge steps; it does not change runtime behavior.
  Remove or archive it once all checklist items are complete and issue #13 is closed.
