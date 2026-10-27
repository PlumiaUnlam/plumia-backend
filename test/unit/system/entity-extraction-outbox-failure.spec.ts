/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any. */
import {
  KnowledgeAnalysisRunStatus,
  KnowledgeAnalysisSceneStatus,
} from '@prisma/client';
import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { EntityExtractionPipelineService } from '../../../src/system/entity-extraction/entity-extraction-pipeline.service';

describe('EntityExtractionPipelineService terminal outbox failures', () => {
  it('fails a project run and restores dirty chunks so the author can retry', async () => {
    const tx = {
      outbox: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      chunk: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      knowledgeAnalysisRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1',
          scenes: [
            {
              id: 'run-scene-1',
              sceneId: 'scene-1',
              narrativePosition: 0,
              status: KnowledgeAnalysisSceneStatus.RUNNING,
            },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      knowledgeAnalysisRunScene: {
        update: jest.fn().mockResolvedValue({}),
        count: jest
          .fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0),
      },
    };
    const prisma = {
      outbox: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'outbox-1',
          aggregateType: 'Project',
          aggregateId: 'project-1',
          eventType: 'project_analysis_requested',
          payload: { runId: 'run-1' },
        }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<void>) =>
        callback(tx),
      ),
    };
    const service = new EntityExtractionPipelineService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const logger = Reflect.get(service, 'logger') as Logger;
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    await service.markOutboxEventFailed('outbox-1', new Error('model timeout'));

    expect(tx.knowledgeAnalysisRunScene.update).toHaveBeenCalledWith({
      where: { id: 'run-scene-1' },
      data: {
        status: KnowledgeAnalysisSceneStatus.FAILED,
        error: expect.stringContaining('No se pudo completar'),
      },
    });
    expect(tx.chunk.updateMany).toHaveBeenCalledWith({
      where: { sceneId: { in: ['scene-1'] } },
      data: { isDirty: true },
    });
    expect(tx.knowledgeAnalysisRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        status: KnowledgeAnalysisRunStatus.FAILED,
        processedScenes: 1,
        failedScenes: 1,
        completedAt: expect.any(Date),
      },
    });
    expect(tx.outbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1', processedAt: null },
        data: expect.objectContaining({
          payload: expect.objectContaining({ analysisStatus: 'FAILED' }),
        }),
      }),
    );
  });
});
