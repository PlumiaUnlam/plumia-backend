# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm run start:dev       # Watch mode with hot reload
pnpm run start:debug     # Debug mode with watch

# Build & production
pnpm run build           # Compile to ./dist
pnpm run start:prod      # Run compiled output

# Code quality
pnpm run lint            # ESLint with auto-fix
pnpm run format          # Prettier formatting

# Testing
pnpm run test            # Unit tests
pnpm run test:watch      # Unit tests in watch mode
pnpm run test:cov        # Coverage report
pnpm run test:e2e        # End-to-end tests

# Database
pnpm exec prisma migrate dev --name <name>   # Create and apply a new migration
pnpm exec prisma migrate status              # Check migration status
pnpm exec prisma db push                     # Push schema changes without migration history
pnpm exec prisma generate                    # Regenerate Prisma client after schema changes
pnpm exec prisma studio                      # Open Prisma Studio (local DB browser)

# Docker
docker build -t plumia-backend .
```

To run a single test file:

```bash
pnpm run test -- --testPathPattern=<filename>
```

## Architecture

**Framework:** NestJS 11 with TypeScript 5.7, running on Node 22.  
**Package manager:** pnpm (use pnpm, not npm or yarn).  
**ORM:** Prisma 5 (`@prisma/client` + `prisma` CLI).  
**Database:** PostgreSQL hosted on Supabase.  
**Port:** Configured via `PORT` env variable, defaults to 3000.

### Module structure

Feature modules live under `src/` following NestJS conventions (`*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.spec.ts`). Import feature modules into `AppModule` (`src/app.module.ts`).

`PrismaModule` is registered as `@Global()` in `AppModule` — `PrismaService` is available for injection in any module without re-importing `PrismaModule`.

Domain modules are grouped by **bounded context** (one module per context, not one per entity) to keep coupling low. Each owns the entities below:

| Module (`src/`) | Entities                                                          |
| --------------- | ----------------------------------------------------------------- |
| `user` + `auth` | User, UserApiKey, Subscription, TokenLedger (auth: Firebase Auth) |
| `manuscript`    | Project, Book, Chapter, Scene                                     |
| `knowledge`     | Entity, EntityState, Fact, Relationship, EntityProposal           |
| `audit`         | AuditAlert, AuditFalsePositive                                    |
| `chat`          | ChatThread, ChatMessage, Chunk, Summary                           |
| `publishing`    | Version, ExportJob, GeneratedImage, StoryboardNote                |
| `reading`       | ShareLink, ReaderComment                                          |
| `analytics`     | WritingSession, WritingGoal                                       |
| `system`        | Outbox                                                            |

Most domain modules are currently **scaffolding only** (empty service/controller); business logic (CRUD, endpoints) is pending. The exceptions are `chat` and `knowledge`, which already have the search abstraction wired (see "Search abstraction" below). All endpoints are protected by a global `JwtAuthGuard`; mark public routes with `@Public()` (`src/common/decorators/public.decorator.ts`).

### Database

- Schema lives in `prisma/schema.prisma`.
- Migrations live in `prisma/migrations/`.
- `PrismaService` (`src/prisma/`) extends `PrismaClient` and handles connect/disconnect via NestJS lifecycle hooks.
- **Two connection URLs are required** (both in `.env`):
  - `DATABASE_URL` — Supabase transaction-mode pooler (port 6543, pgbouncer). Used at runtime.
  - `DIRECT_URL` — Supabase direct connection (`db.<project-ref>.supabase.co`, port 5432). Used by Prisma CLI for migrations. Must use the `db.` host, not the pooler host.
- Always use `pnpm exec prisma` (not `pnpm dlx prisma`) to use the locally installed CLI version.

#### Schema conventions

The data model is the normalized PlumIA design (28 entities). When adding/editing models, follow the established conventions:

- Prisma fields are **camelCase**; DB tables/columns are **snake_case** via `@map`/`@@map`.
- PK: `String @id @default(uuid()) @db.Uuid`. Timestamps: `DateTime @db.Timestamptz(6)`.
- **Soft delete** via nullable `deletedAt @map("deleted_at")` — never hard-delete in production.
- Special types: `Decimal @db.Decimal(p,s)`, `Bytes` → `bytea`, `Json @db.JsonB`, `String[]` → `text[]`.
- Index every FK and every column used in `WHERE`/`JOIN`/`ORDER BY`; enforce uniqueness with `@@unique`.
- The legacy `User` columns (`name`, `lastname`, `email`, `passwordHash`, `createdAt`, `updatedAt`) are intentionally **not** `@map`-ped (no destructive rename); only newer columns use snake_case mapping.

#### PostgreSQL extensions & raw SQL (what Prisma does NOT model)

The datasource enables `postgresqlExtensions` preview with `extensions = [pgcrypto, pg_trgm, vector]`. Some DB features cannot be expressed in the Prisma schema and live **only in the migration SQL** (`prisma/migrations/<ts>_add_plumia_core_schema/migration.sql`). When regenerating migrations, these must be re-added by hand:

- **pgvector**: `Chunk.embedding` is `Unsupported("vector(1536)")` in the schema; the **IVFFlat** index (`idx_chunk_embedding`, `lists = 100`) is raw SQL. The Prisma Client cannot read/write this column — use `$queryRaw`/`$executeRaw`.
- **pg_trgm**: the **GIN trigram** index on `Entity.canonical_name` (`idx_entity_name`) is raw SQL.
- **CHECK constraints** (Prisma can't express them): temporal windows on `entity_state`/`relationship`, plus `provider` (user_api_key), `role` (chat_message), `scope_type` (summary).

To regenerate the migration without touching the live DB, generate it read-only with `prisma migrate diff --from-url $DIRECT_URL --to-schema-datamodel prisma/schema.prisma --script`, then re-append the raw SQL block. **Migrations are not auto-applied here** — apply explicitly with `pnpm exec prisma migrate deploy` (the agent is not authorized to run migrations against the Supabase DB).

#### Search abstraction (Ports & Adapters)

Postgres-specific search is isolated behind interfaces so it stays swappable (e.g. Qdrant/Meilisearch later) without touching domain code. The Postgres adapters are the **only** place that uses `$queryRaw` with PG-specific operators:

- **Vector search** (`chat`): port `VectorStore` + token `VECTOR_STORE` (`src/chat/ports/vector-store.port.ts`), adapter `PgVectorStore` (`<=>` operator). Wired via `{ provide: VECTOR_STORE, useClass: PgVectorStore }`.
- **Fuzzy name search** (`knowledge`): port `EntitySearch` + token `ENTITY_SEARCH` (`src/knowledge/ports/entity-search.port.ts`), adapter `PgEntitySearch` (`similarity()`).

Services inject the **port** (`@Inject(TOKEN)`), never the adapter. When using an interface as a decorated constructor-param type, import it with `import type` (required by `isolatedModules` + `emitDecoratorMetadata`); import the token as a normal value.

### TypeScript config

- Target: ES2023, `moduleResolution: nodenext` — use ESM-style imports with extensions when needed.
- Decorators and `emitDecoratorMetadata` are enabled (required by NestJS DI).
- Build output goes to `./dist`; `deleteOutDir` is enabled in `nest-cli.json`.

### Docker

Multi-stage Dockerfile (base → deps → build → runner) using Node 22 Alpine. The final image runs as a non-root `nestjs:nodejs` user and exposes port 3000.

### Code style

- Prettier: single quotes, trailing commas.
- ESLint auto-fixes on save (configured in `.vscode/settings.json`).
- Run `pnpm run lint && pnpm run format` before committing.

## Pending / future phases

The schema, the migration (generated, **not yet applied**), the 9 bounded-context modules, and the search Ports & Adapters layer are in place. Still to implement:

- **Apply the migration**: `pnpm exec prisma migrate deploy`, then verify with `pnpm exec prisma migrate status`. Required before any search/CRUD works end-to-end.
- **CRUD + endpoints per context**: domain services/controllers are empty scaffolds (`manuscript`, `audit`, `publishing`, `reading`, `analytics`, `system`, and most of `chat`/`knowledge`). Add DTOs (`class-validator`), service logic, and routes.
- **Embeddings & RAG** (`chat`): embedding generation (LLM provider call), scene chunking, and chat retrieval orchestration. `PgVectorStore.upsertChunk`/`search` exist but nothing produces vectors yet. Consider HNSW vs. the current IVFFlat index once real data volume is known.
- **Integration tests for adapters**: `PgVectorStore` / `PgEntitySearch` need a DB with the migration applied (unit-test services by mocking the ports).
- **Soft-delete cascade** (Project → Book/Chapter/Scene; Scene → mark `Chunk.is_dirty`) and **temporal non-overlap validation** for `EntityState`/`Relationship` — deferred to the application layer (only simple CHECKs exist in SQL).
- **Outbox processing**: the `Outbox` table exists (transactional outbox) but has no worker/dispatcher.
- **Enum values**: confirmed for `UserRole` (`AUTHOR`/`READER`) and `PlanType` (`FREE`/`PRO`); the rest are inferred from defaults — validate against the official doc (section 1) before relying on them.
- **Known pre-existing build/lint errors** (unrelated to the DB work) in `src/main.ts` and `src/auth/dto/*` — `pnpm run build` is currently red because of these.
