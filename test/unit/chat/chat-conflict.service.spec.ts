import { AuditStatus } from '@prisma/client';
import { ChatConflictService } from '../../../src/chat/chat-conflict.service';
import type { ChatSource } from '../../../src/chat/domain/chat.types';
import type { PrismaService } from '../../../src/prisma/prisma.service';

describe('ChatConflictService', () => {
  const sources: ChatSource[] = [
    {
      id: 'manuscript:chunk-1',
      kind: 'manuscript',
      label: 'Capítulo 1',
      excerpt: 'Maren estaba en el archivo.',
      sceneId: 'scene-1',
      contentHash: 'current-hash',
    },
    {
      id: 'wiki:entity-1',
      kind: 'wiki',
      label: 'Maren',
      excerpt: 'Maren vive en el puerto.',
      entityId: 'entity-1',
    },
  ];
  const prisma = {
    auditAlert: { findMany: jest.fn() },
    chunk: { findMany: jest.fn() },
  };
  const service = new ChatConflictService(prisma as unknown as PrismaService);

  beforeEach(() => {
    prisma.auditAlert.findMany.mockReset();
    prisma.chunk.findMany.mockReset();
    prisma.chunk.findMany.mockResolvedValue([
      { id: 'chunk-1', contentHash: 'current-hash' },
    ]);
  });

  it('returns only active alerts tied to retrieved evidence in the project', async () => {
    prisma.auditAlert.findMany.mockResolvedValue([
      alert('open-1', 'chunk-1', 'current-hash'),
      alert('stale-1', 'chunk-1', 'old-hash'),
      alert('missing-1', 'chunk-gone', 'old-hash'),
      {
        ...alert('other-topic', null, null),
        title: 'Una espada cambia de dueño',
        description: 'La espada está en otro lugar.',
        sourceConflict: {},
      },
    ]);

    const result = await service.findRelevant(
      'project-1',
      '¿Dónde estaba Maren?',
      sources,
    );

    expect(result.map((item) => item.id)).toEqual(['open-1']);
    expect(result[0]).toMatchObject({
      entityName: 'Maren',
      field: 'location',
      currentValue: 'puerto',
      observedValue: 'archivo',
    });
    const calls = prisma.auditAlert.findMany.mock.calls as Array<
      [{ where: { projectId: string; status: AuditStatus } }]
    >;
    expect(calls[0]?.[0].where).toMatchObject({
      projectId: 'project-1',
      status: AuditStatus.ACTIVE,
    });
  });

  it('uses a matching Wiki entity when an alert has no linked chunk', async () => {
    prisma.auditAlert.findMany.mockResolvedValue([
      {
        ...alert('entity-alert', null, null),
        sceneId: 'another-scene',
        sourceConflict: { entityId: 'entity-1', entityName: 'Maren' },
      },
    ]);

    const result = await service.findRelevant(
      'project-1',
      '¿Qué sabemos de Maren?',
      [sources[1]!],
    );

    expect(result.map((item) => item.id)).toEqual(['entity-alert']);
  });

  it('does not warn about a location alert for an unrelated clothing question', async () => {
    prisma.auditAlert.findMany.mockResolvedValue([
      {
        ...alert('entity-alert', null, null),
        sourceConflict: {
          entityId: 'entity-1',
          entityName: 'Maren',
          field: 'location',
        },
      },
    ]);

    const result = await service.findRelevant(
      'project-1',
      '¿Qué vestía Maren?',
      [sources[1]!],
    );

    expect(result).toEqual([]);
  });

  it('skips the database when no retrieved source can identify a scene or entity', async () => {
    const result = await service.findRelevant('project-1', 'Pregunta', [
      {
        id: 'application_help:1',
        kind: 'application_help',
        label: 'Ayuda',
        excerpt: 'Texto',
      },
    ]);

    expect(result).toEqual([]);
    expect(prisma.auditAlert.findMany).not.toHaveBeenCalled();
  });
});

interface TestAlert {
  id: string;
  title: string;
  description: string;
  explanation: string;
  sceneId: string;
  sourceChunkId: string | null;
  sourceChunkHash: string | null;
  sourceConflict: {
    entityId: string;
    entityName: string;
    field: string;
    currentValue: string;
    observedValue: string;
  };
}

function alert(
  id: string,
  sourceChunkId: string | null,
  sourceChunkHash: string | null,
): TestAlert {
  return {
    id,
    title: 'Maren figura en dos lugares',
    description: 'El manuscrito y la Wiki discrepan sobre Maren.',
    explanation: 'Revisar la ubicación.',
    sceneId: 'scene-1',
    sourceChunkId,
    sourceChunkHash,
    sourceConflict: {
      entityId: 'entity-1',
      entityName: 'Maren',
      field: 'location',
      currentValue: 'puerto',
      observedValue: 'archivo',
    },
  };
}
