import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ExportSettings } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_EXPORT_SETTINGS } from './export-settings.defaults';
import type {
  ExportHeaderFooterConfig,
  ExportSettingsConfig,
} from './export-settings.types';
import { ExportSettingsResponseDto } from './dto/export-settings-response.dto';
import type { UpdateExportSettingsDto } from './dto/update-export-settings.dto';

type HeaderFooterInput = NonNullable<UpdateExportSettingsDto['header']>;

@Injectable()
export class ExportSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(
    userId: string,
    projectId: string,
  ): Promise<ExportSettingsResponseDto> {
    await this.assertOwnership(userId, projectId);
    const row = await this.prisma.exportSettings.findUnique({
      where: { projectId },
    });
    return ExportSettingsResponseDto.from(
      row ? this.toConfig(row) : DEFAULT_EXPORT_SETTINGS,
    );
  }

  async upsertSettings(
    userId: string,
    projectId: string,
    dto: UpdateExportSettingsDto,
  ): Promise<ExportSettingsResponseDto> {
    await this.assertOwnership(userId, projectId);
    const columns = this.toColumns(dto);
    const row = await this.prisma.exportSettings.upsert({
      where: { projectId },
      create: { projectId, ...columns },
      update: columns,
    });
    return ExportSettingsResponseDto.from(this.toConfig(row));
  }

  async getEffectiveConfig(projectId: string): Promise<ExportSettingsConfig> {
    const row = await this.prisma.exportSettings.findUnique({
      where: { projectId },
    });
    return row ? this.toConfig(row) : DEFAULT_EXPORT_SETTINGS;
  }

  private async assertOwnership(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
  }

  private toColumns(dto: UpdateExportSettingsDto): {
    marginTopCm: number;
    marginBottomCm: number;
    marginLeftCm: number;
    marginRightCm: number;
    header: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    footer: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  } {
    // PUT reemplaza la configuración completa: omitir header/footer equivale
    // a limpiarlos, igual que enviarlos explícitamente en null.
    return {
      marginTopCm: dto.margins.topCm,
      marginBottomCm: dto.margins.bottomCm,
      marginLeftCm: dto.margins.leftCm,
      marginRightCm: dto.margins.rightCm,
      header: this.toJson(dto.header),
      footer: this.toJson(dto.footer),
    };
  }

  private toJson(
    config: HeaderFooterInput | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (!config) {
      return Prisma.JsonNull;
    }
    const normalized: ExportHeaderFooterConfig = {
      text: config.text ?? null,
      alignment: config.alignment,
      pageNumber: config.pageNumber,
    };
    return normalized as unknown as Prisma.InputJsonValue;
  }

  private toConfig(row: ExportSettings): ExportSettingsConfig {
    return {
      margins: {
        topCm: row.marginTopCm,
        bottomCm: row.marginBottomCm,
        leftCm: row.marginLeftCm,
        rightCm: row.marginRightCm,
      },
      header:
        (row.header as unknown as ExportHeaderFooterConfig | null) ?? null,
      footer:
        (row.footer as unknown as ExportHeaderFooterConfig | null) ?? null,
    };
  }
}
