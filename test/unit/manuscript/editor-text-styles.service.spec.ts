import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EditorTextStyleNameConflictError } from '../../../src/manuscript/domain/editor-text-style-name-conflict.error';
import {
  type EditorTextStyleRecord,
  type EditorTextStyleRepository,
} from '../../../src/manuscript/ports/editor-text-style-repository.port';
import type { ProjectRepository } from '../../../src/manuscript/ports/project-repository.port';
import { EditorTextStylesService } from '../../../src/manuscript/services/editor-text-styles.service';

describe('EditorTextStylesService', () => {
  let service: EditorTextStylesService;
  let styles: jest.Mocked<EditorTextStyleRepository>;
  let projects: jest.Mocked<ProjectRepository>;
  const now = new Date('2026-09-01T00:00:00.000Z');
  const record: EditorTextStyleRecord = {
    id: 'style-1',
    projectId: 'project-1',
    name: 'Body',
    kind: 'paragraph',
    definition: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const dto = {
    name: '  Body  ',
    kind: 'paragraph' as const,
    definition: {},
  };

  beforeEach(() => {
    styles = {
      listByProject: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    projects = {
      listByUser: jest.fn(),
      create: jest.fn(),
      existsByIdForUser: jest.fn().mockResolvedValue(true),
      findByIdForUser: jest.fn(),
      updateForUser: jest.fn(),
      softDeleteForUser: jest.fn(),
    };
    service = new EditorTextStylesService(styles, projects);
  });

  it('checks project ownership before listing styles', async () => {
    styles.listByProject.mockResolvedValue([record]);

    await expect(service.list('user-1', 'project-1')).resolves.toEqual([
      record,
    ]);
    expect(projects.existsByIdForUser).toHaveBeenCalledWith(
      'user-1',
      'project-1',
    );
    expect(styles.listByProject).toHaveBeenCalledWith('project-1');

    projects.existsByIdForUser.mockResolvedValue(false);
    await expect(service.list('user-1', 'project-1')).rejects.toThrow(
      new NotFoundException('Project not found'),
    );
    expect(styles.listByProject).toHaveBeenCalledTimes(1);
  });

  it('normalizes names, sanitizes supported formatting, and persists the style', async () => {
    styles.create.mockResolvedValue(record);
    const definition = {
      fontFamily: "Garamond, 'Book'",
      fontSize: '12pt',
      color: '#AABBCC',
      highlightColor: null,
      blockType: 'heading2',
      bold: true,
      italic: false,
      underline: true,
      strike: false,
      subscript: false,
      superscript: true,
      textAlign: 'justify',
      lineHeight: '1.5',
      indentLeft: 1,
      indentRight: 2,
      firstLineIndent: 3,
      tabSize: 8,
      ignored: { nested: true },
    };

    await expect(
      service.create('user-1', 'project-1', { ...dto, definition }),
    ).resolves.toEqual(record);
    expect(styles.create).toHaveBeenCalledWith('project-1', {
      name: 'Body',
      kind: 'paragraph',
      definition: {
        fontFamily: "Garamond, 'Book'",
        fontSize: '12pt',
        color: '#AABBCC',
        highlightColor: null,
        blockType: 'heading2',
        bold: true,
        italic: false,
        underline: true,
        strike: false,
        subscript: false,
        superscript: true,
        textAlign: 'justify',
        lineHeight: '1.5',
        indentLeft: 1,
        indentRight: 2,
        firstLineIndent: 3,
        tabSize: 8,
      },
    });
  });

  it('preserves an optional style id and omits empty optional strings', async () => {
    styles.create.mockResolvedValue(record);
    await service.create('user-1', 'project-1', {
      ...dto,
      id: 'e4b2a46f-6776-4e25-97d5-a8bf4c5e9ec6',
      definition: { fontFamily: '', fontSize: undefined, color: null },
    });

    expect(styles.create).toHaveBeenCalledWith('project-1', {
      id: 'e4b2a46f-6776-4e25-97d5-a8bf4c5e9ec6',
      name: 'Body',
      kind: 'paragraph',
      definition: { color: null },
    });
  });

  it.each(['', '   '])('rejects empty names (%j)', async (name) => {
    await expect(
      service.create('user-1', 'project-1', { ...dto, name }),
    ).rejects.toThrow(
      new BadRequestException('El nombre del estilo es obligatorio'),
    );
    expect(styles.create).not.toHaveBeenCalled();
  });

  it('reserves archived names in create and update', async () => {
    for (const name of ['archived-abc', 'Archived-abc']) {
      await expect(
        service.create('user-1', 'project-1', { ...dto, name }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update('user-1', 'project-1', 'style-1', { ...dto, name }),
      ).rejects.toThrow(BadRequestException);
    }
    expect(styles.create).not.toHaveBeenCalled();
    expect(styles.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ fontFamily: 3 }, 'Formato inválido para fontFamily'],
    [{ fontFamily: 'Bad;Family' }, 'Familia tipográfica inválida'],
    [{ fontSize: 'large' }, 'Tamaño de fuente inválido'],
    [{ color: 'red' }, 'Color inválido para color'],
    [{ highlightColor: '#xyz' }, 'Color inválido para highlightColor'],
    [{ blockType: 'quote' }, 'Tipo de párrafo inválido'],
    [{ bold: 'yes' }, 'Formato inválido para bold'],
    [{ textAlign: 'top' }, 'Alineación inválida'],
    [{ lineHeight: '3' }, 'Interlineado inválido'],
    [{ indentLeft: -1 }, 'Formato inválido para indentLeft'],
    [{ indentRight: 21 }, 'Formato inválido para indentRight'],
    [{ firstLineIndent: Number.NaN }, 'Formato inválido para firstLineIndent'],
    [{ tabSize: 3 }, 'Tamaño de tabulación inválido'],
  ])(
    'rejects invalid formatting definition %j',
    async (definition, message) => {
      await expect(
        service.create('user-1', 'project-1', {
          ...dto,
          definition,
        }),
      ).rejects.toThrow(new BadRequestException(message));
      expect(styles.create).not.toHaveBeenCalled();
    },
  );

  it('rejects non-string or oversized font definitions', async () => {
    for (const value of [42, 'x'.repeat(121)]) {
      await expect(
        service.create('user-1', 'project-1', {
          ...dto,
          definition: { fontSize: value },
        }),
      ).rejects.toThrow(
        new BadRequestException('Formato inválido para fontSize'),
      );
    }
  });

  it('translates name conflicts to a client conflict for create and update', async () => {
    styles.create.mockRejectedValue(new EditorTextStyleNameConflictError());
    styles.update.mockRejectedValue(new EditorTextStyleNameConflictError());

    await expect(service.create('user-1', 'project-1', dto)).rejects.toThrow(
      new ConflictException('Ya existe un estilo con ese nombre'),
    );
    await expect(
      service.update('user-1', 'project-1', 'style-1', dto),
    ).rejects.toThrow(
      new ConflictException('Ya existe un estilo con ese nombre'),
    );
  });

  it('updates a style, reports missing records, and preserves unrelated errors', async () => {
    styles.update.mockResolvedValue(record);
    await expect(
      service.update('user-1', 'project-1', 'style-1', dto),
    ).resolves.toEqual(record);
    expect(styles.update).toHaveBeenCalledWith('project-1', 'style-1', {
      name: 'Body',
      kind: 'paragraph',
      definition: {},
    });

    styles.update.mockResolvedValue(null);
    await expect(
      service.update('user-1', 'project-1', 'missing', dto),
    ).rejects.toThrow(new NotFoundException('Estilo no encontrado'));

    const error = new Error('database unavailable');
    styles.update.mockRejectedValue(error);
    await expect(
      service.update('user-1', 'project-1', 'style-1', dto),
    ).rejects.toBe(error);
  });

  it('deactivates styles and reports styles the repository could not find', async () => {
    styles.deactivate.mockResolvedValue(true);
    await expect(
      service.remove('user-1', 'project-1', 'style-1'),
    ).resolves.toBeUndefined();
    expect(styles.deactivate).toHaveBeenCalledWith('project-1', 'style-1');

    styles.deactivate.mockResolvedValue(false);
    await expect(
      service.remove('user-1', 'project-1', 'missing'),
    ).rejects.toThrow(new NotFoundException('Estilo no encontrado'));
  });

  it('keeps authorization failures ahead of persistence', async () => {
    projects.existsByIdForUser.mockResolvedValue(false);
    await expect(
      service.create('user-1', 'private-project', dto),
    ).rejects.toThrow(NotFoundException);
    expect(styles.create).not.toHaveBeenCalled();
  });
});
