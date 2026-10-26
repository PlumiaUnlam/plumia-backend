import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class AcceptStateProposalSequenceDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  acceptedProposalIds!: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  rejectedProposalIds!: string[];
}
