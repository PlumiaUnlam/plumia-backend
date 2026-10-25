ALTER TABLE "user_api_key" DROP CONSTRAINT "chk_apikey_provider";

ALTER TABLE "user_api_key" ADD CONSTRAINT "chk_apikey_provider"
  CHECK ("provider" IN ('deepseek', 'openai', 'fal', 'gemini'));

CREATE UNIQUE INDEX "user_api_key_one_active_provider"
  ON "user_api_key"("user_id", "provider")
  WHERE "is_active" = true;
