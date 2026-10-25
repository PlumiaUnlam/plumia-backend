import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Project } from '@prisma/client';
import { ProposalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeEntityRecognitionName } from '../../system/entity-extraction/entity-recognition-settings';

@Injectable()
export class EntityRecognitionSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getProjectSettings(
    userId: string,
    projectId: string,
  ): Promise<{
    importantEntityNames: string[];
    ignoredEntityNames: string[];
    rejectedEntities: {
      id: string;
      entityId: string | null;
      name: string;
      aliases: string[];
      type: string | null;
      sceneTitle: string | null;
      createdAt: Date;
    }[];
  }> {
    const project = await this.findProject(userId, projectId);
    const [settings, rejectedProposals] = await Promise.all([
      this.prisma.projectEntityRecognitionSettings.findUnique({
        where: { projectId: project.id },
        select: { importantEntityNames: true, ignoredEntityNames: true },
      }),
      this.prisma.entityProposal.findMany({
        where: { projectId: project.id, status: ProposalStatus.REJECTED },
        select: {
          id: true,
          entityId: true,
          proposedData: true,
          createdAt: true,
          scene: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const rejectedEntities = this.toRejectedEntities(rejectedProposals);
    return {
      importantEntityNames: this.readNames(settings?.importantEntityNames),
      ignoredEntityNames: this.readNames(settings?.ignoredEntityNames),
      rejectedEntities,
    };
  }

  async updateProjectSettings(
    userId: string,
    projectId: string,
    names: string[],
    ignoredNames: string[] = [],
  ): Promise<{
    importantEntityNames: string[];
    ignoredEntityNames: string[];
    rejectedEntities: {
      id: string;
      entityId: string | null;
      name: string;
      aliases: string[];
      type: string | null;
      sceneTitle: string | null;
      createdAt: Date;
    }[];
  }> {
    const normalizedNames = this.normalizeNames(names, 'importantes');
    const normalizedIgnoredNames = this.normalizeNames(
      ignoredNames,
      'ignoradas',
    );
    const project = await this.findProject(userId, projectId);
    await this.prisma.projectEntityRecognitionSettings.upsert({
      where: { projectId: project.id },
      create: {
        projectId: project.id,
        importantEntityNames: normalizedNames,
        ignoredEntityNames: normalizedIgnoredNames,
      },
      update: {
        importantEntityNames: normalizedNames,
        ignoredEntityNames: normalizedIgnoredNames,
      },
    });

    return this.getProjectSettings(userId, projectId);
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

  private normalizeNames(names: string[], label: string): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const rawName of names) {
      const name = rawName.trim();
      const normalized = normalizeEntityRecognitionName(name);
      if (!normalized) {
        throw new BadRequestException(
          `Los nombres ${label} no pueden estar vacios`,
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

  private toRejectedEntities(
    proposals: {
      id: string;
      entityId: string | null;
      proposedData: unknown;
      createdAt: Date;
      scene: { title: string | null };
    }[],
  ): {
    id: string;
    entityId: string | null;
    name: string;
    aliases: string[];
    type: string | null;
    sceneTitle: string | null;
    createdAt: Date;
  }[] {
    const seen = new Set<string>();
    return proposals.flatMap((proposal) => {
      const data = this.asRecord(proposal.proposedData);
      const name = this.readString(data['canonicalName']);
      if (!name) {
        return [];
      }
      const normalized = normalizeEntityRecognitionName(name);
      if (seen.has(normalized)) {
        return [];
      }
      seen.add(normalized);
      const aliases = Array.isArray(data['aliases'])
        ? data['aliases'].filter(
            (alias): alias is string => typeof alias === 'string',
          )
        : [];
      return [
        {
          id: proposal.id,
          entityId: proposal.entityId,
          name,
          aliases,
          type: this.readString(data['type']),
          sceneTitle: proposal.scene.title,
          createdAt: proposal.createdAt,
        },
      ];
    });
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
