interface StoryboardMatrixNoteRecord {
  id: string;
  arcId: string;
  chapterId: string;
  content: string;
  sortKey: string;
  createdAt: Date;
  updatedAt: Date;
}

interface StoryboardArcRecord {
  id: string;
  projectId: string;
  title: string;
  sourceType: string;
  customType: string | null;
  entityId: string | null;
  relationshipId: string | null;
  sortKey: string;
  createdAt: Date;
  updatedAt: Date;
  notes: StoryboardMatrixNoteRecord[];
}

export class StoryboardMatrixNoteResponseDto {
  id!: string;
  arcId!: string;
  chapterId!: string;
  content!: string;
  sortKey!: string;
  createdAt!: string;
  updatedAt!: string;

  static from(
    note: StoryboardMatrixNoteRecord,
  ): StoryboardMatrixNoteResponseDto {
    return {
      id: note.id,
      arcId: note.arcId,
      chapterId: note.chapterId,
      content: note.content,
      sortKey: note.sortKey,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}

export class StoryboardArcResponseDto {
  id!: string;
  projectId!: string;
  title!: string;
  sourceType!: string;
  customType!: string | null;
  entityId!: string | null;
  relationshipId!: string | null;
  sortKey!: string;
  createdAt!: string;
  updatedAt!: string;
  notes!: StoryboardMatrixNoteResponseDto[];

  static from(arc: StoryboardArcRecord): StoryboardArcResponseDto {
    return {
      id: arc.id,
      projectId: arc.projectId,
      title: arc.title,
      sourceType: arc.sourceType,
      customType: arc.customType,
      entityId: arc.entityId,
      relationshipId: arc.relationshipId,
      sortKey: arc.sortKey,
      createdAt: arc.createdAt.toISOString(),
      updatedAt: arc.updatedAt.toISOString(),
      notes: arc.notes.map((note) =>
        StoryboardMatrixNoteResponseDto.from(note),
      ),
    };
  }
}
