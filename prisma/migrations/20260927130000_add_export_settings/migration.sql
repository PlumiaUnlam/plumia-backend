-- CreateTable
CREATE TABLE "export_settings" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "margin_top_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "margin_bottom_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "margin_left_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "margin_right_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "header" JSONB,
    "footer" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "export_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "export_settings_project_id_key" ON "export_settings"("project_id");

-- AddForeignKey
ALTER TABLE "export_settings" ADD CONSTRAINT "export_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
