-- Associate frozen share invitations with one book. Existing frozen shares are
-- backfilled from the first (and previously possibly only) book in the snapshot.
ALTER TABLE "share_link" ADD COLUMN "book_id" UUID;

UPDATE "share_link" AS share
SET "book_id" = (version."snapshot" -> 'books' -> 0 ->> 'id')::UUID
FROM "version" AS version
WHERE share."version_id" = version."id"
  AND jsonb_typeof(version."snapshot" -> 'books') = 'array'
  AND jsonb_array_length(version."snapshot" -> 'books') > 0
  AND (version."snapshot" -> 'books' -> 0 ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1
    FROM "book"
    WHERE "book"."id" = (version."snapshot" -> 'books' -> 0 ->> 'id')::UUID
  );

CREATE INDEX "idx_share_book" ON "share_link"("book_id");

ALTER TABLE "share_link" ADD CONSTRAINT "share_link_book_id_fkey"
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
