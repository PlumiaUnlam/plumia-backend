import type { StoryboardCardStatus } from '../domain/storyboard-card-status';

export const STORYBOARD_CARD_REPOSITORY = Symbol('STORYBOARD_CARD_REPOSITORY');
export const STORYBOARD_AUDIO_CLEANUP_EVENT =
  'storyboard.audio.cleanup.requested';

export interface StoryboardCardRecord {
  id: string;
  projectId: string;
  chapterId: string | null;
  title: string;
  description: string;
  status: StoryboardCardStatus;
  tags: string[];
  characters: string[];
  entityIds: string[];
  audioStorageKey: string | null;
  audioDurationSecs: number | null;
  sortKey: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateStoryboardCardData {
  projectId: string;
  chapterId?: string;
  title: string;
  description?: string;
  status?: StoryboardCardStatus;
  tags?: string[];
  characters?: string[];
  entityIds?: string[];
  sortKey?: string;
}

export interface UpdateStoryboardCardData {
  chapterId?: string | null;
  title?: string;
  description?: string;
  status?: StoryboardCardStatus;
  tags?: string[];
  characters?: string[];
  entityIds?: string[];
  sortKey?: string;
}

export interface StoryboardCardRepository {
  listForProject(
    userId: string,
    projectId: string,
  ): Promise<StoryboardCardRecord[] | null>;
  createForUser(
    userId: string,
    data: CreateStoryboardCardData,
  ): Promise<StoryboardCardRecord | null>;
  findByIdForUser(
    userId: string,
    cardId: string,
  ): Promise<StoryboardCardRecord | null>;
  updateForUser(
    userId: string,
    cardId: string,
    data: UpdateStoryboardCardData,
  ): Promise<StoryboardCardRecord | null>;
  attachAudioForUser(
    userId: string,
    cardId: string,
    audioStorageKey: string,
    audioDurationSecs: number,
  ): Promise<StoryboardCardRecord | null>;
  scheduleAudioCleanup(cardId: string, storageKey: string): Promise<void>;
  softDeleteForUser(
    userId: string,
    cardId: string,
    deletedAt: Date,
  ): Promise<StoryboardCardRecord | null>;
}
