import type { RelationType } from '../../domain/relation-type';

export type RelationshipProposalStatusDto =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'OBSOLETE';

export interface RelationshipProposalEndpointDto {
  id: string | null;
  proposalId: string | null;
  canonicalName: string;
  isPending: boolean;
}

export interface RelationshipProposalCurrentDto {
  relationType: RelationType;
  description: string | null;
  intensity: number;
}

export class RelationshipProposalResponseDto {
  id!: string;
  projectId!: string;
  sceneId!: string;
  relationshipId!: string | null;
  source!: RelationshipProposalEndpointDto;
  target!: RelationshipProposalEndpointDto;
  current!: RelationshipProposalCurrentDto | null;
  relationType!: RelationType;
  description!: string | null;
  intensity!: number;
  evidence!: string[];
  status!: RelationshipProposalStatusDto;
  canAccept!: boolean;
  createdAt!: Date;
}
