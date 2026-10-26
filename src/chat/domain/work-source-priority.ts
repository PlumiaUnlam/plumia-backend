import type { ChatSource } from './chat.types';
import type { WorkQuestionType } from './work-question-type';

export function prioritizeWorkSources(
  questionType: WorkQuestionType,
  manuscript: ChatSource[],
  wiki: ChatSource[],
  timeline: ChatSource[],
  broadTimelineIntent: boolean,
): ChatSource[] {
  if (broadTimelineIntent || questionType === 'chronology') {
    return [
      ...timeline.slice(0, 12),
      ...manuscript.slice(0, 6),
      ...wiki.slice(0, 2),
      ...timeline.slice(12),
      ...manuscript.slice(6),
      ...wiki.slice(2),
    ];
  }
  if (questionType === 'character_profile') {
    return [
      ...manuscript.slice(0, 8),
      ...wiki.slice(0, 10),
      ...timeline.slice(0, 2),
      ...manuscript.slice(8),
      ...timeline.slice(2),
    ];
  }
  if (questionType === 'relationship') {
    return [
      ...manuscript.slice(0, 10),
      ...wiki.slice(0, 8),
      ...timeline.slice(0, 2),
      ...manuscript.slice(10),
      ...wiki.slice(8),
      ...timeline.slice(2),
    ];
  }
  if (questionType === 'chapter_fact' || questionType === 'character_state') {
    return [
      ...manuscript,
      ...wiki.slice(0, 4),
      ...timeline.slice(0, 2),
      ...wiki.slice(4),
      ...timeline.slice(2),
    ];
  }
  return [...manuscript, ...wiki, ...timeline];
}
