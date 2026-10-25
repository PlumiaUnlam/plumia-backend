import type { SceneAnalysisRequestResult } from '../../ports/scene-repository.port';

export class SceneAnalysisResponseDto {
  status!: 'QUEUED' | 'ALREADY_QUEUED' | 'NO_CHANGES';
  pendingChunks!: number;

  static fromResult(
    result: SceneAnalysisRequestResult,
  ): SceneAnalysisResponseDto {
    return {
      status: result.status,
      pendingChunks: result.pendingChunks,
    };
  }
}
