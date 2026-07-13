import { SummaryService } from '../../../src/summary/summary.service';
import type {
  SummaryGenerationProvider,
  SummaryGenerationResult,
  SummaryVerificationResult,
} from '../../../src/summary/ports/summary-generation-provider.port';
import type { SummaryQueue } from '../../../src/summary/ports/summary-queue.port';
import type {
  SceneSummaryInput,
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
});

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
