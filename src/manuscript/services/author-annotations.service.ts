import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAuthorAnnotationDto } from '../dto/create-author-annotation.dto';
import { UpdateAuthorAnnotationDto } from '../dto/update-author-annotation.dto';

const annotationInclude = {
  author: {
    select: { id: true, name: true, lastname: true, displayName: true, avatarUrl: true },
  },
};

@Injectable()
export class AuthorAnnotationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, sceneId: string) {
    await this.requireOwnedScene(userId, sceneId);
    return this.prisma.authorAnnotation.findMany({
      where: { sceneId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: annotationInclude,
    });
  }

  async create(userId: string, sceneId: string, dto: CreateAuthorAnnotationDto) {
    await this.requireOwnedScene(userId, sceneId);
    const body = this.requireBody(dto.body);
    const quote = dto.quote?.trim() || null;
    const from = dto.anchorFrom;
    const to = dto.anchorTo;

    if ((from === undefined) !== (to === undefined) || (quote && from === undefined)) {
      throw new BadRequestException('La referencia al texto seleccionado no es válida');
    }
    if (from !== undefined && to !== undefined && to <= from) {
      throw new BadRequestException('Selecciona un fragmento de texto válido');
    }
    if (quote && quote.length > 3000) {
      throw new BadRequestException('El fragmento seleccionado es demasiado largo');
    }

    return this.prisma.authorAnnotation.create({
      data: {
        sceneId,
        authorId: userId,
        body,
        quote,
        anchorFrom: from ?? null,
        anchorTo: to ?? null,
        contextBefore: dto.contextBefore?.slice(-200),
        contextAfter: dto.contextAfter?.slice(0, 200),
      },
      include: annotationInclude,
    });
  }

  async update(
    userId: string,
    sceneId: string,
    annotationId: string,
    dto: UpdateAuthorAnnotationDto,
  ) {
    await this.requireOwnedAnnotation(userId, sceneId, annotationId);
    return this.prisma.authorAnnotation.update({
      where: { id: annotationId },
      data: { body: this.requireBody(dto.body) },
      include: annotationInclude,
    });
  }

  async remove(userId: string, sceneId: string, annotationId: string) {
    await this.requireOwnedAnnotation(userId, sceneId, annotationId);
    await this.prisma.authorAnnotation.update({
      where: { id: annotationId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  private async requireOwnedScene(userId: string, sceneId: string) {
    const scene = await this.prisma.scene.findFirst({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: {
          deletedAt: null,
          book: { deletedAt: null, project: { userId, deletedAt: null } },
        },
      },
      select: { id: true },
    });
    if (!scene) throw new NotFoundException('No se encontró la escena');
  }

  private async requireOwnedAnnotation(userId: string, sceneId: string, id: string) {
    const annotation = await this.prisma.authorAnnotation.findFirst({
      where: {
        id,
        sceneId,
        deletedAt: null,
        scene: { chapter: { book: { project: { userId, deletedAt: null } } } },
      },
      select: { id: true },
    });
    if (!annotation) throw new NotFoundException('No se encontró la anotación');
  }

  private requireBody(value: string): string {
    const body = value.trim();
    if (!body) throw new BadRequestException('La anotación no puede estar vacía');
    return body;
  }
}
