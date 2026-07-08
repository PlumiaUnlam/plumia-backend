import type { StoryboardCardRecord } from '../../ports/storyboard-card-repository.port';

export class StoryboardCardResponseDto {
  id!: string;
  projectId!: string;
  chapterId!: string | null;
  title!: string;
  description!: string;
  status!: string;
  tags!: string[];
  characters!: string[];
  entityIds!: string[];
  sortKey!: string;
  createdAt!: string;
  updatedAt!: string;

  static from(card: StoryboardCardRecord): StoryboardCardResponseDto {
    return {
      id: card.id,
      projectId: card.projectId,
      chapterId: card.chapterId,
      title: card.title,
      description: card.description,
      status: card.status,
      tags: card.tags,
      characters: card.characters,
      entityIds: card.entityIds,
      sortKey: card.sortKey,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    };
  }
}
