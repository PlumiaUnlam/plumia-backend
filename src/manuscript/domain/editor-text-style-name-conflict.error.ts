export class EditorTextStyleNameConflictError extends Error {
  constructor() {
    super('An editor text style with this name already exists');
    this.name = 'EditorTextStyleNameConflictError';
  }
}
