import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertWritingGoalDto } from './dto/upsert-writing-goal.dto';
import { WritingGoalType } from './domain/writing-goal-type';

const SESSION_GAP_MILLIS = 30 * 60 * 1000;
const MAX_ACTIVE_GAP_SECONDS = 5 * 60;
const INITIAL_ACTIVITY_SECONDS = 60;
const ACTIVITY_DAYS = 7;
const ESTIMATE_DAYS = 30;

interface SceneSaveActivity {
  userId: string;
  sceneId: string;
  previousWordCount: number;
  currentWordCount: number;
}

export interface DailyActivity {
  date: string;
  words: number;
  durationSecs: number;
  sessions: number;
}

export interface SessionSummary {
  id: string;
  sceneId: string | null;
  sceneTitle: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSecs: number;
  wordsAdded: number;
  wordsDeleted: number;
  wordsNet: number;
  avgWpm: number;
}

function localDateKey(date: Date, timezoneOffsetMinutes: number): string {
  return new Date(date.getTime() - timezoneOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}

function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStartKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const day = date.getUTCDay();
  return shiftDateKey(dateKey, -(day === 0 ? 6 : day - 1));
}

function calculateStreaks(activityKeys: Set<string>, todayKey: string) {
  const sorted = [...activityKeys].sort();
  let best = 0;
  let running = 0;
  let previous: string | null = null;

  for (const key of sorted) {
    running = previous && shiftDateKey(previous, 1) === key ? running + 1 : 1;
    best = Math.max(best, running);
    previous = key;
  }

  let cursor = activityKeys.has(todayKey)
    ? todayKey
    : shiftDateKey(todayKey, -1);
  let current = 0;
  while (activityKeys.has(cursor)) {
    current += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  return { current, best };
}

function decimalToNumber(value: Prisma.Decimal | number | null): number {
  return value === null ? 0 : Number(value);
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordSceneSave(activity: SceneSaveActivity): Promise<void> {
    const scene = await this.prisma.scene.findFirst({
      where: {
        id: activity.sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId: activity.userId } } },
      },
      select: {
        chapter: { select: { book: { select: { projectId: true } } } },
      },
    });

    if (!scene) {
      return;
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - SESSION_GAP_MILLIS);
    const wordsNet = activity.currentWordCount - activity.previousWordCount;
    const wordsAdded = Math.max(wordsNet, 0);
    const wordsDeleted = Math.max(-wordsNet, 0);
    const latestSession = await this.prisma.writingSession.findFirst({
      where: {
        userId: activity.userId,
        projectId: scene.chapter.book.projectId,
        sceneId: activity.sceneId,
        endedAt: { gte: cutoff },
      },
      orderBy: { endedAt: 'desc' },
    });

    if (!latestSession) {
      await this.prisma.writingSession.create({
        data: {
          userId: activity.userId,
          projectId: scene.chapter.book.projectId,
          sceneId: activity.sceneId,
          startedAt: new Date(now.getTime() - INITIAL_ACTIVITY_SECONDS * 1000),
          endedAt: now,
          durationSecs: INITIAL_ACTIVITY_SECONDS,
          wordsAdded,
          wordsDeleted,
          wordsNet,
          avgWpm: wordsAdded,
        },
      });
      return;
    }

    const lastActivityAt = latestSession.endedAt ?? latestSession.startedAt;
    const elapsedSeconds = Math.max(
      1,
      Math.round((now.getTime() - lastActivityAt.getTime()) / 1000),
    );
    const durationSecs =
      (latestSession.durationSecs ?? 0) +
      Math.min(elapsedSeconds, MAX_ACTIVE_GAP_SECONDS);
    const totalWordsAdded = latestSession.wordsAdded + wordsAdded;

    await this.prisma.writingSession.update({
      where: { id: latestSession.id },
      data: {
        endedAt: now,
        durationSecs,
        wordsAdded: totalWordsAdded,
        wordsDeleted: latestSession.wordsDeleted + wordsDeleted,
        wordsNet: latestSession.wordsNet + wordsNet,
        avgWpm:
          durationSecs > 0
            ? Number(((totalWordsAdded * 60) / durationSecs).toFixed(1))
            : 0,
      },
    });
  }

  async upsertGoal(
    userId: string,
    projectId: string,
    goalType: WritingGoalType,
    dto: UpsertWritingGoalDto,
  ) {
    await this.assertProjectAccess(userId, projectId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.writingGoal.findFirst({
        where: { userId, projectId, goalType, isActive: true },
        orderBy: { updatedAt: 'desc' },
      });
      const data = {
        targetWords: dto.targetWords,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        isActive: true,
      };

      if (existing) {
        return tx.writingGoal.update({ where: { id: existing.id }, data });
      }

      return tx.writingGoal.create({
        data: { userId, projectId, goalType, currentWords: 0, ...data },
      });
    });
  }

  async getDashboard(
    userId: string,
    projectId: string,
    timezoneOffsetMinutes = 0,
  ) {
    const safeTimezoneOffset = Math.max(
      -840,
      Math.min(840, timezoneOffsetMinutes),
    );
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: {
        id: true,
        title: true,
        wordCountTarget: true,
        books: {
          where: { deletedAt: null },
          orderBy: { sortKey: 'asc' },
          select: {
            id: true,
            title: true,
            chapters: {
              where: { deletedAt: null },
              orderBy: { sortKey: 'asc' },
              select: {
                id: true,
                title: true,
                scenes: {
                  where: { deletedAt: null },
                  orderBy: [{ order: 'asc' }, { sortKey: 'asc' }],
                  select: { id: true, title: true, wordCount: true },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const [sessions, goals] = await Promise.all([
      this.prisma.writingSession.findMany({
        where: { userId, projectId },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          sceneId: true,
          startedAt: true,
          endedAt: true,
          durationSecs: true,
          wordsAdded: true,
          wordsDeleted: true,
          wordsNet: true,
          avgWpm: true,
          scene: { select: { title: true } },
        },
      }),
      this.prisma.writingGoal.findMany({
        where: { userId, projectId, isActive: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const now = new Date();
    const todayKey = localDateKey(now, safeTimezoneOffset);
    const firstActivityKey = shiftDateKey(todayKey, -(ACTIVITY_DAYS - 1));
    const estimateStartKey = shiftDateKey(todayKey, -(ESTIMATE_DAYS - 1));
    const dailyMap = new Map<string, DailyActivity>();
    const activeDays = new Set<string>();
    let estimateWords = 0;
    const estimateActiveDays = new Set<string>();

    for (const session of sessions) {
      const key = localDateKey(session.startedAt, safeTimezoneOffset);
      activeDays.add(key);
      if (key >= estimateStartKey && key <= todayKey) {
        estimateWords += session.wordsAdded;
        if (session.wordsAdded > 0) {
          estimateActiveDays.add(key);
        }
      }
      if (key < firstActivityKey || key > todayKey) {
        continue;
      }
      const current = dailyMap.get(key) ?? {
        date: key,
        words: 0,
        durationSecs: 0,
        sessions: 0,
      };
      current.words += session.wordsAdded;
      current.durationSecs += session.durationSecs ?? 0;
      current.sessions += 1;
      dailyMap.set(key, current);
    }

    const dailyActivity = Array.from({ length: ACTIVITY_DAYS }, (_, index) => {
      const date = shiftDateKey(firstActivityKey, index);
      return (
        dailyMap.get(date) ?? { date, words: 0, durationSecs: 0, sessions: 0 }
      );
    });
    const totalWords = project.books.reduce(
      (projectTotal, book) =>
        projectTotal +
        book.chapters.reduce(
          (bookTotal, chapter) =>
            bookTotal +
            chapter.scenes.reduce(
              (chapterTotal, scene) => chapterTotal + scene.wordCount,
              0,
            ),
          0,
        ),
      0,
    );
    const hierarchy = project.books.map((book) => ({
      id: book.id,
      title: book.title,
      wordCount: book.chapters.reduce(
        (total, chapter) =>
          total +
          chapter.scenes.reduce((sum, scene) => sum + scene.wordCount, 0),
        0,
      ),
      chapters: book.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        wordCount: chapter.scenes.reduce(
          (total, scene) => total + scene.wordCount,
          0,
        ),
        scenes: chapter.scenes.map((scene) => ({
          id: scene.id,
          title: scene.title ?? 'Escena sin título',
          wordCount: scene.wordCount,
        })),
      })),
    }));
    const currentWeekStart = weekStartKey(todayKey);
    const periodWords = {
      DAILY: dailyMap.get(todayKey)?.words ?? 0,
      WEEKLY: sessions.reduce((total, session) => {
        const key = localDateKey(session.startedAt, safeTimezoneOffset);
        return key >= currentWeekStart && key <= todayKey
          ? total + session.wordsAdded
          : total;
      }, 0),
    };
    const latestGoals = new Map<string, (typeof goals)[number]>();
    for (const goal of goals) {
      if (!latestGoals.has(goal.goalType)) {
        latestGoals.set(goal.goalType, goal);
      }
    }
    const goalSummaries = [...latestGoals.values()].map((goal) => {
      const currentWords =
        goal.goalType === String(WritingGoalType.WEEKLY)
          ? periodWords.WEEKLY
          : periodWords.DAILY;
      return {
        id: goal.id,
        goalType: goal.goalType,
        targetWords: goal.targetWords,
        currentWords,
        deadline: goal.deadline,
        progressPercent: Math.min(
          100,
          Math.round((currentWords / goal.targetWords) * 100),
        ),
      };
    });
    const streaks = calculateStreaks(activeDays, todayKey);
    const averageDailyWords = estimateActiveDays.size
      ? Math.round(estimateWords / estimateActiveDays.size)
      : 0;
    const dailyGoal = latestGoals.get(WritingGoalType.DAILY);
    const weeklyGoal = latestGoals.get(WritingGoalType.WEEKLY);
    const paceWordsPerDay =
      averageDailyWords > 0
        ? averageDailyWords
        : dailyGoal && dailyGoal.targetWords > 0
          ? dailyGoal.targetWords
          : weeklyGoal
            ? Math.ceil(weeklyGoal.targetWords / 7)
            : 0;
    const remainingWords = Math.max(
      (project.wordCountTarget ?? 0) - totalWords,
      0,
    );
    const estimatedCompletionDate =
      project.wordCountTarget && paceWordsPerDay > 0
        ? new Date(
            now.getTime() +
              Math.ceil(remainingWords / paceWordsPerDay) * 86_400_000,
          )
        : null;
    const recentSessions: SessionSummary[] = sessions
      .slice(0, 10)
      .map((session) => ({
        id: session.id,
        sceneId: session.sceneId,
        sceneTitle: session.scene?.title ?? 'Escena sin título',
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSecs: session.durationSecs ?? 0,
        wordsAdded: session.wordsAdded,
        wordsDeleted: session.wordsDeleted,
        wordsNet: session.wordsNet,
        avgWpm: decimalToNumber(session.avgWpm),
      }));
    const totalSessionSeconds = sessions.reduce(
      (total, session) => total + (session.durationSecs ?? 0),
      0,
    );
    const totalWordsAdded = sessions.reduce(
      (total, session) => total + session.wordsAdded,
      0,
    );

    return {
      project: {
        id: project.id,
        title: project.title,
        wordCount: totalWords,
        wordCountTarget: project.wordCountTarget,
        progressPercent: project.wordCountTarget
          ? Math.min(
              100,
              Math.round((totalWords / project.wordCountTarget) * 100),
            )
          : null,
      },
      hierarchy,
      summary: {
        todayWords: periodWords.DAILY,
        weekWords: periodWords.WEEKLY,
        currentStreak: streaks.current,
        bestStreak: streaks.best,
        averageWpm:
          totalSessionSeconds > 0
            ? Math.round((totalWordsAdded * 60) / totalSessionSeconds)
            : 0,
        averageDailyWords,
        estimatedCompletionDate,
      },
      dailyActivity,
      recentSessions,
      goals: goalSummaries,
      generatedAt: now,
    };
  }

  private async assertProjectAccess(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
  }
}
