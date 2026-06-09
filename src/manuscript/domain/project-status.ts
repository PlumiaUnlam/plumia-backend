export enum ProjectStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export function toProjectStatus(status: string): ProjectStatus {
  if (Object.values(ProjectStatus).includes(status as ProjectStatus)) {
    return status as ProjectStatus;
  }

  return ProjectStatus.DRAFT;
}
