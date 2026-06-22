-- Add generated tsvector column for full-text search (SDS §7).
-- Title weighted 'A' (higher relevance), content weighted 'B'.
-- GENERATED ALWAYS AS … STORED: Postgres backfills existing rows and
-- recomputes automatically on every INSERT/UPDATE — no app code writes it.
ALTER TABLE "Note" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce("contentText", '')), 'B')
  ) STORED;

CREATE INDEX note_search_idx ON "Note" USING GIN (search_vector);
