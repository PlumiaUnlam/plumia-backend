import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSceneDto } from '../dto/scenes/create-scene.dto';
import { CreateSceneVersionDto } from '../dto/scenes/create-scene-version.dto';
import { UpdateSceneVersionDto } from '../dto/scenes/update-scene-version.dto';
import { UpdateSceneContentDto } from '../dto/scenes/update-scene-content.dto';
import { UpdateSceneMetadataDto } from '../dto/scenes/update-scene-metadata.dto';
import {
  SCENE_REPOSITORY,
  type CreateSceneData,
  type SceneContentUpdateResult,
  type SceneRecord,
  type SceneRepository,
  type SceneVersionContentUpdateResult,
  type SceneVersionRecord,
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
    dto: UpdateSceneMetadataDto,
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
  ): Promise<SceneContentUpdateResult> {
    const result = await this.sceneRepository.updateContentForUser(
      userId,
      sceneId,
      dto,
    );

    if (!result) {
      throw new NotFoundException('Scene not found');
    }

    return result;
  }

  async listVersions(
    userId: string,
    sceneId: string,
  ): Promise<SceneVersionRecord[]> {
    const versions = await this.sceneRepository.listVersionsForUser(
      userId,
      sceneId,
    );

    if (!versions) {
      throw new NotFoundException('Scene not found');
    }

    return versions;
  }

  async createVersion(
    userId: string,
    sceneId: string,
    dto: CreateSceneVersionDto,
  ): Promise<SceneVersionRecord> {
    const version = await this.sceneRepository.createVersionForUser(
      userId,
      sceneId,
      dto.label,
      dto.content,
      dto.wordCount,
    );

    if (!version) {
      throw new NotFoundException('Scene not found');
    }

    return version;
  }

  async getVersion(
    userId: string,
    sceneId: string,
    versionId: string,
  ): Promise<SceneVersionRecord> {
    const version = await this.sceneRepository.findVersionForUser(
      userId,
      sceneId,
      versionId,
    );

    if (!version) {
      throw new NotFoundException('Scene version not found');
    }

    return version;
  }

  async updateVersionContent(
    userId: string,
    sceneId: string,
    versionId: string,
    dto: UpdateSceneContentDto,
  ): Promise<SceneVersionContentUpdateResult> {
    const result = await this.sceneRepository.updateVersionContentForUser(
      userId,
      sceneId,
      versionId,
      dto,
    );

    if (!result) {
      throw new NotFoundException('Scene version not found');
    }

    return result;
  }

  async updateVersion(
    userId: string,
    sceneId: string,
    versionId: string,
    dto: UpdateSceneVersionDto,
  ): Promise<SceneVersionRecord> {
    const version = await this.sceneRepository.updateVersionForUser(
      userId,
      sceneId,
      versionId,
      {
        ...(dto.label !== undefined ? { label: dto.label || null } : {}),
      },
    );

    if (!version) {
      throw new NotFoundException('Scene version not found');
    }

    return version;
  }

  async removeVersion(
    userId: string,
    sceneId: string,
    versionId: string,
  ): Promise<SceneVersionRecord> {
    const version = await this.sceneRepository.softDeleteVersionForUser(
      userId,
      sceneId,
      versionId,
      new Date(),
    );

    if (!version) {
      throw new NotFoundException('Scene version not found');
    }

    return version;
  }

  async restoreVersion(
    userId: string,
    sceneId: string,
    versionId: string,
  ): Promise<SceneContentUpdateResult> {
    const result = await this.sceneRepository.restoreVersionForUser(
      userId,
      sceneId,
      versionId,
    );

    if (!result) {
      throw new NotFoundException('Scene version not found');
    }

    return result;
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
