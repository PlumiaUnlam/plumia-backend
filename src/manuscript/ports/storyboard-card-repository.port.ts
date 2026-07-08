import type { StoryboardCardStatus } from '../domain/storyboard-card-status';

export const STORYBOARD_CARD_REPOSITORY = Symbol('STORYBOARD_CARD_REPOSITORY');

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
  softDeleteForUser(
    userId: string,
    cardId: string,
    deletedAt: Date,
  ): Promise<StoryboardCardRecord | null>;
}
