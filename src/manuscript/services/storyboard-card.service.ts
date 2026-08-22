import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { AttachStoryboardAudioDto } from '../dto/storyboard/attach-storyboard-audio.dto';
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
  private readonly logger = new Logger(StoryboardCardService.name);

  constructor(
    @Inject(STORYBOARD_CARD_REPOSITORY)
    private readonly storyboardCardRepository: StoryboardCardRepository,
    private readonly storageService: StorageService,
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
    const existing = await this.storyboardCardRepository.findByIdForUser(
      userId,
      cardId,
    );

    if (!existing) {
      throw new NotFoundException('Storyboard card not found');
    }

    const card = await this.storyboardCardRepository.softDeleteForUser(
      userId,
      cardId,
      new Date(),
    );

    if (!card) {
      throw new NotFoundException('Storyboard card not found');
    }

    await this.deleteAudio(cardId, card.audioStorageKey);
    if (
      existing.audioStorageKey &&
      existing.audioStorageKey !== card.audioStorageKey
    ) {
      await this.deleteAudio(cardId, existing.audioStorageKey);
    }

    return card;
  }

  async attachAudio(
    userId: string,
    cardId: string,
    dto: AttachStoryboardAudioDto,
  ): Promise<StoryboardCardRecord> {
    const existing = await this.storyboardCardRepository.findByIdForUser(
      userId,
      cardId,
    );

    if (!existing) {
      throw new NotFoundException('Storyboard card not found');
    }

    const expectedPrefix = `storyboard-audio/${cardId}/`;
    if (
      !dto.audioStorageKey.startsWith(expectedPrefix) ||
      dto.audioStorageKey.slice(expectedPrefix.length).includes('/')
    ) {
      throw new BadRequestException('La clave del audio no es válida.');
    }

    if (!(await this.storageService.headFile(dto.audioStorageKey))) {
      throw new BadRequestException(
        'El archivo de audio no se encontró en R2.',
      );
    }

    const card = await this.storyboardCardRepository.attachAudioForUser(
      userId,
      cardId,
      dto.audioStorageKey,
      dto.audioDurationSecs,
    );

    if (!card) {
      throw new NotFoundException('Storyboard card not found');
    }

    if (
      existing.audioStorageKey &&
      existing.audioStorageKey !== dto.audioStorageKey
    ) {
      await this.deleteAudio(cardId, existing.audioStorageKey);
    }

    return card;
  }

  async getAudioUrl(userId: string, cardId: string): Promise<string> {
    const card = await this.storyboardCardRepository.findByIdForUser(
      userId,
      cardId,
    );

    if (!card) {
      throw new NotFoundException('Storyboard card not found');
    }
    if (!card.audioStorageKey) {
      throw new NotFoundException('Storyboard card has no audio');
    }

    return this.storageService.generatePresignedGetUrl(card.audioStorageKey);
  }

  private async deleteAudio(
    cardId: string,
    storageKey: string | null,
  ): Promise<void> {
    if (!storageKey) {
      return;
    }

    try {
      await this.storageService.deleteObject(storageKey);
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo eliminar el audio ${storageKey} de R2. Se reintentará la limpieza.`,
        error instanceof Error ? error.stack : undefined,
      );
      try {
        await this.storyboardCardRepository.scheduleAudioCleanup(
          cardId,
          storageKey,
        );
      } catch (scheduleError: unknown) {
        this.logger.error(
          `No se pudo registrar la limpieza pendiente del audio ${storageKey}.`,
          scheduleError instanceof Error ? scheduleError.stack : undefined,
        );
      }
    }
  }
}

function getProvidedCardFields(
  dto: CreateStoryboardCardDto | UpdateStoryboardCardDto,
): StoryboardCardFields {
  return {
    ...(dto.description !== undefined ? { description: dto.description } : {}),
    ...(dto.status !== undefined ? { status: dto.status } : {}),
    ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
    ...(dto.characters !== undefined ? { characters: dto.characters } : {}),
    ...(dto.entityIds !== undefined ? { entityIds: dto.entityIds } : {}),
    ...(dto.chapterId !== undefined ? { chapterId: dto.chapterId } : {}),
    ...(dto.sortKey !== undefined ? { sortKey: dto.sortKey } : {}),
  };
}
