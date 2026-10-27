import { Injectable } from '@nestjs/common';
import {
  KnowledgeReviewMode,
  ProposalStatus,
  StateProposalSequenceKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { forEachSequentially } from './entity-extraction/for-each-sequentially';
import { RelationshipProposalService } from '../knowledge/services/relationship-proposal.service';
import { TemporalStateService } from '../knowledge/services/temporal-state.service';

@Injectable()
export class KnowledgeProposalAutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly temporalStates: TemporalStateService,
    private readonly relationshipProposals: RelationshipProposalService,
  ) {}

  async reviewScene(sceneId: string): Promise<void> {
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, deletedAt: null },
      select: {
        chapter: {
          select: {
            book: {
              select: {
                projectId: true,
                project: { select: { userId: true } },
              },
            },
          },
        },
      },
    });
    if (!scene) {
      return;
    }

    const { projectId, project } = scene.chapter.book;
    const settings =
      await this.prisma.projectKnowledgeReviewSettings.findUnique({
        where: { projectId },
      });
    if (!settings || settings.stateTrackingEnabled === false) {
      if (
        settings?.relationshipReviewMode === KnowledgeReviewMode.AUTO_THRESHOLD
      ) {
        await this.autoApproveRelationships({
          userId: project.userId,
          projectId,
          sceneId,
          threshold: Number(settings.relationshipConfidenceThreshold),
        });
      }
      return;
    }

    if (settings.stateReviewMode === KnowledgeReviewMode.AUTO_THRESHOLD) {
      await this.autoApproveStates({
        userId: project.userId,
        projectId,
        sceneId,
        threshold: Number(settings.stateConfidenceThreshold),
      });
    }
    if (
      settings.relationshipReviewMode === KnowledgeReviewMode.AUTO_THRESHOLD
    ) {
      await this.autoApproveRelationships({
        userId: project.userId,
        projectId,
        sceneId,
        threshold: Number(settings.relationshipConfidenceThreshold),
      });
    }
  }

  private async autoApproveStates(input: {
    userId: string;
    projectId: string;
    sceneId: string;
    threshold: number;
  }): Promise<void> {
    const proposals = await this.prisma.entityStateProposal.findMany({
      where: {
        projectId: input.projectId,
        sceneId: input.sceneId,
        status: ProposalStatus.PENDING,
      },
      include: {
        sourceChunk: { select: { contentHash: true, isDirty: true } },
      },
      orderBy: [{ narrativeOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (proposals.length === 0) {
      return;
    }

    const groups = new Map<string, typeof proposals>();
    for (const proposal of proposals) {
      const key = `${proposal.entityId}:${proposal.attributeKey}:${proposal.sceneId}`;
      const group = groups.get(key) ?? [];
      group.push(proposal);
      groups.set(key, group);
    }

    const acceptedIds: string[] = [];
    for (const group of groups.values()) {
      const alternatives = new Set(
        group.map((proposal) => proposal.toValue?.trim().toLocaleLowerCase()),
      );
      const allFreshAndConfident = group.every((proposal) =>
        this.hasFreshEvidence(proposal, input.threshold),
      );
      const sequentialAndExplicit = group.every(
        (proposal) =>
          proposal.sequenceKind === StateProposalSequenceKind.TRANSITION,
      );
      if (
        !allFreshAndConfident ||
        group.some((proposal) => proposal.conflictsWithLocked) ||
        (alternatives.size > 1 && !sequentialAndExplicit) ||
        group.some(
          (proposal) =>
            proposal.sequenceKind === StateProposalSequenceKind.CONTRADICTION ||
            proposal.sequenceKind === StateProposalSequenceKind.UNCERTAIN,
        )
      ) {
        continue;
      }
      acceptedIds.push(...group.map((proposal) => proposal.id));
    }
    if (acceptedIds.length === 0) {
      return;
    }

    await this.temporalStates.acceptProposalSequence(
      input.userId,
      input.projectId,
      { acceptedProposalIds: acceptedIds, rejectedProposalIds: [] },
    );
  }

  private async autoApproveRelationships(input: {
    userId: string;
    projectId: string;
    sceneId: string;
    threshold: number;
  }): Promise<void> {
    const proposals = await this.prisma.relationshipProposal.findMany({
      where: {
        projectId: input.projectId,
        sceneId: input.sceneId,
        status: ProposalStatus.PENDING,
        sourceEntityId: { not: null },
        targetEntityId: { not: null },
        sourceEntityProposalId: null,
        targetEntityProposalId: null,
        confidenceScore: { gte: input.threshold },
      },
      include: {
        sourceChunk: { select: { contentHash: true, isDirty: true } },
      },
    });
    const fresh = proposals.filter(
      (proposal) =>
        proposal.sourceEntityId !== null &&
        proposal.targetEntityId !== null &&
        proposal.sourceEntityProposalId === null &&
        proposal.targetEntityProposalId === null &&
        proposal.sourceChunk !== null &&
        !proposal.sourceChunk.isDirty &&
        proposal.sourceChunkHash !== null &&
        proposal.sourceChunk.contentHash === proposal.sourceChunkHash &&
        this.hasEvidence(proposal.evidence),
    );
    const groups = new Map<string, typeof fresh>();
    for (const proposal of fresh) {
      const key = [
        proposal.sourceEntityId,
        proposal.targetEntityId,
        proposal.relationType,
        proposal.sceneId,
      ].join(':');
      const group = groups.get(key) ?? [];
      group.push(proposal);
      groups.set(key, group);
    }
    const eligible = [...groups.values()]
      .filter((group) => group.length === 1)
      .flat();
    await forEachSequentially(eligible, async (proposal) => {
      await this.relationshipProposals.acceptProposal(
        input.userId,
        proposal.id,
      );
    });
  }

  private hasFreshEvidence(
    proposal: {
      conflictsWithLocked: boolean;
      confidenceScore: { toNumber(): number };
      sourceChunkHash: string | null;
      sourceChunk: { contentHash: string | null; isDirty: boolean } | null;
      evidence: unknown;
    },
    threshold: number,
  ): boolean {
    return (
      !proposal.conflictsWithLocked &&
      proposal.confidenceScore.toNumber() >= threshold &&
      proposal.sourceChunk !== null &&
      !proposal.sourceChunk.isDirty &&
      proposal.sourceChunkHash !== null &&
      proposal.sourceChunk.contentHash === proposal.sourceChunkHash &&
      this.hasEvidence(proposal.evidence)
    );
  }

  private hasEvidence(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.some(
        (entry) => typeof entry === 'string' && entry.trim().length > 0,
      )
    );
  }
}
