export interface ApplicationHelpIntentDocument {
  title: string;
  breadcrumb: string;
  questions: string[];
  keywords: string[];
}

const STOP_WORDS = new Set([
  'a',
  'al',
  'algo',
  'algun',
  'alguna',
  'algunos',
  'algunas',
  'aparece',
  'aparecen',
  'como',
  'con',
  'cual',
  'cuales',
  'cuando',
  'cuanta',
  'cuantas',
  'cuanto',
  'cuantos',
  'de',
  'del',
  'donde',
  'el',
  'ella',
  'ellas',
  'ellos',
  'en',
  'es',
  'esa',
  'ese',
  'esta',
  'este',
  'esto',
  'hace',
  'hacen',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'me',
  'mi',
  'mis',
  'no',
  'o',
  'para',
  'por',
  'que',
  'ocurre',
  'ocurren',
  'paso',
  'pasa',
  'se',
  'sin',
  'su',
  'sus',
  'tiene',
  'tienen',
  'un',
  'una',
  'unas',
  'unos',
  'y',
]);

const APPLICATION_FUNCTION_QUESTION =
  /\bcomo funciona(?:n)?\b(?=.*\b(?:plumia|aplicacion|editor|wiki|storyboard|tablero|chat|modo de escritura|estadisticas|historial|pestana|panel|boton|menu)\b)/;

const APPLICATION_HOW_TO_PATTERNS = [
  /\bcomo\s+(?:(?:puedo|se)\s+)?(?:usar|uso|creo|crear|agrego|agregar|configuro|configurar|cambio|cambiar)\b/,
  /\bcomo\s+(?:(?:puedo|se)\s+)?(?:edito|editar|elimino|eliminar|comparto|compartir|exporto|exportar|importo|importar)\b/,
  /\bcomo\s+(?:(?:puedo|se)\s+)?(?:activo|activar|desactivo|desactivar|guardo|guardar|subo|subir|descargo|descargar)\b/,
  /\bcomo\s+(?:(?:puedo|se)\s+)?(?:recupero|recuperar|restablezco|restablecer|veo|ver|consulto|consultar|encuentro|encontrar)\b/,
  /\bcomo\s+(?:(?:puedo|se)\s+)?(?:accedo|acceder|abro|abrir|genero|generar)\b/,
];

const HELP_QUESTION_PATTERNS = [
  ...APPLICATION_HOW_TO_PATTERNS,
  APPLICATION_FUNCTION_QUESTION,
  /\bdonde\b/,
  /\bcuando\b/,
  /\bcuant[oa]s?\b(?=.*\b(?:pesa|peso|dura|duracion|maximo|limite|caracter|meg|mb|minuto|segundo|tamano|medir)\b)/,
  /\b(?:se puede|puedo|puede|permite|acepta)\b/,
  /\b(?:no veo|no encuentro|no me deja|no puedo|no funciona)\b/,
  /\b(?:me aparece|me sale|error|problema)\b/,
  /\b(?:que significa|que diferencia|que opciones|que formatos|que incluye|que muestra)\b/,
  /\b(?:manual|documentacion|guia|ayuda)\b/,
];

/**
 * Recovers application-help questions that do not use the small set of
 * navigation terms. It compares against the wiki's curated questions and
 * keywords, while requiring both help-seeking language and multiple topic
 * terms to avoid routing ordinary story questions to the application corpus.
 */
export function matchesApplicationHelpQuestion(
  question: string,
  documents: readonly ApplicationHelpIntentDocument[],
): boolean {
  const normalizedQuestion = normalize(question);
  if (APPLICATION_FUNCTION_QUESTION.test(normalizedQuestion)) {
    return true;
  }
  if (
    !HELP_QUESTION_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))
  ) {
    return false;
  }

  const questionTerms = tokenize(normalizedQuestion);
  if (questionTerms.size < 2) {
    return false;
  }

  for (const document of documents) {
    const documentText = normalize(
      [
        document.title,
        document.breadcrumb,
        ...document.questions,
        ...document.keywords,
      ].join(' '),
    );
    if (
      document.questions.some(
        (example) => normalize(example) === normalizedQuestion,
      )
    ) {
      return true;
    }

    const documentTerms = tokenize(documentText);
    let overlap = 0;
    for (const term of questionTerms) {
      if (documentTerms.has(term)) {
        overlap += 1;
      }
    }

    const coverage = overlap / questionTerms.size;
    if (
      overlap >= 2 &&
      (coverage >= 0.5 || (overlap >= 3 && coverage >= 0.35))
    ) {
      return true;
    }
  }
  return false;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
      .map(singularize),
  );
}

function singularize(value: string): string {
  if (value.length > 5 && value.endsWith('es')) {
    return value.slice(0, -2);
  }
  if (value.length > 4 && value.endsWith('s')) {
    return value.slice(0, -1);
  }
  return value;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
