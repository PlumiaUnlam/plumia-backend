CREATE TABLE "application_help_chunk" (
    "id" VARCHAR(120) NOT NULL,
    "doc_id" VARCHAR(100) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "breadcrumb" VARCHAR(600) NOT NULL,
    "area" VARCHAR(100) NOT NULL,
    "route" VARCHAR(500) NOT NULL,
    "related" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "questions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "content" TEXT NOT NULL,
    "embed_text" TEXT NOT NULL,
    "words" INTEGER NOT NULL,
    "sources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updated" VARCHAR(10) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "embedding" vector(1536),
    "embedding_content_hash" VARCHAR(64),
    "embedding_profile" VARCHAR(180),
    "search_vector" TSVECTOR NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_help_chunk_pkey" PRIMARY KEY ("id")
);

CREATE FUNCTION update_application_help_search_vector()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."search_vector" :=
        setweight(to_tsvector('spanish', coalesce(NEW."title", '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(NEW."breadcrumb", '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(array_to_string(NEW."questions", ' '), '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(array_to_string(NEW."keywords", ' '), '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(NEW."content", '')), 'B');
    RETURN NEW;
END;
$$;

CREATE TRIGGER "application_help_chunk_search_vector_trigger"
    BEFORE INSERT OR UPDATE OF "title", "breadcrumb", "questions", "keywords", "content"
    ON "application_help_chunk"
    FOR EACH ROW
    EXECUTE FUNCTION update_application_help_search_vector();

CREATE INDEX "idx_application_help_search"
    ON "application_help_chunk" USING GIN ("search_vector");
