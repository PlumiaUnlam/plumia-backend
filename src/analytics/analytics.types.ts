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

export interface AnalyticsDashboard {
  project: {
    id: string;
    title: string;
    wordCount: number;
    wordCountTarget: number | null;
    progressPercent: number | null;
  };
  hierarchy: Array<{
    id: string;
    title: string;
    wordCount: number;
    chapters: Array<{
      id: string;
      title: string;
      wordCount: number;
      scenes: Array<{ id: string; title: string; wordCount: number }>;
    }>;
  }>;
  summary: {
    todayWords: number;
    weekWords: number;
    currentStreak: number;
    bestStreak: number;
    averageWpm: number;
    averageDailyWords: number;
    estimatedCompletionDate: Date | null;
  };
  dailyActivity: DailyActivity[];
  recentSessions: SessionSummary[];
  goals: Array<{
    id: string;
    goalType: string;
    targetWords: number;
    currentWords: number;
    deadline: Date | null;
    progressPercent: number;
  }>;
  generatedAt: Date;
}
