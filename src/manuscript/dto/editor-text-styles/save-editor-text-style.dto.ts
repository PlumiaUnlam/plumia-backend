import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SaveEditorTextStyleDto {
  @IsUUID()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsIn(['text', 'paragraph'])
  kind!: 'text' | 'paragraph';

  @IsObject()
  definition!: Record<string, unknown>;
}
