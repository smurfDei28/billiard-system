-- Keep historical CANCELLED/SEATED records while allowing only one active
-- waiting record for a member at a particular table.
-- Existing duplicate active rows are retained as history and only the oldest
-- active row remains in the live queue.
WITH ranked_active_entries AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "tableId", "userId" ORDER BY "joinedAt", id) AS row_number
  FROM "queue_entries"
  WHERE "userId" IS NOT NULL AND status IN ('WAITING', 'CALLED')
)
UPDATE "queue_entries" AS queue_entry
SET status = 'CANCELLED'
FROM ranked_active_entries
WHERE queue_entry.id = ranked_active_entries.id AND ranked_active_entries.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "queue_entries_one_active_member_per_table"
ON "queue_entries" ("tableId", "userId")
WHERE "userId" IS NOT NULL AND status IN ('WAITING', 'CALLED');

CREATE INDEX IF NOT EXISTS "queue_entries_active_order"
ON "queue_entries" ("tableId", "joinedAt")
WHERE status IN ('WAITING', 'CALLED');
