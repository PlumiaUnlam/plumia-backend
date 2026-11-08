import { type TemporalKnowledgeSnapshotService } from '../../audit/temporal-knowledge-snapshot.service';
import { type EntityExtractionClient } from './entity-extraction.client';
import { forEachSequentially } from './for-each-sequentially';
import {
  type AuditChunk,
  type KnownEntity,
  MAX_SCENE_GROUP_CHUNKS,
} from './cross-chunk-audit.types';
import {
  shouldAuditSceneGroup,
  findEntitiesInText,
} from './cross-chunk-audit.helpers';
import { type CrossChunkAuditPersistence } from './cross-chunk-audit.persistence';

export class SceneGroupAudit {
  constructor(
    private readonly extractionClient: EntityExtractionClient,
    private readonly temporalSnapshotService: TemporalKnowledgeSnapshotService,
    private readonly persistence: CrossChunkAuditPersistence,
  ) {}
  async auditSceneGroups(input: {
    sceneId: string;
    projectId: string;
    userId: string;
    chunks: AuditChunk[];
    knownEntities: KnownEntity[];
    snapshot: Awaited<
      ReturnType<TemporalKnowledgeSnapshotService['getSnapshot']>
    >;
    onlyDirtyChunkIds?: ReadonlySet<string>;
    activeFingerprints: Set<string>;
  }): Promise<void> {
    const chunks = [...input.chunks].sort(
      (left, right) => left.chunkIndex - right.chunkIndex,
    );
    const stride = MAX_SCENE_GROUP_CHUNKS - 1;
    const groupStarts = Array.from(
      { length: Math.ceil(Math.max(0, chunks.length - 1) / stride) },
      (_, index) => index * stride,
    );
    await forEachSequentially(groupStarts, (start) =>
      this.auditSceneGroup({ ...input, chunks }, start),
    );
  }

  private async auditSceneGroup(
    input: {
      sceneId: string;
      projectId: string;
      userId: string;
      chunks: AuditChunk[];
      knownEntities: KnownEntity[];
      snapshot: Awaited<
        ReturnType<TemporalKnowledgeSnapshotService['getSnapshot']>
      >;
      onlyDirtyChunkIds?: ReadonlySet<string>;
      activeFingerprints: Set<string>;
    },
    start: number,
  ): Promise<void> {
    const group = input.chunks.slice(start, start + MAX_SCENE_GROUP_CHUNKS);
    if (!shouldAuditSceneGroup(group, input.onlyDirtyChunkIds)) {
      return;
    }
    const nonEmpty = group.filter((chunk) => chunk.content.trim().length > 0);
    if (nonEmpty.length < 2) {
      return;
    }
    const groupText = nonEmpty.map((chunk) => chunk.content).join('\n');
    const groupEntities = findEntitiesInText(groupText, input.knownEntities);
    const contradictions = await this.extractionClient.auditSceneChunkGroup({
      userId: input.userId,
      chunks: nonEmpty.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        text: chunk.content.trim(),
      })),
      knownEntities: groupEntities.map((entity) => ({
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        type: entity.type,
        description: entity.description,
        attributes: entity.attributes,
      })),
      ...(input.snapshot
        ? {
            temporalContext: this.temporalSnapshotService.toExtractionContext(
              input.snapshot,
              groupText,
            ),
          }
        : {}),
    });
    await forEachSequentially(contradictions, (contradiction) =>
      this.persistSceneGroupContradiction({
        ...input,
        nonEmpty,
        contradiction,
      }),
    );
  }

  private async persistSceneGroupContradiction(input: {
    sceneId: string;
    projectId: string;
    nonEmpty: AuditChunk[];
    knownEntities: KnownEntity[];
    activeFingerprints: Set<string>;
    contradiction: Awaited<
      ReturnType<EntityExtractionClient['auditSceneChunkGroup']>
    >[number];
  }): Promise<void> {
    if (input.contradiction.kind === 'UNCERTAIN') {
      return;
    }
    const first = input.nonEmpty.find(
      (chunk) => chunk.chunkIndex === input.contradiction.firstChunkIndex,
    );
    const second = input.nonEmpty.find(
      (chunk) => chunk.chunkIndex === input.contradiction.secondChunkIndex,
    );
    if (!first || !second || first.id === second.id) {
      return;
    }
    await this.persistence.persistContradiction({
      projectId: input.projectId,
      sceneId: input.sceneId,
      first,
      second,
      contradiction: input.contradiction,
      knownEntities: input.knownEntities,
      activeFingerprints: input.activeFingerprints,
    });
  }
}
