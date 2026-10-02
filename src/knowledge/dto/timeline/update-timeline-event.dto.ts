import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TimelineEventFieldsDto } from './timeline-event-fields.dto';

export class UpdateTimelineEventDto extends TimelineEventFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
