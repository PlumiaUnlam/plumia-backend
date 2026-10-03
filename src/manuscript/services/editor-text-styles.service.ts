import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EditorTextStyleNameConflictError } from '../domain/editor-text-style-name-conflict.error';
import type { SaveEditorTextStyleDto } from '../dto/editor-text-styles/save-editor-text-style.dto';
import {
  EDITOR_TEXT_STYLE_REPOSITORY,
  type EditorTextStyleRecord,
  type EditorTextStyleRepository,
} from '../ports/editor-text-style-repository.port';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../ports/project-repository.port';

const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
const LINE_HEIGHTS = ['1', '1.15', '1.5', '1.8', '2'] as const;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const FONT_SIZE_PATTERN = /^\d+(?:\.\d+)?(?:pt|px|em|rem|%)$/i;
type SanitizedEditorTextStyleDefinition = Record<
  string,
  string | boolean | number | null
>;

@Injectable()
export class EditorTextStylesService {
  constructor(
    @Inject(EDITOR_TEXT_STYLE_REPOSITORY)
    private readonly editorTextStyleRepository: EditorTextStyleRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
  ) {}

  async list(
    userId: string,
    projectId: string,
  ): Promise<EditorTextStyleRecord[]> {
    await this.assertProjectAccess(userId, projectId);
    return this.editorTextStyleRepository.listByProject(projectId);
  }

  async create(
    userId: string,
    projectId: string,
    dto: SaveEditorTextStyleDto,
  ): Promise<EditorTextStyleRecord> {
    await this.assertProjectAccess(userId, projectId);
    const name = this.normalizedName(dto.name);
    const definition = this.sanitizeDefinition(dto.definition);

    try {
      return await this.editorTextStyleRepository.create(projectId, {
        ...(dto.id !== undefined ? { id: dto.id } : {}),
        name,
        kind: dto.kind,
        definition,
      });
    } catch (error) {
      if (error instanceof EditorTextStyleNameConflictError) {
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
    const definition = this.sanitizeDefinition(dto.definition);

    try {
      const style = await this.editorTextStyleRepository.update(
        projectId,
        styleId,
        { name, kind: dto.kind, definition },
      );
      if (!style) {
        throw new NotFoundException('Estilo no encontrado');
      }
      return style;
    } catch (error) {
      if (error instanceof EditorTextStyleNameConflictError) {
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
    const deactivated = await this.editorTextStyleRepository.deactivate(
      projectId,
      styleId,
    );
    if (!deactivated) {
      throw new NotFoundException('Estilo no encontrado');
    }
  }

  private normalizedName(value: string): string {
    const name = value.trim();
    if (!name) {
      throw new BadRequestException('El nombre del estilo es obligatorio');
    }
    if (name.toLowerCase().startsWith('archived-')) {
      throw new BadRequestException(
        'Los nombres que comienzan con "archived-" están reservados',
      );
    }
    return name;
  }

  private sanitizeDefinition(
    input: Record<string, unknown>,
  ): SanitizedEditorTextStyleDefinition {
    const result: SanitizedEditorTextStyleDefinition = {};
    this.sanitizeStringFields(input, result);
    this.sanitizeBlockType(input, result);
    this.sanitizeBooleanFields(input, result);
    this.sanitizeParagraphSettings(input, result);
    this.sanitizeIndentFields(input, result);
    this.sanitizeTabSize(input, result);
    return result;
  }

  private sanitizeStringFields(
    input: Record<string, unknown>,
    result: SanitizedEditorTextStyleDefinition,
  ): void {
    for (const field of ['fontFamily', 'fontSize', 'color', 'highlightColor']) {
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
      this.validateStringField(field, value);
      result[field] = value;
    }
  }

  private validateStringField(field: string, value: string): void {
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
  }

  private sanitizeBlockType(
    input: Record<string, unknown>,
    result: SanitizedEditorTextStyleDefinition,
  ): void {
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
  }

  private sanitizeBooleanFields(
    input: Record<string, unknown>,
    result: SanitizedEditorTextStyleDefinition,
  ): void {
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
  }

  private sanitizeParagraphSettings(
    input: Record<string, unknown>,
    result: SanitizedEditorTextStyleDefinition,
  ): void {
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
  }

  private sanitizeIndentFields(
    input: Record<string, unknown>,
    result: SanitizedEditorTextStyleDefinition,
  ): void {
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
  }

  private sanitizeTabSize(
    input: Record<string, unknown>,
    result: SanitizedEditorTextStyleDefinition,
  ): void {
    const tabSize = input['tabSize'];
    if (tabSize !== undefined) {
      if (![2, 4, 8].includes(tabSize as number)) {
        throw new BadRequestException('Tamaño de tabulación inválido');
      }
      result['tabSize'] = tabSize as number;
    }
  }

  private async assertProjectAccess(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const hasAccess = await this.projectRepository.existsByIdForUser(
      userId,
      projectId,
    );
    if (!hasAccess) {
      throw new NotFoundException('Project not found');
    }
  }
}
