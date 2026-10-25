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
    "search_vector" TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce("breadcrumb", '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(array_to_string("questions", ' '), '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(array_to_string("keywords", ' '), '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce("content", '')), 'B')
    ) STORED,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_help_chunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_application_help_search"
    ON "application_help_chunk" USING GIN ("search_vector");
