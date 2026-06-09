import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSceneDto } from '../dto/scenes/create-scene.dto';
import { UpdateSceneContentDto } from '../dto/scenes/update-scene-content.dto';
import { UpdateSceneDto } from '../dto/scenes/update-scene.dto';
import {
  SCENE_REPOSITORY,
  type CreateSceneData,
  type SceneRecord,
  type SceneRepository,
} from '../ports/scene-repository.port';

@Injectable()
export class SceneService {
  constructor(
    @Inject(SCENE_REPOSITORY)
    private readonly sceneRepository: SceneRepository,
  ) {}

  async create(
    userId: string,
    chapterId: string,
    dto: CreateSceneDto,
  ): Promise<SceneRecord> {
    const data: CreateSceneData = {
      chapterId,
      sortKey: dto.sortKey,
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.content !== undefined ? { content: dto.content } : {}),
      ...(dto.wordCount !== undefined ? { wordCount: dto.wordCount } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.order !== undefined ? { order: dto.order } : {}),
    };

    const scene = await this.sceneRepository.createForUser(userId, data);

    if (!scene) {
      throw new NotFoundException('Chapter not found');
    }

    return scene;
  }

  async getById(userId: string, sceneId: string): Promise<SceneRecord> {
    const scene = await this.sceneRepository.findByIdForUser(userId, sceneId);

    if (!scene) {
      throw new NotFoundException('Scene not found');
    }

    return scene;
  }

  async update(
    userId: string,
    sceneId: string,
    dto: UpdateSceneDto,
  ): Promise<SceneRecord> {
    const scene = await this.sceneRepository.updateForUser(
      userId,
      sceneId,
      dto,
    );

    if (!scene) {
      throw new NotFoundException('Scene not found');
    }

    return scene;
  }

  async updateContent(
    userId: string,
    sceneId: string,
    dto: UpdateSceneContentDto,
  ): Promise<SceneRecord> {
    const scene = await this.sceneRepository.updateContentForUser(
      userId,
      sceneId,
      dto,
    );

    if (!scene) {
      throw new NotFoundException('Scene not found');
    }

    return scene;
  }

  async remove(userId: string, sceneId: string): Promise<SceneRecord> {
    const scene = await this.sceneRepository.softDeleteForUser(
      userId,
      sceneId,
      new Date(),
    );

    if (!scene) {
      throw new NotFoundException('Scene not found');
    }

    return scene;
  }
}
