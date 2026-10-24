import {
  BadRequestException,
  Controller,
  Post,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request as ExpressRequest } from 'express';
import type { CreateProjectDto } from '../dto/projects/create-project.dto';
import { ProjectResponseDto } from '../dto/responses/project-response.dto';
import { MAX_EPUB_FILE_SIZE } from '../domain/epub-import.parser';
import { EpubImportService } from '../services/epub-import.service';
import type { AuthenticatedRequest } from './authenticated-request';

interface UploadedEpubFile {
  buffer: Buffer;
  originalname: string;
}

type EpubAuthenticatedRequest = AuthenticatedRequest & ExpressRequest;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseProjectInput(value: unknown): CreateProjectDto {
  if (typeof value !== 'string') {
    throw new BadRequestException('Faltan los datos del proyecto.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BadRequestException('Los datos del proyecto no son válidos.');
  }

  if (!isRecord(parsed)) {
    throw new BadRequestException('Los datos del proyecto no son válidos.');
  }

  const title =
    typeof parsed['title'] === 'string' ? parsed['title'].trim() : '';
  if (!title || title.length > 200) {
    throw new BadRequestException(
      'El nombre del proyecto debe tener entre 1 y 200 caracteres.',
    );
  }

  const project: CreateProjectDto = { title };
  if (typeof parsed['description'] === 'string') {
    project.description = parsed['description'];
  }
  if (typeof parsed['genre'] === 'string') {
    if (parsed['genre'].length > 100) {
      throw new BadRequestException(
        'El género no puede superar los 100 caracteres.',
      );
    }
    project.genre = parsed['genre'];
  }
  if (parsed['wordCountTarget'] !== undefined) {
    const target = parsed['wordCountTarget'];
    if (typeof target !== 'number' || !Number.isInteger(target) || target < 1) {
      throw new BadRequestException(
        'El objetivo de palabras debe ser un entero mayor que cero.',
      );
    }
    project.wordCountTarget = target;
  }

  return project;
}

@Controller('projects')
export class EpubImportController {
  constructor(private readonly epubImportService: EpubImportService) {}

  @Post('import/epub')
  @UseInterceptors(
    FileInterceptor('epub', {
      limits: { fileSize: MAX_EPUB_FILE_SIZE, files: 1 },
    }),
  )
  async importEpub(
    @Request() req: EpubAuthenticatedRequest,
    @UploadedFile() file: UploadedEpubFile | undefined,
  ) {
    if (!file || !file.originalname.toLowerCase().endsWith('.epub')) {
      throw new BadRequestException('Seleccioná un archivo EPUB válido.');
    }

    const project = parseProjectInput(req.body?.project);
    const result = await this.epubImportService.importEpub(
      req.user.id,
      project,
      file.buffer,
    );

    return {
      project: ProjectResponseDto.from(result.project),
      importedChapters: result.importedChapters,
      importedImages: result.importedImages,
      skippedImages: result.skippedImages,
      importedWords: result.importedWords,
    };
  }
}
