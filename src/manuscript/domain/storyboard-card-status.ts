export const STORYBOARD_CARD_STATUSES = [
  'ideas',
  'planned',
  'in-progress',
  'completed',
] as const;

export type StoryboardCardStatus = (typeof STORYBOARD_CARD_STATUSES)[number];

export function isStoryboardCardStatus(
  value: string,
): value is StoryboardCardStatus {
  return STORYBOARD_CARD_STATUSES.includes(value as StoryboardCardStatus);
}
