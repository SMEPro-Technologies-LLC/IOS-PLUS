# webhooks-receiver.patch.md
# Receiver changes required alongside V9__uco_amendments.sql
#
# Four targeted edits to the webhook module. The schema fixes [F1]-[F4]
# live in V9; these are their code-side counterparts plus the two
# receiver-only findings (verdict-change supersession, auth-bound reviewer).

---

## 1. Supersede-then-insert, and only when the new row carries the obligation

Replaces the insert-first block inside the transaction. Two changes:
the supersede UPDATE moves BEFORE the INSERT (correct serialization
against uq_amend_open_per_node under READ COMMITTED — a blocked UPDATE
re-evaluates its predicate after the lock holder commits, so it sees and
supersedes the other transaction's row), and supersession is now
conditional on the incoming row being `pending_review` — a detection on
a node whose verdict has since relaxed to APPROVE must NOT close out a
BLOCK-era review obligation.

```ts
await client.query("BEGIN");

// Supersede FIRST, and only if this detection itself carries a review
// obligation. (acknowledged rows never supersede pending ones — the
// stricter historical obligation survives until a human resolves it.)
let supersededCount = 0;
if (d.initialStatus === "pending_review") {
  const sup = await client.query(
    `UPDATE uco_amendments SET status = 'superseded'
      WHERE uco_node_id = $1 AND status = 'pending_review'`,
    [ucoNodeId]);
  supersededCount = sup.rowCount ?? 0;
}

const ins = await client.query(
  `INSERT INTO uco_amendments (
     uco_node_id, monitor_id, event_id, source_url, change_detected_at,
     payload, payload_sha256, diff_summary,
     node_policy_action, node_risk_weight,
     review_required, review_priority, review_sla_hours, status
   ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
   ON CONFLICT (payload_sha256) DO NOTHING   -- scoped: see note below
   RETURNING amendment_id`,
  [/* unchanged parameter list */]);
```

Why the scoped conflict target matters: with `uq_amend_open_per_node` in
place, a bare `ON CONFLICT DO NOTHING` would swallow a pending-index
collision and report `"duplicate"` — silently dropping a real detection.
Scoped to `(payload_sha256)`, sha-dedup stays silent while an
open-per-node collision raises 23505 → handler returns 500 → Firecrawl
redelivers → the retry supersedes the now-committed row and inserts
cleanly. (With supersede-then-insert this path is rare; it exists only
for true same-instant races.)

Note: `ON CONFLICT (event_id)` cannot also be targeted in the same
statement — Postgres allows one arbiter. A redelivery with an identical
body hits the sha arbiter (intended). A re-sent event with a *modified*
body (same event_id, different bytes) will now raise on
idx_amend_event_id instead of being silently treated as a duplicate —
which is the correct behavior: that's not a redelivery, it's a payload
discrepancy you want to see in the error logs.

## 2. Duplicate response: no rollback churn

Unchanged logic, but with supersede-then-insert the duplicate path has
already superseded rows before discovering the dup. Move the dup check
to a pre-flight SELECT before BEGIN, or accept the (idempotent,
harmless) re-supersede. Pre-flight is cleaner:

```ts
const dup = await pool.query(
  "SELECT amendment_id FROM uco_amendments WHERE payload_sha256 = $1",
  [payloadSha256]);
if (dup.rows[0]) {
  MetricsRegistry.inc("ios_amendment_webhook_total", { result: "duplicate" });
  return res.status(200).json({ status: "duplicate", payload_sha256: payloadSha256 });
}
```

(The INSERT's ON CONFLICT remains as the race-proof backstop.)

## 3. Reviewer identity binds to the authenticated principal

`reviewed_by` must come from `requireAdminAuth`'s principal, not the
request body. Assuming the auth middleware attaches the identity
(adjust the property to whatever requireAdminAuth actually sets):

```ts
const principal = (req as any).adminPrincipal ?? (req as any).auth?.sub ?? null;
if (!principal) {
  return res.status(500).json({ error: "auth principal unavailable — cannot attribute review" });
}
const assertedBy = firstString(req.body?.reviewed_by);
// Authenticated identity is authoritative; asserted identity (if any)
// is recorded in notes for context, never as reviewed_by.
const reviewedBy = principal;
const notes = [req.body?.notes, assertedBy && assertedBy !== principal
  ? `(asserted reviewer: ${assertedBy})` : null].filter(Boolean).join(" ") || null;
```

With V9's [F2] write-once guard, this identity can never be rewritten
after the verdict lands.

## 4. Smoke test addendum

- Add a metadata-path case (node id ONLY in metadata, garbage name) so
  the deterministic path is exercised, not just the regex fallback:

```bash
BODY2='{"type":"monitor.page","id":"evt_test2","monitorId":"mon_test","timestamp":"2026-06-10T12:05:00Z","metadata":{"uco_node_id":"UCO-ENR-1029"},"data":{"url":"https://www.ecfr.gov/current/title-18/part-260","name":"renamed by someone in the dashboard","summary":"Second revision detected."}}'
# expect: 201, and the supersede counter on this response shows the
# evt_test1 row was closed (newest detection is operative).
```

- Run smoke tests ONLY against the disposable docker-compose stack:
  uco_amendments is WORM-protected — test rows are permanent in any
  shared database.
