-- Queue joining was replaced by the reservation workflow. Any WAITING/CALLED
-- rows left by older app builds otherwise remain visible as a stuck table count.
UPDATE "queue_entries"
SET "status" = 'CANCELLED'
WHERE "status" IN ('WAITING', 'CALLED');
