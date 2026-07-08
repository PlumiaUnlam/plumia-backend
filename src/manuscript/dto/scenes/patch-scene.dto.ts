import { PartialType } from '@nestjs/mapped-types';
import { CreateSceneDto } from './create-scene.dto';

export class PatchSceneDto extends PartialType(CreateSceneDto) {}
