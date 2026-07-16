import { IsOptional, IsUUID } from 'class-validator';

export class MoveTimelineEventDto {
  @IsOptional()
  @IsUUID()
  beforeEventId?: string;

  @IsOptional()
  @IsUUID()
  afterEventId?: string;
}
