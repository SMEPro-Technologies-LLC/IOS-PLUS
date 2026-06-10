-- ============================================================
-- IOS+ COS+ Database — V9 UCO Amendments (regulatory change intake)
-- Flyway migration: V9__uco_amendments.sql
--   (V9, not V8: PR #4's V8__uco_obligation_metadata merges first.)
-- Firecrawl monitor.page → verified amendment record → review gate
-- → regenerate-and-commit seed (applied_at). SMEPro — Confidential
--
-- Changes vs. the reviewed draft (all four review findings folded in):
--   [F1] node_risk_weight CHECK widened to 1..10 (domain range, not
--        current-data coincidence) — prevents webhook poison-retry loop.
--   [F2] reviewer identity immutable once set (reviewed_by/reviewed_at
--        can never be rewritten, including on terminal rows).
--   [F3] partial unique index: at most ONE open pending_review amendment
--        per node. Receiver must (a) supersede-then-insert and
--        (b) scope idempotency to ON CONFLICT (payload_sha256) DO NOTHING
--        so a concurrency collision surfaces as an error (Firecrawl
--        retries) instead of being misreported as a duplicate.
--   [F4] amendment_id added to the immutable detection tuple.
-- ============================================================

CREATE TABLE uco_amendments (
  amendment_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  uco_node_id         TEXT        NOT NULL REFERENCES uco_nodes(uco_node_id),
  monitor_id          TEXT,                  -- Firecrawl monitor id
  event_id            TEXT,                  -- Firecrawl event id
  source_url          TEXT        NOT NULL,  -- eCFR page that changed
  change_detected_at  TIMESTAMPTZ NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload             JSONB       NOT NULL,  -- full signature-verified webhook body
  payload_sha256      TEXT        NOT NULL UNIQUE,  -- idempotency key (raw body hash)
  diff_summary        TEXT,                  -- LLM judge summary, if provided
  -- Snapshot of the node at detection time (matrix may move before review)
  node_policy_action  TEXT        NOT NULL CHECK (node_policy_action IN ('BLOCK','APPROVE','ESCALATE')),
  node_risk_weight    SMALLINT    NOT NULL CHECK (node_risk_weight BETWEEN 1 AND 10),  -- [F1]
  -- Review gate
  review_required     BOOLEAN     NOT NULL,
  review_priority     TEXT        NOT NULL CHECK (review_priority IN ('P0','P1','P2','P3')),
  review_sla_hours    INTEGER     NOT NULL DEFAULT 0,
  status              TEXT        NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review','acknowledged','approved','rejected','superseded')),
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  review_notes        TEXT,
  applied_at          TIMESTAMPTZ            -- stamped by regenerate-and-commit tooling
);

CREATE INDEX idx_amend_node     ON uco_amendments (uco_node_id);
CREATE INDEX idx_amend_pending  ON uco_amendments (review_priority, received_at) WHERE status = 'pending_review';
CREATE INDEX idx_amend_received ON uco_amendments (received_at);
CREATE UNIQUE INDEX idx_amend_event_id ON uco_amendments (event_id) WHERE event_id IS NOT NULL;

-- [F3] At most one OPEN review obligation per node. Concurrent detections
-- serialize here: the second insert blocks on the first, then errors; the
-- receiver's non-2xx response triggers a Firecrawl redelivery, which
-- supersedes the first row and inserts cleanly.
CREATE UNIQUE INDEX uq_amend_open_per_node
  ON uco_amendments (uco_node_id) WHERE status = 'pending_review';

-- ── transition guard ─────────────────────────────────────────
-- Detection record immutable; reviewer identity write-once; status machine:
--   pending_review → approved | rejected   (reviewer identity required)
--   pending_review | acknowledged → superseded
--   approved → applied_at stamp-once       (status unchanged)
--   rejected | superseded → terminal
CREATE OR REPLACE FUNCTION uco_amendment_transition_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- [F4] amendment_id included in the immutable tuple
  IF (NEW.amendment_id, NEW.uco_node_id, NEW.monitor_id, NEW.event_id, NEW.source_url,
      NEW.change_detected_at, NEW.received_at, NEW.payload, NEW.payload_sha256,
      NEW.diff_summary, NEW.node_policy_action, NEW.node_risk_weight,
      NEW.review_required, NEW.review_priority, NEW.review_sla_hours)
     IS DISTINCT FROM
     (OLD.amendment_id, OLD.uco_node_id, OLD.monitor_id, OLD.event_id, OLD.source_url,
      OLD.change_detected_at, OLD.received_at, OLD.payload, OLD.payload_sha256,
      OLD.diff_summary, OLD.node_policy_action, OLD.node_risk_weight,
      OLD.review_required, OLD.review_priority, OLD.review_sla_hours) THEN
    RAISE EXCEPTION 'uco_amendments: detection fields are immutable (amendment_id=%)', OLD.amendment_id;
  END IF;

  -- [F2] Reviewer identity is write-once. Set together with the
  -- pending_review → approved|rejected transition; never rewritable after,
  -- on any path, including same-status updates to terminal rows.
  IF OLD.reviewed_by IS NOT NULL AND NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
    RAISE EXCEPTION 'uco_amendments: reviewed_by is write-once (amendment_id=%)', OLD.amendment_id;
  END IF;
  IF OLD.reviewed_at IS NOT NULL AND NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
    RAISE EXCEPTION 'uco_amendments: reviewed_at is write-once (amendment_id=%)', OLD.amendment_id;
  END IF;

  IF NEW.applied_at IS DISTINCT FROM OLD.applied_at THEN
    IF OLD.applied_at IS NOT NULL THEN
      RAISE EXCEPTION 'uco_amendments: applied_at already set (amendment_id=%)', OLD.amendment_id;
    ELSIF NEW.status <> 'approved' THEN
      RAISE EXCEPTION 'uco_amendments: only approved amendments can be applied (amendment_id=%)', OLD.amendment_id;
    END IF;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;  -- notes edit / applied_at stamp on approved (identity guarded above)
  END IF;

  IF OLD.status IN ('approved','rejected','superseded') THEN
    RAISE EXCEPTION 'uco_amendments: status [%] is terminal (amendment_id=%)', OLD.status, OLD.amendment_id;
  END IF;

  IF OLD.status = 'pending_review' AND NEW.status IN ('approved','rejected') THEN
    IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'uco_amendments: reviewer identity + timestamp required for % (amendment_id=%)', NEW.status, OLD.amendment_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'superseded' AND OLD.status IN ('pending_review','acknowledged') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'uco_amendments: illegal transition % -> % (amendment_id=%)', OLD.status, NEW.status, OLD.amendment_id;
END;
$$;

CREATE TRIGGER uco_amendments_transition
  BEFORE UPDATE ON uco_amendments
  FOR EACH ROW EXECUTE FUNCTION uco_amendment_transition_guard();

-- Amendments are never deleted (reuses V2 WORM function)
CREATE TRIGGER uco_amendments_no_delete
  BEFORE DELETE ON uco_amendments
  FOR EACH ROW EXECUTE FUNCTION worm_block_update_delete_generic();

-- ── RBAC (roles from V5) ─────────────────────────────────────
GRANT SELECT, INSERT ON uco_amendments TO ios_app;
GRANT UPDATE (status, reviewed_by, reviewed_at, review_notes, applied_at)
  ON uco_amendments TO ios_app;   -- column-level: detection record immutable even to the app role
GRANT SELECT ON uco_amendments TO audit_reader;

COMMENT ON TABLE uco_amendments IS
  'Regulatory change intake from Firecrawl monitors. One row per verified '
  'monitor.page event, mapped to exactly one UCO node. BLOCK/ESCALATE nodes '
  'require human review before the amendment may be applied to the matrix '
  '(fail-closed: gate keeps enforcing the existing node until approval). '
  'At most one open pending_review amendment per node (uq_amend_open_per_node).';
