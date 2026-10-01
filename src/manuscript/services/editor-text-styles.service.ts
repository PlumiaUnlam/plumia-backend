import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveEditorTextStyleDto } from '../dto/editor-text-styles/save-editor-text-style.dto';

const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
const LINE_HEIGHTS = ['1', '1.15', '1.5', '1.8', '2'] as const;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const FONT_SIZE_PATTERN = /^\d+(?:\.\d+)?(?:pt|px|em|rem|%)$/i;

export interface EditorTextStyleRecord {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  definition: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RETURNING_STYLE = Prisma.sql`
  RETURNING
    "id",
    "project_id" AS "projectId",
    "name",
    "kind",
    "definition",
    "is_active" AS "isActive",
    "created_at" AS "createdAt",
    "updated_at" AS "updatedAt"
`;

@Injectable()
export class EditorTextStylesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    projectId: string,
  ): Promise<EditorTextStyleRecord[]> {
    await this.assertProjectAccess(userId, projectId);
    return this.prisma.$queryRaw<EditorTextStyleRecord[]>(Prisma.sql`
      SELECT
        "id",
        "project_id" AS "projectId",
        "name",
        "kind",
        "definition",
        "is_active" AS "isActive",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "editor_text_style"
      WHERE "project_id" = ${projectId}::uuid
      ORDER BY "kind" ASC, "name" ASC
    `);
  }

  async create(
    userId: string,
    projectId: string,
    dto: SaveEditorTextStyleDto,
  ): Promise<EditorTextStyleRecord> {
    await this.assertProjectAccess(userId, projectId);
    const name = this.normalizedName(dto.name);
    const definition = JSON.stringify(this.sanitizeDefinition(dto.definition));

    try {
      const [style] = await this.prisma.$queryRaw<
        EditorTextStyleRecord[]
      >(Prisma.sql`
        INSERT INTO "editor_text_style" (
          "id", "project_id", "name", "kind", "definition", "updated_at"
        ) VALUES (
          COALESCE(${dto.id ?? null}::uuid, gen_random_uuid()),
          ${projectId}::uuid,
          ${name},
          ${dto.kind},
          ${definition}::jsonb,
          CURRENT_TIMESTAMP
        )
        ${RETURNING_STYLE}
      `);
      if (!style) {
        throw new Error('No se pudo crear el estilo');
      }
      return style;
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('Ya existe un estilo con ese nombre');
      }
      throw error;
    }
  }

  async update(
    userId: string,
    projectId: string,
    styleId: string,
    dto: SaveEditorTextStyleDto,
  ): Promise<EditorTextStyleRecord> {
    await this.assertProjectAccess(userId, projectId);
    const name = this.normalizedName(dto.name);
    const definition = JSON.stringify(this.sanitizeDefinition(dto.definition));

    try {
      const rows = await this.prisma.$queryRaw<
        EditorTextStyleRecord[]
      >(Prisma.sql`
        UPDATE "editor_text_style"
        SET
          "name" = ${name},
          "kind" = ${dto.kind},
          "definition" = ${definition}::jsonb,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${styleId}::uuid
          AND "project_id" = ${projectId}::uuid
          AND "is_active" = true
        ${RETURNING_STYLE}
      `);
      if (!rows[0]) {
        throw new NotFoundException('Estilo no encontrado');
      }
      return rows[0];
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('Ya existe un estilo con ese nombre');
      }
      throw error;
    }
  }

  async remove(
    userId: string,
    projectId: string,
    styleId: string,
  ): Promise<void> {
    await this.assertProjectAccess(userId, projectId);
    const deleted = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "editor_text_style"
      SET "is_active" = false, "name" = 'archived-' || "id"::text
      WHERE "id" = ${styleId}::uuid
        AND "project_id" = ${projectId}::uuid
        AND "is_active" = true
    `);
    if (deleted === 0) {
      throw new NotFoundException('Estilo no encontrado');
    }
  }

  private normalizedName(value: string) {
    const name = value.trim();
    if (!name) {
      throw new BadRequestException('El nombre del estilo es obligatorio');
    }
    return name;
  }

  private sanitizeDefinition(
    input: Record<string, unknown>,
  ): Record<string, string | boolean | number | null> {
    const result: Record<string, string | boolean | number | null> = {};
    const stringFields = ['fontFamily', 'fontSize', 'color', 'highlightColor'];
    for (const field of stringFields) {
      const value = input[field];
      if (value === null) {
        result[field] = null;
        continue;
      }
      if (value === undefined || value === '') {
        continue;
      }
      if (typeof value !== 'string' || value.length > 120) {
        throw new BadRequestException(`Formato inválido para ${field}`);
      }
      if (field === 'fontFamily' && !/^[\p{L}\p{N} ,.'"_-]+$/u.test(value)) {
        throw new BadRequestException('Familia tipográfica inválida');
      }
      if (field === 'fontSize' && !FONT_SIZE_PATTERN.test(value)) {
        throw new BadRequestException('Tamaño de fuente inválido');
      }
      if (
        (field === 'color' || field === 'highlightColor') &&
        !COLOR_PATTERN.test(value)
      ) {
        throw new BadRequestException(`Color inválido para ${field}`);
      }
      result[field] = value;
    }

    const blockType = input['blockType'];
    if (blockType !== undefined) {
      if (
        !['paragraph', 'heading1', 'heading2', 'heading3'].includes(
          blockType as string,
        )
      ) {
        throw new BadRequestException('Tipo de párrafo inválido');
      }
      result['blockType'] = blockType as string;
    }

    for (const field of [
      'bold',
      'italic',
      'underline',
      'strike',
      'subscript',
      'superscript',
    ] as const) {
      const value = input[field];
      if (value !== undefined) {
        if (typeof value !== 'boolean') {
          throw new BadRequestException(`Formato inválido para ${field}`);
        }
        result[field] = value;
      }
    }

    const textAlign = input['textAlign'];
    if (textAlign !== undefined) {
      if (!ALIGNMENTS.includes(textAlign as (typeof ALIGNMENTS)[number])) {
        throw new BadRequestException('Alineación inválida');
      }
      result['textAlign'] = textAlign as string;
    }
    const lineHeight = input['lineHeight'];
    if (lineHeight !== undefined) {
      if (!LINE_HEIGHTS.includes(lineHeight as (typeof LINE_HEIGHTS)[number])) {
        throw new BadRequestException('Interlineado inválido');
      }
      result['lineHeight'] = lineHeight as string;
    }

    for (const field of [
      'indentLeft',
      'indentRight',
      'firstLineIndent',
    ] as const) {
      const value = input[field];
      if (value !== undefined) {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 20
        ) {
          throw new BadRequestException(`Formato inválido para ${field}`);
        }
        result[field] = value;
      }
    }
    const tabSize = input['tabSize'];
    if (tabSize !== undefined) {
      if (![2, 4, 8].includes(tabSize as number)) {
        throw new BadRequestException('Tamaño de tabulación inválido');
      }
      result['tabSize'] = tabSize as number;
    }

    return result;
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' ||
        (error.code === 'P2010' && error.meta?.['code'] === '23505'))
    );
  }

  private async assertProjectAccess(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
  }
}
