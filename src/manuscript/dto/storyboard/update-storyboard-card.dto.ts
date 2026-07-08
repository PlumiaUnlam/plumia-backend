import { PartialType } from '@nestjs/mapped-types';
import { CreateStoryboardCardDto } from './create-storyboard-card.dto';

export class UpdateStoryboardCardDto extends PartialType(
  CreateStoryboardCardDto,
) {}
