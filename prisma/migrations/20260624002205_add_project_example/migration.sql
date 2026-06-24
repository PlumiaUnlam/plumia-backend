/*
  Warnings:

  - You are about to drop the column `passwordHash` on the `User` table. All the data in the column will be lost.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- DropIndex
DROP INDEX "idx_chunk_embedding";

-- DropIndex
DROP INDEX "idx_entity_name";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordHash";

-- SeedData
DO $$
DECLARE
  v_target_user_id TEXT;
  v_project_id UUID;
  v_book_1_id UUID;
  v_book_2_id UUID;
  v_chapter_1_1_id UUID;
  v_chapter_1_2_id UUID;
  v_chapter_2_1_id UUID;
  v_chapter_2_2_id UUID;
BEGIN
  INSERT INTO "User" (
    "id",
    "name",
    "lastname",
    "email",
    "createdAt",
    "updatedAt",
    "role",
    "plan"
  )
  VALUES (
    'dev-user-example-com',
    'User',
    '',
    'user@example.com',
    NOW(),
    NOW(),
    'AUTHOR',
    'FREE'
  )
  ON CONFLICT ("email") DO UPDATE
    SET "updatedAt" = "User"."updatedAt"
  RETURNING "id" INTO v_target_user_id;

  SELECT "id"
  INTO v_project_id
  FROM "project"
  WHERE "user_id" = v_target_user_id
    AND "title" = 'Proyecto Demo PlumIA'
    AND "deleted_at" IS NULL
  LIMIT 1;

  IF v_project_id IS NULL THEN
    INSERT INTO "project" (
      "id",
      "user_id",
      "title",
      "description",
      "genre",
      "genre_rules",
      "word_count_target",
      "status",
      "created_at",
      "updated_at"
    )
    VALUES (
      gen_random_uuid(),
      v_target_user_id,
      'Proyecto Demo PlumIA',
      'Proyecto mockeado para probar el árbol de libros, capítulos y escenas.',
      'Fantasía',
      '{"tone":"adventure","audience":"young_adult"}'::jsonb,
      80000,
      'draft',
      NOW(),
      NOW()
    )
    RETURNING "id" INTO v_project_id;
  END IF;

  INSERT INTO "book" ("id", "project_id", "title", "sort_key", "created_at", "updated_at")
  VALUES (gen_random_uuid(), v_project_id, 'Libro I: La Semilla de Luz', '001', NOW(), NOW())
  ON CONFLICT ("project_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "updated_at" = NOW()
  RETURNING "id" INTO v_book_1_id;

  INSERT INTO "book" ("id", "project_id", "title", "sort_key", "created_at", "updated_at")
  VALUES (gen_random_uuid(), v_project_id, 'Libro II: El Mapa de Sombras', '002', NOW(), NOW())
  ON CONFLICT ("project_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "updated_at" = NOW()
  RETURNING "id" INTO v_book_2_id;

  INSERT INTO "chapter" ("id", "book_id", "title", "sort_key", "status", "word_count", "created_at", "updated_at")
  VALUES (gen_random_uuid(), v_book_1_id, 'Capítulo 1: El llamado', '001', 'DRAFT', 1240, NOW(), NOW())
  ON CONFLICT ("book_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "word_count" = EXCLUDED."word_count",
        "updated_at" = NOW()
  RETURNING "id" INTO v_chapter_1_1_id;

  INSERT INTO "chapter" ("id", "book_id", "title", "sort_key", "status", "word_count", "created_at", "updated_at")
  VALUES (gen_random_uuid(), v_book_1_id, 'Capítulo 2: La puerta antigua', '002', 'DRAFT', 980, NOW(), NOW())
  ON CONFLICT ("book_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "word_count" = EXCLUDED."word_count",
        "updated_at" = NOW()
  RETURNING "id" INTO v_chapter_1_2_id;

  INSERT INTO "chapter" ("id", "book_id", "title", "sort_key", "status", "word_count", "created_at", "updated_at")
  VALUES (gen_random_uuid(), v_book_2_id, 'Capítulo 1: Cartas desde el norte', '001', 'DRAFT', 1110, NOW(), NOW())
  ON CONFLICT ("book_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "word_count" = EXCLUDED."word_count",
        "updated_at" = NOW()
  RETURNING "id" INTO v_chapter_2_1_id;

  INSERT INTO "chapter" ("id", "book_id", "title", "sort_key", "status", "word_count", "created_at", "updated_at")
  VALUES (gen_random_uuid(), v_book_2_id, 'Capítulo 2: El archivo sellado', '002', 'DRAFT', 1360, NOW(), NOW())
  ON CONFLICT ("book_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "word_count" = EXCLUDED."word_count",
        "updated_at" = NOW()
  RETURNING "id" INTO v_chapter_2_2_id;

  INSERT INTO "scene" ("id", "chapter_id", "title", "sort_key", "content", "word_count", "status", "order", "created_at", "updated_at")
  VALUES
    (gen_random_uuid(), v_chapter_1_1_id, 'Escena 1: Una luz en la ventana', '001', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"La protagonista descubre una señal imposible en mitad de la noche."}]}]}'::jsonb, 620, 'DRAFT', 1, NOW(), NOW()),
    (gen_random_uuid(), v_chapter_1_1_id, 'Escena 2: El mensaje incompleto', '002', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Un mensaje antiguo revela que alguien esperaba su llegada."}]}]}'::jsonb, 620, 'DRAFT', 2, NOW(), NOW())
  ON CONFLICT ("chapter_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "content" = EXCLUDED."content",
        "word_count" = EXCLUDED."word_count",
        "order" = EXCLUDED."order",
        "updated_at" = NOW();

  INSERT INTO "scene" ("id", "chapter_id", "title", "sort_key", "content", "word_count", "status", "order", "created_at", "updated_at")
  VALUES
    (gen_random_uuid(), v_chapter_1_2_id, 'Escena 1: Bajo la biblioteca', '001', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"El grupo encuentra una escalera oculta bajo los archivos prohibidos."}]}]}'::jsonb, 470, 'DRAFT', 1, NOW(), NOW()),
    (gen_random_uuid(), v_chapter_1_2_id, 'Escena 2: El guardián de piedra', '002', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Una estatua despierta y exige una verdad a cambio del paso."}]}]}'::jsonb, 510, 'DRAFT', 2, NOW(), NOW())
  ON CONFLICT ("chapter_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "content" = EXCLUDED."content",
        "word_count" = EXCLUDED."word_count",
        "order" = EXCLUDED."order",
        "updated_at" = NOW();

  INSERT INTO "scene" ("id", "chapter_id", "title", "sort_key", "content", "word_count", "status", "order", "created_at", "updated_at")
  VALUES
    (gen_random_uuid(), v_chapter_2_1_id, 'Escena 1: El sello roto', '001', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Una carta llega con el sello quebrado y una advertencia urgente."}]}]}'::jsonb, 560, 'DRAFT', 1, NOW(), NOW()),
    (gen_random_uuid(), v_chapter_2_1_id, 'Escena 2: La ruta helada', '002', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"La expedición toma el camino del norte antes del amanecer."}]}]}'::jsonb, 550, 'DRAFT', 2, NOW(), NOW())
  ON CONFLICT ("chapter_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "content" = EXCLUDED."content",
        "word_count" = EXCLUDED."word_count",
        "order" = EXCLUDED."order",
        "updated_at" = NOW();

  INSERT INTO "scene" ("id", "chapter_id", "title", "sort_key", "content", "word_count", "status", "order", "created_at", "updated_at")
  VALUES
    (gen_random_uuid(), v_chapter_2_2_id, 'Escena 1: Nombres tachados', '001', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"El archivo revela nombres eliminados de la historia oficial."}]}]}'::jsonb, 690, 'DRAFT', 1, NOW(), NOW()),
    (gen_random_uuid(), v_chapter_2_2_id, 'Escena 2: Una alianza incómoda', '002', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Dos rivales aceptan colaborar cuando descubren un enemigo común."}]}]}'::jsonb, 670, 'DRAFT', 2, NOW(), NOW())
  ON CONFLICT ("chapter_id", "sort_key") DO UPDATE
    SET "title" = EXCLUDED."title",
        "content" = EXCLUDED."content",
        "word_count" = EXCLUDED."word_count",
        "order" = EXCLUDED."order",
        "updated_at" = NOW();
END $$;
