import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from '../../../src/analytics/analytics.service';
import { PrismaService } from '../../../src/prisma/prisma.service';

describe('AnalyticsService', () => {
  const prisma = {
    project: { findFirst: jest.fn() },
    scene: { findFirst: jest.fn() },
    writingSession: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    writingGoal: { findMany: jest.fn() },
  };
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-26T15:00:00.000Z'));
    service = new AnalyticsService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aggregates manuscript counts, activity, goals and streaks', async () => {
    prisma.project.findFirst.mockResolvedValue({
      id: 'project-1',
      title: 'La novela',
      wordCountTarget: 10_000,
      books: [
        {
          id: 'book-1',
          title: 'Libro I',
          chapters: [
            {
              id: 'chapter-1',
              title: 'Capítulo I',
              scenes: [
                { id: 'scene-1', title: 'Apertura', wordCount: 1200 },
                { id: 'scene-2', title: null, wordCount: 800 },
              ],
            },
          ],
        },
      ],
    });
    prisma.writingSession.findMany.mockResolvedValue([
      {
        id: 'session-1',
        sceneId: 'scene-1',
        startedAt: new Date('2026-09-26T14:00:00.000Z'),
        endedAt: new Date('2026-09-26T14:10:00.000Z'),
        durationSecs: 600,
        wordsAdded: 300,
        wordsDeleted: 20,
        wordsNet: 280,
        avgWpm: 30,
        scene: { title: 'Apertura' },
      },
      {
        id: 'session-2',
        sceneId: 'scene-1',
        startedAt: new Date('2026-09-25T14:00:00.000Z'),
        endedAt: new Date('2026-09-25T14:05:00.000Z'),
        durationSecs: 300,
        wordsAdded: 100,
        wordsDeleted: 0,
        wordsNet: 100,
        avgWpm: 20,
        scene: { title: 'Apertura' },
      },
    ]);
    prisma.writingGoal.findMany.mockResolvedValue([
      {
        id: 'goal-1',
        goalType: 'DAILY',
        targetWords: 500,
        deadline: null,
        updatedAt: new Date(),
      },
    ]);

    const result = await service.getDashboard('user-1', 'project-1', 0);

    expect(result.project.wordCount).toBe(2000);
    expect(result.summary.todayWords).toBe(300);
    expect(result.summary.currentStreak).toBe(2);
    expect(result.summary.averageWpm).toBe(27);
    expect(result.goals[0]?.progressPercent).toBe(60);
    expect(result.hierarchy[0]?.chapters[0]?.scenes[1]?.title).toBe(
      'Escena sin título',
    );
  });

  it('rejects dashboards for projects outside the user scope', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(service.getDashboard('user-1', 'project-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('creates a writing session from a scene word-count change', async () => {
    prisma.scene.findFirst.mockResolvedValue({
      chapter: { book: { projectId: 'project-1' } },
    });
    prisma.writingSession.findFirst.mockResolvedValue(null);
    prisma.writingSession.create.mockResolvedValue({ id: 'session-1' });

    await service.recordSceneSave({
      userId: 'user-1',
      sceneId: 'scene-1',
      previousWordCount: 100,
      currentWordCount: 145,
    });

    expect(prisma.writingSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        userId: 'user-1',
        sceneId: 'scene-1',
        durationSecs: 60,
        wordsAdded: 45,
        wordsDeleted: 0,
        wordsNet: 45,
        avgWpm: 45,
      }) as unknown,
    });
  });
});
