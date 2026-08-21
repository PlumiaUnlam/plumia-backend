const CREATIVE_REQUEST_PATTERN =
  /\b(escrib(?:eme|ime)|escribe(?:me)?|redacta(?:me)?|contin[uú]a(?:me)?|autocompleta|inventa(?:me)?|genera(?:me)?\s+(?:un|una)\s+(?:p[aá]rrafo|escena|cap[ií]tulo|historia)|completa\s+(?:el|la|este|esta)\s+(?:p[aá]rrafo|escena|cap[ií]tulo|historia))\b/i;
const PROMPT_INJECTION_PATTERN =
  /(^|\b)(ignora|olvida|desobedece|anula)\s+(?:todas?\s+)?(?:las?\s+)?(?:instrucciones|reglas)|\b(system prompt|prompt del sistema|modo desarrollador|developer mode|jailbreak|api key|clave de api|variables? de entorno|credenciales?|datos internos de la aplicacion|razonamiento interno)\b/i;
const OUT_OF_SCOPE_PATTERN =
  /\b(crea|creame|hace|haceme|desarrolla|programa|codifica)\b[\s\S]{0,80}\b(app|aplicacion|web|sitio|react|javascript|typescript|codigo|programa)\b|\b(ayudame|resolve|resuelve|hace|haceme)\b[\s\S]{0,80}\b(tarea|ejercicio|examen|biologia|matematica|fisica|quimica)\b|\b(dame|pasame|comparti|explicame|ensename|quiero|necesito)\b[\s\S]{0,60}\b(receta|como cocinar|ravioles|menu de comidas)\b|\bcomo\s+(?:cocino|cocinar|preparo|hacer)\b[\s\S]{0,40}\b(ravioles|una comida|un plato)\b/i;
const UNSAFE_OUTPUT_PATTERN =
  /\b(insultame|humillame|acosa|ataca a|discurso de odio|odio contra|denigra|degrada)\b/i;
const WORK_ANALYSIS_CONTEXT_PATTERN =
  /\b(obra|manuscrito|novela|wiki|personaje|escena|capitulo|dialogo|narrador)\b/i;

export function getPolicyRefusal(question: string): string | null {
  const normalizedQuestion = normalizePolicyText(question);
  if (PROMPT_INJECTION_PATTERN.test(normalizedQuestion)) {
    return 'No puedo ignorar mis reglas ni revelar prompts, credenciales, configuracion o datos internos de PlumIA. Si queres, puedo ayudarte a consultar informacion respaldada por tu obra.';
  }
  if (OUT_OF_SCOPE_PATTERN.test(normalizedQuestion)) {
    return 'Mi alcance esta limitado a consultar y auditar tu manuscrito, Wiki y linea de tiempo. No puedo resolver tareas academicas, programar aplicaciones ni atender solicitudes ajenas a tu obra.';
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
    return '¡Hola! Todo bien por acá y listo para ayudarte con tu obra. Podés preguntarme por el manuscrito, personajes, relaciones, notas, resúmenes o la línea de tiempo.';
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
    return 'Soy el asistente de consulta de PlumIA. Puedo buscar información respaldada por tu manuscrito, Wiki, relaciones, imágenes, línea de tiempo, notas y resúmenes, además de indicarte dónde encontrar esas funciones.';
  }
  return null;
}

export function isCreativeRequest(question: string): boolean {
  return CREATIVE_REQUEST_PATTERN.test(question);
}

function normalizePolicyText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
