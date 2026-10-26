const CREATIVE_REQUEST_WORDS = [
  'escribeme',
  'escribime',
  'escribe',
  'redacta',
  'redactame',
  'continua',
  'continuame',
  'autocompleta',
  'inventame',
  'inventa',
] as const;
const CREATIVE_GENERATION_WORDS = ['genera', 'generame', 'completa'] as const;
const CREATIVE_TARGET_WORDS = [
  'parrafo',
  'escena',
  'capitulo',
  'historia',
] as const;
const PROMPT_INJECTION_WORDS = [
  'ignora',
  'olvida',
  'desobedece',
  'anula',
] as const;
const PROMPT_INJECTION_TARGETS = ['instrucciones', 'reglas'] as const;
const PROMPT_INJECTION_PHRASES = [
  'system prompt',
  'prompt del sistema',
  'prompt interno',
  'instrucciones del sistema',
  'instrucciones ocultas',
  'mensaje de desarrollador',
  'mensaje del sistema',
  'modo desarrollador',
  'developer mode',
  'jailbreak',
  'haz caso omiso',
  'datos internos de la aplicacion',
  'razonamiento interno',
  'cadena de pensamiento',
  'chain of thought',
] as const;
const ROLE_SPOOFING_PATTERN =
  /\b(?:actua|comportate|finge|simula|responde)\b.{0,40}\b(?:como|en modo|ser|de)\b.{0,40}\b(?:sistema|system|desarrollador|developer|sin filtros|sin restricciones)\b/;
const INTERNAL_DATA_EXTRACTION_PATTERNS = [
  /\b(?:revela|revelame|mostra|mostrame|muestra|muestrame|imprime)\b.{0,80}\b(?:tu prompt|tus instrucciones|prompt del sistema|prompt interno|instrucciones internas|instrucciones ocultas|razonamiento interno|cadena de pensamiento)\b/,
  /\b(?:dame|decime|dime|filtra|extrae|lista|pasame)\b.{0,80}\b(?:tu prompt|tus instrucciones|prompt del sistema|prompt interno|instrucciones internas|instrucciones ocultas|razonamiento interno|cadena de pensamiento)\b/,
  /\b(?:revela|revelame|mostra|mostrame|muestra|muestrame|imprime)\b.{0,80}\b(?:api key|clave(?: de)? api|credenciales|token de acceso|variables? de entorno|codigo privado)\b/,
  /\b(?:dame|decime|dime|filtra|extrae|lista|pasame)\b.{0,80}\b(?:api key|clave(?: de)? api|credenciales|token de acceso|variables? de entorno|codigo privado)\b/,
];
const INTERNAL_DATA_OWNERSHIP_PATTERN =
  /\b(?:cual es|cuales son|donde esta|donde estan)\b.{0,80}\b(?:tu|tus|del sistema|de plumia|interno|internos)\b.{0,80}\b(?:api key|clave|token de acceso|credenciales|variables? de entorno|prompt)\b/;
const OUT_OF_SCOPE_TECH_WORDS = [
  'app',
  'aplicacion',
  'web',
  'sitio',
  'react',
  'javascript',
  'typescript',
  'codigo',
  'programa',
] as const;
const OUT_OF_SCOPE_ACTION_WORDS = [
  'crea',
  'creame',
  'hace',
  'haceme',
  'desarrolla',
  'programa',
  'codifica',
] as const;
const OUT_OF_SCOPE_ACADEMIC_WORDS = [
  'tarea',
  'ejercicio',
  'examen',
  'biologia',
  'matematica',
  'fisica',
  'quimica',
] as const;
const OUT_OF_SCOPE_HELP_WORDS = [
  'ayudame',
  'resolve',
  'resuelve',
  'hace',
  'haceme',
] as const;
const COOKING_REQUEST_WORDS = [
  'dame',
  'pasame',
  'comparti',
  'explicame',
  'ensename',
  'quiero',
  'necesito',
] as const;
const COOKING_TARGET_WORDS = [
  'receta',
  'cocinar',
  'ravioles',
  'comida',
  'plato',
  'menu',
] as const;
const COOKING_VERB_PHRASES = [
  'como cocino',
  'como cocinar',
  'como preparo',
  'como hacer',
] as const;
const UNSAFE_OUTPUT_PATTERN =
  /\b(insultame|humillame|acosa|ataca a|discurso de odio|odio contra|denigra|degrada)\b/i;
const WORK_ANALYSIS_CONTEXT_PATTERN =
  /\b(obra|manuscrito|novela|wiki|personaje|escena|capitulo|dialogo|narrador)\b/i;

export const CHAT_OUT_OF_SCOPE_RESPONSE =
  'Mi alcance esta limitado a consultar y auditar tu obra y a orientarte sobre el uso de PlumIA. No puedo responder solicitudes ajenas a esos temas.';
export const CHAT_CLARIFICATION_RESPONSE =
  '¿Te referís a información de tu obra o a cómo usar PlumIA? Contame cuál de las dos cosas querés consultar.';
export const CHAT_UNSAFE_RESPONSE =
  'No puedo seguir instrucciones que cambien mis reglas, revelar información interna ni generar contenido fuera de mi alcance. Puedo ayudarte con tu obra o con el uso de PlumIA.';
export const CHAT_CREATIVE_REFUSAL =
  'Puedo ayudarte a consultar y auditar tu obra, pero no escribir, continuar ni autocompletar el manuscrito. Tu voz y tus decisiones creativas siguen siendo exclusivamente tuyas.';

export function getPolicyRefusal(
  question: string,
  options: { applicationHelpIntent?: boolean } = {},
): string | null {
  const safetyRefusal = getSafetyRefusal(question);
  if (safetyRefusal) {
    return safetyRefusal;
  }
  return isOutOfScope(normalizePolicyText(question)) &&
    !options.applicationHelpIntent
    ? CHAT_OUT_OF_SCOPE_RESPONSE
    : null;
}

export function getSafetyRefusal(question: string): string | null {
  const normalizedQuestion = normalizePolicyText(question);
  if (isPromptInjection(normalizedQuestion)) {
    return 'No puedo ignorar mis reglas ni revelar prompts, credenciales, configuracion o datos internos de PlumIA. Si queres, puedo ayudarte a consultar informacion respaldada por tu obra.';
  }
  if (
    UNSAFE_OUTPUT_PATTERN.test(normalizedQuestion) &&
    !WORK_ANALYSIS_CONTEXT_PATTERN.test(normalizedQuestion)
  ) {
    return 'No puedo insultar, acosar ni generar discurso de odio. Si ese lenguaje aparece en tu obra, si puedo ayudarte a analizarlo de forma neutral y con referencias.';
  }
  return null;
}

export function getSocialResponse(question: string): string | null {
  const normalizedQuestion = normalizePolicyText(question)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    /^(hola|holi|buenas|buen dia|buenas tardes|buenas noches)( (como andas|como estas|que tal|todo bien))?$/.test(
      normalizedQuestion,
    ) ||
    /^(como andas|como estas|que tal|todo bien)$/.test(normalizedQuestion)
  ) {
    return '¡Hola! Todo bien por acá y listo para ayudarte con tu obra. Podés preguntarme por el manuscrito, personajes, relaciones o la línea de tiempo. También puedo orientarte para usar cualquier sección de PlumIA.';
  }
  if (/^(gracias|muchas gracias|genial gracias)$/.test(normalizedQuestion)) {
    return '¡De nada! Cuando quieras, seguimos consultando tu obra.';
  }
  if (/^(chau|adios|hasta luego|nos vemos)$/.test(normalizedQuestion)) {
    return '¡Hasta luego! La conversación queda guardada para cuando quieras retomarla.';
  }
  if (
    /^(quien sos|que sos|que podes hacer|como podes ayudarme)$/.test(
      normalizedQuestion,
    )
  ) {
    return 'Soy el asistente de consulta de PlumIA. Puedo buscar información respaldada por tu manuscrito, Wiki, relaciones, imágenes y línea de tiempo, además de indicarte dónde encontrar y cómo usar cualquier función de la aplicación.';
  }
  return null;
}

export function isCreativeRequest(question: string): boolean {
  const normalizedQuestion = normalizePolicyText(question)
    .replace(/^[^a-z0-9]+/, '')
    .replace(/^por favor\s+/, '');
  const words = tokenize(normalizedQuestion);
  return (
    includesValue(CREATIVE_REQUEST_WORDS, words[0]) ||
    (includesValue(CREATIVE_GENERATION_WORDS, words[0]) &&
      words
        .slice(1, 5)
        .some((word) => includesValue(CREATIVE_TARGET_WORDS, word)))
  );
}

function includesValue(
  values: readonly string[],
  value: string | undefined,
): boolean {
  return value !== undefined && values.includes(value);
}

function isPromptInjection(question: string): boolean {
  return (
    hasNearbyWord(
      question,
      PROMPT_INJECTION_WORDS,
      PROMPT_INJECTION_TARGETS,
      4,
    ) ||
    hasAnyPhrase(question, PROMPT_INJECTION_PHRASES) ||
    ROLE_SPOOFING_PATTERN.test(question) ||
    INTERNAL_DATA_EXTRACTION_PATTERNS.some((pattern) =>
      pattern.test(question),
    ) ||
    INTERNAL_DATA_OWNERSHIP_PATTERN.test(question)
  );
}

function isOutOfScope(question: string): boolean {
  const isTechnicalRequest = hasNearbyWord(
    question,
    OUT_OF_SCOPE_ACTION_WORDS,
    OUT_OF_SCOPE_TECH_WORDS,
    16,
  );
  const isAcademicRequest = hasNearbyWord(
    question,
    OUT_OF_SCOPE_HELP_WORDS,
    OUT_OF_SCOPE_ACADEMIC_WORDS,
    16,
  );
  const isCookingRequest =
    hasNearbyWord(question, COOKING_REQUEST_WORDS, COOKING_TARGET_WORDS, 12) ||
    (hasAnyPhrase(question, COOKING_VERB_PHRASES) &&
      hasAnyWord(question, COOKING_TARGET_WORDS));
  return isTechnicalRequest || isAcademicRequest || isCookingRequest;
}

function hasNearbyWord(
  value: string,
  starters: readonly string[],
  targets: readonly string[],
  maxDistance: number,
): boolean {
  const words = tokenize(value);
  return words.some(
    (word, index) =>
      starters.includes(word) &&
      words
        .slice(index + 1, index + maxDistance + 1)
        .some((target) => targets.includes(target)),
  );
}

function hasAnyWord(value: string, words: readonly string[]): boolean {
  const tokens = new Set(tokenize(value));
  return words.some((word) => tokens.has(word));
}

function hasAnyPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

function tokenize(value: string): string[] {
  return value.split(/[^a-z0-9]+/).filter(Boolean);
}

function normalizePolicyText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
