import { RelationType } from '@prisma/client';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { TemporalKnowledgeSnapshotService } from '../../../src/audit/temporal-knowledge-snapshot.service';

describe('TemporalKnowledgeSnapshotService', () => {
  const prisma = {
    scene: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    entity: { findMany: jest.fn() },
    entityState: { findMany: jest.fn() },
    fact: { findMany: jest.fn() },
    relationship: { findMany: jest.fn() },
  };
  const service = new TemporalKnowledgeSnapshotService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scene.findFirst.mockResolvedValue({
      id: 'scene-one',
      chapter: {
        book: {
          projectId: 'project-one',
          project: { genreRules: { magic: 'Requiere contacto visual.' } },
        },
      },
    });
    prisma.scene.findMany.mockResolvedValue([
      {
        id: 'scene-one',
        order: 1,
        sortKey: 'a',
        chapter: { sortKey: 'a', book: { sortKey: 'a' } },
      },
      {
        id: 'scene-two',
        order: 2,
        sortKey: 'b',
        chapter: { sortKey: 'a', book: { sortKey: 'a' } },
      },
    ]);
    prisma.entity.findMany.mockResolvedValue([
      {
        id: 'elena',
        canonicalName: 'Elena',
        aliases: ['Eli'],
        type: 'CHARACTER',
        attributes: {},
      },
    ]);
    prisma.entityState.findMany.mockResolvedValue([
      {
        id: 'state-past',
        entityId: 'elena',
        attributeKey: 'status',
        toValue: 'dead',
        validFromSceneId: 'scene-one',
        validToSceneId: null,
      },
      {
        id: 'state-future',
        entityId: 'elena',
        attributeKey: 'location',
        toValue: 'Torre',
        validFromSceneId: 'scene-two',
        validToSceneId: null,
      },
    ]);
    prisma.fact.findMany.mockResolvedValue([
      {
        entityId: 'elena',
        content: 'Conoce el puerto.',
        sourceSceneId: 'scene-one',
      },
      {
        entityId: 'elena',
        content: 'Viaja a la torre.',
        sourceSceneId: 'scene-two',
      },
    ]);
    prisma.relationship.findMany.mockResolvedValue([
      {
        id: 'relation-global',
        sourceEntityId: 'elena',
        targetEntityId: 'elena',
        relationType: RelationType.KNOWS,
        description: null,
        validFromSceneId: null,
        validToSceneId: null,
      },
      {
        id: 'relation-future',
        sourceEntityId: 'elena',
        targetEntityId: 'elena',
        relationType: RelationType.KNOWS,
        description: null,
        validFromSceneId: 'scene-two',
        validToSceneId: null,
      },
    ]);
  });

  it('excludes states, facts, and relationships that begin in future scenes', async () => {
    const snapshot = await service.getSnapshot('scene-one');

    expect(snapshot?.activeStates.map((state) => state.id)).toEqual([
      'state-past',
    ]);
    expect(snapshot?.activeFacts).toEqual([
      { entityId: 'elena', content: 'Conoce el puerto.' },
    ]);
    expect(
      snapshot?.activeRelationships.map((relationship) => relationship.id),
    ).toEqual(['relation-global']);
  });

  it('exposes deceased relevant entities and world rules to the extractor', async () => {
    const snapshot = await service.getSnapshot('scene-one');
    if (!snapshot) {
      throw new Error('Expected a temporal snapshot');
    }

    const context = service.toExtractionContext(
      snapshot,
      'Elena abre la puerta del puerto.',
    );

    expect(context.deceasedEntityNames).toEqual(['Elena']);
    expect(context.entities[0]?.facts).toEqual(['Conoce el puerto.']);
    expect(context.worldRules).toEqual({ magic: 'Requiere contacto visual.' });
  });
});
