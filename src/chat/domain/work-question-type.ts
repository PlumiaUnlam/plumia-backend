export const WORK_QUESTION_TYPES = [
  'general',
  'character_profile',
  'relationship',
  'chronology',
  'character_state',
  'chapter_fact',
  'first_appearance',
  'interaction_count',
] as const;

export type WorkQuestionType = (typeof WORK_QUESTION_TYPES)[number];

export const CHAT_INTERACTION_COUNT_RESPONSE =
  'No puedo calcular con precisión cuántas veces interactúan esos personajes con el índice actual. Compartir una escena o aparecer juntos no demuestra una interacción, y revisar solo los fragmentos recuperados daría un total incompleto. Puedo ayudarte a analizar su relación y citar las escenas que encuentre.';
