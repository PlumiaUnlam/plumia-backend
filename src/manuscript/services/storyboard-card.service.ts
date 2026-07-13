import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStoryboardCardDto } from '../dto/storyboard/create-storyboard-card.dto';
import { UpdateStoryboardCardDto } from '../dto/storyboard/update-storyboard-card.dto';
import {
  STORYBOARD_CARD_REPOSITORY,
  type CreateStoryboardCardData,
  type StoryboardCardRecord,
  type StoryboardCardRepository,
  type UpdateStoryboardCardData,
} from '../ports/storyboard-card-repository.port';

type StoryboardCardFields = Omit<
  CreateStoryboardCardData,
  'projectId' | 'title'
>;

@Injectable()
export class StoryboardCardService {
  constructor(
    @Inject(STORYBOARD_CARD_REPOSITORY)
    private readonly storyboardCardRepository: StoryboardCardRepository,
  ) {}

  async listByProject(
    userId: string,
    projectId: string,
  ): Promise<StoryboardCardRecord[]> {
    const cards = await this.storyboardCardRepository.listForProject(
      userId,
      projectId,
    );

    if (!cards) {
      throw new NotFoundException('Project not found');
    }

    return cards;
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreateStoryboardCardDto,
  ): Promise<StoryboardCardRecord> {
    const data: CreateStoryboardCardData = {
      projectId,
      title: dto.title,
      ...getProvidedCardFields(dto),
    };

    const card = await this.storyboardCardRepository.createForUser(
      userId,
      data,
    );

    if (!card) {
      throw new NotFoundException('Project or chapter not found');
    }

    return card;
  }

  async update(
    userId: string,
    cardId: string,
    dto: UpdateStoryboardCardDto,
  ): Promise<StoryboardCardRecord> {
    const data: UpdateStoryboardCardData = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...getProvidedCardFields(dto),
    };

    const card = await this.storyboardCardRepository.updateForUser(
      userId,
      cardId,
      data,
    );

    if (!card) {
      throw new NotFoundException('Storyboard card not found');
    }

    return card;
  }

  async remove(userId: string, cardId: string): Promise<StoryboardCardRecord> {
    const card = await this.storyboardCardRepository.softDeleteForUser(
      userId,
      cardId,
      new Date(),
    );

    if (!card) {
      throw new NotFoundException('Storyboard card not found');
    }

    return card;
  }
}

function getProvidedCardFields(
  dto: CreateStoryboardCardDto | UpdateStoryboardCardDto,
): StoryboardCardFields {
  return {
    ...(dto.description !== undefined
      ? { description: dto.description }
      : {}),
    ...(dto.status !== undefined ? { status: dto.status } : {}),
    ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
    ...(dto.characters !== undefined ? { characters: dto.characters } : {}),
    ...(dto.entityIds !== undefined ? { entityIds: dto.entityIds } : {}),
    ...(dto.chapterId !== undefined ? { chapterId: dto.chapterId } : {}),
    ...(dto.sortKey !== undefined ? { sortKey: dto.sortKey } : {}),
  };
}
