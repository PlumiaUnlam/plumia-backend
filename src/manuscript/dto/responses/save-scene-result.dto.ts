import type { SceneContentUpdateResult } from '../../ports/scene-repository.port';
import { SceneResponseDto } from './scene-response.dto';

export class SaveSceneResultDto extends SceneResponseDto {
  contentChanged!: boolean;

  static fromResult(result: SceneContentUpdateResult): SaveSceneResultDto {
    return {
      ...SceneResponseDto.from(result.scene),
      contentChanged: result.contentChanged,
    };
  }
}
