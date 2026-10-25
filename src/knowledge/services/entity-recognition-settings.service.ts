import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Project } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeEntityRecognitionName } from '../../system/entity-extraction/entity-recognition-settings';

@Injectable()
export class EntityRecognitionSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getProjectSettings(
    userId: string,
    projectId: string,
  ): Promise<{ importantEntityNames: string[] }> {
    const project = await this.findProject(userId, projectId);
    const settings =
      await this.prisma.projectEntityRecognitionSettings.findUnique({
        where: { projectId: project.id },
        select: { importantEntityNames: true },
      });
    return {
      importantEntityNames: this.readNames(settings?.importantEntityNames),
    };
  }

  async updateProjectSettings(
    userId: string,
    projectId: string,
    names: string[],
  ): Promise<{ importantEntityNames: string[] }> {
    const normalizedNames = this.normalizeNames(names);
    const project = await this.findProject(userId, projectId);
    const updated = await this.prisma.projectEntityRecognitionSettings.upsert({
      where: { projectId: project.id },
      create: {
        projectId: project.id,
        importantEntityNames: normalizedNames,
      },
      update: {
        importantEntityNames: normalizedNames,
      },
      select: { importantEntityNames: true },
    });

    return {
      importantEntityNames: this.readNames(updated.importantEntityNames),
    };
  }

  private async findProject(
    userId: string,
    projectId: string,
  ): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  private normalizeNames(names: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const rawName of names) {
      const name = rawName.trim();
      const normalized = normalizeEntityRecognitionName(name);
      if (!normalized) {
        throw new BadRequestException(
          'Los nombres importantes no pueden estar vacios',
        );
      }
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(name);
      }
    }
    return result;
  }

  private readNames(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
