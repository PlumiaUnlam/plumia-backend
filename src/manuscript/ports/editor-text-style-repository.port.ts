export const EDITOR_TEXT_STYLE_REPOSITORY = Symbol(
  'EDITOR_TEXT_STYLE_REPOSITORY',
);

export interface EditorTextStyleRecord {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  definition: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveEditorTextStyleData {
  id?: string;
  name: string;
  kind: string;
  definition: Record<string, string | boolean | number | null>;
}

export interface EditorTextStyleRepository {
  listByProject(projectId: string): Promise<EditorTextStyleRecord[]>;
  create(
    projectId: string,
    data: SaveEditorTextStyleData,
  ): Promise<EditorTextStyleRecord>;
  update(
    projectId: string,
    styleId: string,
    data: SaveEditorTextStyleData,
  ): Promise<EditorTextStyleRecord | null>;
  deactivate(projectId: string, styleId: string): Promise<boolean>;
}
