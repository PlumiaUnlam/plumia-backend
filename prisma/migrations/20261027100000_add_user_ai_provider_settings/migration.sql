ALTER TABLE "user_api_key" DROP CONSTRAINT "chk_apikey_provider";

ALTER TABLE "user_api_key" ADD CONSTRAINT "chk_apikey_provider"
  CHECK ("provider" IN ('deepseek', 'openai', 'fal', 'gemini', 'anthropic'));

CREATE TABLE "user_ai_provider_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "provider" VARCHAR(20) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "credential_source" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_ai_provider_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_ai_provider_settings_provider_check"
    CHECK ("provider" IN ('gemini', 'anthropic')),
  CONSTRAINT "user_ai_provider_settings_credential_source_check"
    CHECK ("credential_source" IN ('USER', 'SERVER')),
  CONSTRAINT "user_ai_provider_settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_ai_provider_settings_user_id_key"
  ON "user_ai_provider_settings"("user_id");
