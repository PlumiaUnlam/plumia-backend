import { RelationType } from '@prisma/client';
import { TemporalKnowledgeSnapshotService } from './temporal-knowledge-snapshot.service';

describe('TemporalKnowledgeSnapshotService relationship history', () => {
  it('includes relevant past relationships but keeps active and future scopes separate', async () => {
    const sceneRows = [
      {
        id: 'scene-1',
        title: 'El encuentro',
        order: 0,
        sortKey: 'scene-1',
        chapter: {
          title: 'Capitulo 1',
          sortKey: 'chapter-1',
          book: { title: 'Libro 1', sortKey: 'book-1' },
        },
      },
      {
        id: 'scene-2',
        title: 'La reunion',
        order: 0,
        sortKey: 'scene-2',
        chapter: {
          title: 'Capitulo 2',
          sortKey: 'chapter-2',
          book: { title: 'Libro 1', sortKey: 'book-1' },
        },
      },
      {
        id: 'scene-3',
        title: 'El futuro',
        order: 0,
        sortKey: 'scene-3',
        chapter: {
          title: 'Capitulo 3',
          sortKey: 'chapter-3',
          book: { title: 'Libro 1', sortKey: 'book-1' },
        },
      },
    ];
    const prisma = {
      scene: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'scene-2',
          chapter: {
            book: {
              projectId: 'project-1',
              project: {
                genreRules: null,
                knowledgeReviewSettings: { stateTrackingEnabled: false },
              },
            },
          },
        }),
        findMany: jest.fn().mockResolvedValue(sceneRows),
      },
      entity: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'alice',
            canonicalName: 'Alicia',
            aliases: [],
            type: 'CHARACTER',
            attributes: {},
          },
          {
            id: 'bob',
            canonicalName: 'Bruno',
            aliases: [],
            type: 'CHARACTER',
            attributes: {},
          },
          {
            id: 'clara',
            canonicalName: 'Clara',
            aliases: [],
            type: 'CHARACTER',
            attributes: {},
          },
          {
            id: 'dario',
            canonicalName: 'Dario',
            aliases: [],
            type: 'CHARACTER',
            attributes: {},
          },
        ]),
      },
      entityState: { findMany: jest.fn() },
      fact: { findMany: jest.fn().mockResolvedValue([]) },
      relationship: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'past',
            sourceEntityId: 'alice',
            targetEntityId: 'bob',
            relationType: RelationType.ENEMY,
            description: 'Se enfrentaron',
            confidenceScore: 0.9,
            validFromSceneId: 'scene-1',
            validToSceneId: 'scene-2',
          },
          {
            id: 'active',
            sourceEntityId: 'alice',
            targetEntityId: 'clara',
            relationType: RelationType.ROMANTIC,
            description: 'Son pareja',
            confidenceScore: 0.9,
            validFromSceneId: 'scene-1',
            validToSceneId: null,
          },
          {
            id: 'future',
            sourceEntityId: 'alice',
            targetEntityId: 'dario',
            relationType: RelationType.ALLY,
            description: 'Se aliaron',
            confidenceScore: 0.9,
            validFromSceneId: 'scene-3',
            validToSceneId: null,
          },
        ]),
      },
    };
    const service = new TemporalKnowledgeSnapshotService(prisma as never);

    const snapshot = await service.getSnapshot('scene-2');
    expect(snapshot).not.toBeNull();
    if (!snapshot) {
      throw new Error('Expected a temporal snapshot');
    }

    const context = service.toExtractionContext(snapshot, 'Alicia entra.');

    expect(context.relationships).toEqual([
      expect.objectContaining({
        sourceEntity: 'Alicia',
        targetEntity: 'Clara',
        relationType: RelationType.ROMANTIC,
      }),
    ]);
    expect(context.relationshipHistory).toEqual([
      expect.objectContaining({
        sourceEntity: 'Alicia',
        targetEntity: 'Bruno',
        relationType: RelationType.ENEMY,
        validFromScene: 'Libro 1 / Capitulo 1 / El encuentro',
        validToScene: 'Libro 1 / Capitulo 2 / La reunion',
      }),
    ]);
    expect(JSON.stringify(context)).not.toContain('Dario');
    expect(prisma.entityState.findMany).not.toHaveBeenCalled();
  });
});
