/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { SummaryService } from '../../../src/summary/summary.service';
import type {
  SummaryGenerationProvider,
  SummaryGenerationResult,
  SummaryVerificationResult,
} from '../../../src/summary/ports/summary-generation-provider.port';
import type { SummaryQueue } from '../../../src/summary/ports/summary-queue.port';
import type {
  SceneSummaryInput,
  SummaryJobRecord,
  SummaryRecord,
  SummaryRepository,
} from '../../../src/summary/ports/summary-repository.port';

describe('SummaryService', () => {
  const scene: SceneSummaryInput = {
    id: 'scene-id',
    projectId: 'project-id',
    chapterId: 'chapter-id',
    title: 'Scene',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Eliana sees the blue light.' }],
        },
      ],
    },
    contentHash: 'content-hash',
    wordCount: 6,
  };

  let repository: jest.Mocked<SummaryRepository>;
  let generator: jest.Mocked<SummaryGenerationProvider>;
  let queue: jest.Mocked<SummaryQueue>;
  let service: SummaryService;

  beforeEach(() => {
    repository = {
      findSummary: jest.fn(),
      findSummaryByScope: jest.fn(),
      findSceneInput: jest.fn(),
      findSceneInputById: jest.fn(),
      findChapterInput: jest.fn(),
      findChapterInputById: jest.fn(),
      createOrGetJob: jest.fn(),
      findJobForUser: jest.fn(),
      markJobProcessing: jest.fn(),
      markJobCompleted: jest.fn(),
      markJobFailed: jest.fn(),
      upsertGenerated: jest.fn(),
      updateManual: jest.fn(),
      invalidateScene: jest.fn(),
    };
    generator = {
      generate: jest.fn(),
      verify: jest.fn(),
    };
    queue = {
      enqueueGeneration: jest.fn(),
      enqueueInvalidation: jest.fn(),
    };
    service = new SummaryService(repository, generator, queue);

    repository.findSceneInputById.mockResolvedValue(scene);
    repository.findSummaryByScope.mockResolvedValue(null);
  });

  it('persists a summary only after it passes factual verification', async () => {
    generator.generate.mockResolvedValue(
      generated('Eliana sees a blue light.'),
    );
    generator.verify.mockResolvedValue(approved());

    await service.processGeneration('job-id', 'scene', scene.id, true);

    expect(generator.verify).toHaveBeenCalledWith({
      scope: 'scene',
      sourceText: 'Eliana sees the blue light.',
      summary: 'Eliana sees a blue light.',
    });
    expect(repository.upsertGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Eliana sees a blue light.',
        provider: 'gemini',
        model: 'gemini-test',
        tokenCount: 25,
      }),
    );
    expect(repository.markJobCompleted).toHaveBeenCalledWith('job-id');
    expect(repository.markJobFailed).not.toHaveBeenCalled();
  });

  it('regenerates once with verifier corrections before persisting', async () => {
    generator.generate
      .mockResolvedValueOnce(generated('Eliana finds a message.'))
      .mockResolvedValueOnce(generated('Eliana sees a blue light.'));
    generator.verify
      .mockResolvedValueOnce(rejected('Remove the invented message.'))
      .mockResolvedValueOnce(approved());

    await service.processGeneration('job-id', 'scene', scene.id, true);

    expect(generator.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        revisionInstructions: 'Remove the invented message.',
      }),
    );
    expect(repository.upsertGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Eliana sees a blue light.',
        tokenCount: 50,
      }),
    );
  });

  it('fails the job instead of persisting when the corrected summary is still unfaithful', async () => {
    generator.generate.mockResolvedValue(generated('Invented event.'));
    generator.verify.mockResolvedValue(rejected('Remove invented event.'));

    await expect(
      service.processGeneration('job-id', 'scene', scene.id, true),
    ).rejects.toThrow('Summary failed factual verification');

    expect(repository.upsertGenerated).not.toHaveBeenCalled();
    expect(repository.markJobFailed).toHaveBeenCalledWith(
      'job-id',
      expect.stringContaining('Summary failed factual verification'),
    );
  });

  it('reuses clean scene summaries when generating a chapter', async () => {
    const chapter = {
      id: 'chapter-id',
      projectId: 'project-id',
      title: 'Chapter',
      scenes: [scene],
    };
    repository.findChapterInputById.mockResolvedValue(chapter);
    repository.findSummaryByScope.mockResolvedValue({
      id: 'summary-id',
      projectId: 'project-id',
      parentSummaryId: null,
      scopeType: 'scene',
      scopeId: scene.id,
      title: 'Scene',
      content: 'Eliana sees the blue light.',
      source: 'ai_generated',
      sourceContentHash: 'content-hash',
      provider: 'gemini',
      model: 'gemini-test',
      isDirty: false,
      tokenCount: 20,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    generator.generate.mockResolvedValue(generated('Chapter summary.'));
    generator.verify.mockResolvedValue(approved());

    await service.processGeneration('job-id', 'chapter', chapter.id, true);

    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Eliana sees the blue light.' }),
    );
    expect(repository.upsertGenerated).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: 'chapter', scopeId: chapter.id }),
    );
  });

  it('retrieves summaries, jobs, and manual edits with not-found handling', async () => {
    const summary = makeSummary({ id: 'summary-1', scopeId: scene.id });
    const job = makeJob({ id: 'job-1' });
    repository.findSummary.mockResolvedValue(summary);
    repository.findJobForUser.mockResolvedValue(job);
    repository.updateManual.mockResolvedValue({
      ...summary,
      source: 'author_manual',
      content: 'Author summary',
    });

    await expect(
      service.getSummary('user-1', 'scene', scene.id),
    ).resolves.toEqual(summary);
    await expect(service.getJob('user-1', 'job-1')).resolves.toEqual(job);
    await expect(
      service.updateManual('user-1', 'summary-1', 'Author summary'),
    ).resolves.toMatchObject({
      source: 'author_manual',
      content: 'Author summary',
    });
    expect(repository.findSummary).toHaveBeenCalledWith(
      'user-1',
      'scene',
      scene.id,
    );
    expect(repository.findJobForUser).toHaveBeenCalledWith('user-1', 'job-1');
    expect(repository.updateManual).toHaveBeenCalledWith(
      'user-1',
      'summary-1',
      'Author summary',
    );

    repository.findSummary.mockResolvedValue(null);
    repository.findJobForUser.mockResolvedValue(null);
    repository.updateManual.mockResolvedValue(null);
    await expect(
      service.getSummary('user-1', 'scene', scene.id),
    ).rejects.toThrow('Summary not found');
    await expect(service.getJob('user-1', 'missing')).rejects.toThrow(
      'Summary job not found',
    );
    await expect(
      service.updateManual('user-1', 'missing', 'Edit'),
    ).rejects.toThrow('Summary not found');
  });

  it('creates deterministic scene and chapter generation jobs and queues only new work', async () => {
    const queued = makeJob({
      id: 'job-queued',
      status: 'QUEUED' as SummaryJobRecord['status'],
    });
    repository.findSceneInput.mockResolvedValue(scene);
    repository.createOrGetJob.mockResolvedValue(queued);

    await expect(
      service.requestGeneration('user-1', 'scene', scene.id),
    ).resolves.toEqual(queued);
    expect(repository.createOrGetJob).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectId: scene.projectId,
        scope: 'scene',
        scopeId: scene.id,
        inputHash: expect.any(String),
        force: true,
        bullJobId: expect.stringMatching(/^summary-scene-scene-id-/),
      }),
    );
    expect(queue.enqueueGeneration).toHaveBeenCalledWith(
      {
        summaryJobId: 'job-queued',
        scope: 'scene',
        scopeId: scene.id,
        force: true,
      },
      1,
    );

    const chapter = {
      id: 'chapter-id',
      projectId: scene.projectId,
      title: 'Chapter',
      scenes: [scene],
    };
    repository.findChapterInput.mockResolvedValue(chapter);
    repository.createOrGetJob.mockResolvedValue({
      ...queued,
      id: 'job-running',
      status: 'PROCESSING' as SummaryJobRecord['status'],
    });
    await service.requestGeneration('user-1', 'chapter', chapter.id);
    expect(repository.createOrGetJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ scope: 'chapter', scopeId: 'chapter-id' }),
    );
    expect(queue.enqueueGeneration).toHaveBeenCalledTimes(1);

    repository.findSceneInput.mockResolvedValue(null);
    await expect(
      service.requestGeneration('user-1', 'scene', 'missing'),
    ).rejects.toThrow('Scene not found');
  });

  it('completes without overwriting manual summaries when generation is not forced', async () => {
    repository.findSummaryByScope.mockResolvedValue(
      makeSummary({ source: 'author_manual' }),
    );

    await expect(
      service.processGeneration('job-1', 'scene', scene.id, false),
    ).resolves.toBeUndefined();
    expect(repository.markJobProcessing).toHaveBeenCalledWith('job-1');
    expect(repository.markJobCompleted).toHaveBeenCalledWith('job-1');
    expect(generator.generate).not.toHaveBeenCalled();
    expect(repository.upsertGenerated).not.toHaveBeenCalled();
  });

  it('marks missing or changed source content as a failed generation', async () => {
    repository.findSceneInputById.mockResolvedValue(null);
    await expect(
      service.processGeneration('job-missing', 'scene', scene.id, true),
    ).rejects.toThrow('Scene not found');
    expect(repository.markJobFailed).toHaveBeenCalledWith(
      'job-missing',
      'Scene not found',
    );

    repository.findSceneInputById
      .mockResolvedValueOnce(scene)
      .mockResolvedValueOnce({ ...scene, contentHash: 'new-hash' });
    repository.findSummaryByScope.mockResolvedValue(null);
    generator.generate.mockResolvedValue(generated('Faithful summary.'));
    generator.verify.mockResolvedValue(approved());
    await expect(
      service.processGeneration('job-stale', 'scene', scene.id, true),
    ).rejects.toThrow('Source changed while generating summary');
    expect(repository.upsertGenerated).not.toHaveBeenCalled();
    expect(repository.markJobFailed).toHaveBeenLastCalledWith(
      'job-stale',
      'Source changed while generating summary',
    );
  });

  it('requeues only generated summaries affected by scene changes', async () => {
    const sceneSummary = makeSummary({
      id: 'scene-summary',
      scopeType: 'scene',
      scopeId: scene.id,
    });
    const chapterSummary = makeSummary({
      id: 'chapter-summary',
      scopeType: 'chapter',
      scopeId: 'chapter-id',
    });
    const manualSummary = makeSummary({
      id: 'manual',
      source: 'author_manual',
      scopeType: 'scene',
    });
    repository.invalidateScene.mockResolvedValue({
      scene: sceneSummary,
      chapter: chapterSummary,
    });
    repository.findSceneInputById.mockResolvedValue(scene);
    repository.findChapterInputById.mockResolvedValue({
      id: 'chapter-id',
      projectId: scene.projectId,
      title: 'Chapter',
      scenes: [scene],
    });
    repository.createOrGetJob.mockResolvedValue(
      makeJob({
        id: 'requeued',
        status: 'QUEUED' as SummaryJobRecord['status'],
      }),
    );

    await service.processInvalidation(scene.id, 'chapter-id');
    expect(repository.invalidateScene).toHaveBeenCalledWith(
      scene.id,
      'chapter-id',
    );
    expect(repository.createOrGetJob).toHaveBeenCalledTimes(2);
    expect(queue.enqueueGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ force: false }),
      10,
    );

    repository.invalidateScene.mockResolvedValue({
      scene: manualSummary,
      chapter: null,
    });
    repository.createOrGetJob.mockClear();
    queue.enqueueGeneration.mockClear();
    await service.processInvalidation(scene.id, 'chapter-id');
    expect(repository.createOrGetJob).not.toHaveBeenCalled();
    expect(queue.enqueueGeneration).not.toHaveBeenCalled();

    repository.invalidateScene.mockResolvedValue({
      scene: sceneSummary,
      chapter: null,
    });
    repository.findSceneInputById.mockResolvedValue(null);
    await service.processInvalidation(scene.id, 'chapter-id');
    expect(repository.createOrGetJob).not.toHaveBeenCalled();
  });

  it('rejects empty scene or chapter content instead of asking the provider', async () => {
    repository.findSceneInputById.mockResolvedValue({
      ...scene,
      content: { type: 'doc', content: [] },
    });
    await expect(
      service.processGeneration('job-empty-scene', 'scene', scene.id, true),
    ).rejects.toThrow('Scene has no text to summarize');
    repository.findChapterInputById.mockResolvedValue({
      id: 'chapter-id',
      projectId: scene.projectId,
      title: 'Empty',
      scenes: [],
    });
    await expect(
      service.processGeneration(
        'job-empty-chapter',
        'chapter',
        'chapter-id',
        true,
      ),
    ).rejects.toThrow('Chapter has no scenes to summarize');
    expect(generator.generate).not.toHaveBeenCalled();
  });
});

function makeSummary(overrides: Partial<SummaryRecord> = {}): SummaryRecord {
  return {
    id: 'summary-id',
    projectId: 'project-id',
    parentSummaryId: null,
    scopeType: 'scene',
    scopeId: 'scene-id',
    title: 'Scene',
    content: 'Existing summary',
    source: 'ai_generated',
    sourceContentHash: 'content-hash',
    provider: 'gemini',
    model: 'gemini-test',
    isDirty: false,
    tokenCount: 12,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<SummaryJobRecord> = {}): SummaryJobRecord {
  return {
    id: 'job-id',
    projectId: 'project-id',
    scopeType: 'scene',
    scopeId: 'scene-id',
    inputHash: 'hash',
    status: 'QUEUED',
    progress: 0,
    force: false,
    bullJobId: null,
    errorMessage: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function generated(content: string): SummaryGenerationResult {
  return {
    content,
    inputTokens: 10,
    outputTokens: 5,
    provider: 'gemini',
    model: 'gemini-test',
  };
}

function approved(): SummaryVerificationResult {
  return {
    approved: true,
    violations: [],
    inputTokens: 8,
    outputTokens: 2,
    provider: 'gemini',
    model: 'gemini-test',
  };
}

function rejected(violation: string): SummaryVerificationResult {
  return { ...approved(), approved: false, violations: [violation] };
}
