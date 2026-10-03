import { HttpException, HttpStatus } from '@nestjs/common';
import { randomInt } from 'node:crypto';

export const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const UPLOAD_TIMEOUT_MS = 10_000;
export const MAX_IMAGE_SEED = 2_147_483_647;

export function createImageSeed(): number {
  return randomInt(0, MAX_IMAGE_SEED);
}

const TYPE_TO_SPANISH: Record<string, { noun: string }> = {
  CHARACTER: { noun: 'personaje' },
  LOCATION: { noun: 'lugar' },
  OBJECT: { noun: 'objeto' },
  ORGANIZATION: { noun: 'organización' },
  EVENT: { noun: 'evento' },
  CONCEPT: { noun: 'concepto' },
};

const TYPE_TO_IMAGE_SUBJECT: Record<string, string> = {
  CHARACTER: 'un retrato o una representación del personaje',
  LOCATION: 'una representación visual del lugar',
  OBJECT: 'una representación visual del objeto',
  ORGANIZATION: 'un emblema o una representación de la organización',
  EVENT: 'una escena que represente el evento',
  CONCEPT: 'un símbolo o una representación del concepto',
};

const PROMPT_ATTRIBUTE_LABELS: Record<string, Record<string, string>> = {
  CHARACTER: {
    appearance: 'apariencia',
    physicalDescription: 'descripción física',
    hair: 'cabello',
    hairColor: 'color de cabello',
    eyes: 'ojos',
    eyeColor: 'color de ojos',
    skin: 'piel',
    skinTone: 'tono de piel',
    height: 'estatura',
    build: 'complexión',
    distinctiveFeatures: 'rasgos distintivos',
    clothing: 'vestimenta',
    role: 'rol',
    occupation: 'ocupación',
    age: 'edad',
    species: 'especie',
  },
  LOCATION: {
    terrain: 'terreno',
    architecture: 'arquitectura',
    landmarks: 'lugares reconocibles',
    climate: 'clima',
    region: 'región',
    atmosphere: 'atmósfera',
  },
  OBJECT: {
    shape: 'forma',
    form: 'forma',
    material: 'material',
    markings: 'marcas',
    color: 'color',
    size: 'tamaño',
    function: 'función',
  },
  ORGANIZATION: {
    emblem: 'emblema',
    colors: 'colores',
    symbols: 'símbolos',
    purpose: 'propósito',
    structure: 'estructura',
  },
  EVENT: {
    place: 'lugar',
    location: 'lugar',
    participants: 'participantes',
    date: 'fecha',
    temporalLabel: 'período',
    consequences: 'consecuencias',
  },
  CONCEPT: {
    definition: 'definición',
    symbol: 'símbolo',
    representation: 'representación',
    meaning: 'significado',
    origin: 'origen',
  },
};

const GENERIC_INSTRUCTION_LABELS: Record<string, string> = {
  expression: 'expresión',
  pose: 'pose',
  background: 'fondo',
  framing: 'plano / encuadre',
  lighting: 'iluminación',
  style: 'estilo visual',
};

const TYPE_INSTRUCTION_LABELS: Record<string, Record<string, string>> = {
  LOCATION: {
    background: 'entorno',
    framing: 'perspectiva',
    lighting: 'momento y atmósfera',
  },
  OBJECT: {
    background: 'contexto',
    framing: 'vista',
    style: 'material y acabado',
  },
  ORGANIZATION: {
    background: 'contexto',
    framing: 'composición',
    style: 'identidad visual',
  },
  EVENT: {
    background: 'escenario',
    framing: 'composición',
    lighting: 'atmósfera',
  },
  CONCEPT: {
    background: 'contexto',
    framing: 'forma de representación',
    lighting: 'atmósfera',
    style: 'lenguaje visual',
  },
};

export function toUserFriendlyError(err: unknown): never {
  if (err instanceof Error) {
    if (err.message.includes('timeout')) {
      throw new HttpException(
        'La generación de la imagen tardó demasiado. Intentá de nuevo.',
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }
    if (
      err.message.includes('Pollinations API error') ||
      err.message.includes('Fal API error')
    ) {
      throw new HttpException(
        'El servicio de generación de imágenes no está disponible en este momento.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (err.message.includes('Failed to upload image to storage')) {
      throw new HttpException(
        'Error al guardar la imagen generada. Intentá de nuevo.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
  throw new HttpException(
    'Error al generar la imagen. Intentá de nuevo más tarde.',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${options.timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function buildSpanishPromptFromData(data: {
  name: string;
  description: string | null;
  type: string;
  attributes?: unknown;
}): string {
  return buildSpanishPrompt(
    {
      canonicalName: data.name,
      description: data.description,
      type: data.type,
      attributes: data.attributes,
    },
    {},
    undefined,
    { generationMode: 'initial' },
  );
}

export function buildSpanishPrompt(
  entity: {
    canonicalName: string;
    description: string | null;
    type: string;
    attributes: unknown;
  },
  instructions: Record<string, string>,
  customPrompt?: string,
  options: {
    generationMode?: 'initial' | 'variant';
    visualIdentity?: string;
  } = {},
): string {
  const { noun } = TYPE_TO_SPANISH[entity.type] ?? {
    noun: 'entidad',
  };
  const mode = options.generationMode ?? 'variant';
  const subject =
    TYPE_TO_IMAGE_SUBJECT[entity.type] ??
    `una representación visual de ${noun}`;
  const parts: string[] = [`Crear ${subject} ${entity.canonicalName}`];
  const visualIdentity = getVisualIdentity(entity.attributes);
  const visualIdentityOverride = options.visualIdentity?.trim();
  if (visualIdentity) {
    parts.push(`Identidad visual de la ficha: ${visualIdentity}`);
  }
  if (
    visualIdentityOverride &&
    !isCoveredBy(visualIdentityOverride, visualIdentity)
  ) {
    parts.push(`Ajuste visual para esta imagen: ${visualIdentityOverride}`);
  }
  const visualDescription =
    entity.type === 'CHARACTER'
      ? extractCharacterVisualDescription(entity.description)
      : (entity.description?.trim() ?? '');
  const uncoveredVisualDescription =
    entity.type === 'CHARACTER'
      ? visualDescription
          .split(/\s*,\s*/)
          .filter((detail) => !isCoveredBy(detail, visualIdentity))
          .join(', ')
      : visualDescription;
  if (
    uncoveredVisualDescription &&
    !isCoveredBy(uncoveredVisualDescription, visualIdentity)
  ) {
    parts.push(
      entity.type === 'CHARACTER'
        ? `Rasgos físicos descritos: ${uncoveredVisualDescription}`
        : `Descripción de la ficha: ${uncoveredVisualDescription}`,
    );
  }
  const attributes = serializeRelevantAttributes(
    entity.type,
    entity.attributes,
    [visualIdentity, visualDescription],
  );
  if (attributes) {
    parts.push(`Datos relevantes de la ficha: ${attributes}`);
  }
  const requestedChanges = Object.entries(instructions).map(
    ([key, value]) => `${getInstructionLabel(entity.type, key)}: ${value}`,
  );
  if (customPrompt?.trim()) {
    requestedChanges.push(`instrucción adicional: ${customPrompt.trim()}`);
  }
  if (requestedChanges.length > 0) {
    parts.push(
      `Cambios solicitados para esta imagen: ${requestedChanges.join('. ')}`,
    );
  }
  if (mode === 'variant') {
    parts.push(
      'Crear una variante nueva y mantener reconocibles los datos estables descritos en la ficha y en la imagen de referencia, si existe',
    );
  } else {
    parts.push(
      'Crear la imagen base de la entidad a partir de los datos disponibles, sin asumir una referencia visual inexistente',
    );
  }
  parts.push(
    'No añadir palabras, tipografía ni marcas de agua salvo que se soliciten explícitamente',
  );
  return parts.join('. ');
}

function getInstructionLabel(entityType: string, key: string): string {
  return (
    TYPE_INSTRUCTION_LABELS[entityType]?.[key] ??
    GENERIC_INSTRUCTION_LABELS[key] ??
    key
  );
}

function getVisualIdentity(attributes: unknown): string {
  if (!isRecord(attributes)) {
    return '';
  }
  const visualIdentity = attributes['visualIdentity'];
  return typeof visualIdentity === 'string' ? visualIdentity.trim() : '';
}

function serializeRelevantAttributes(
  type: string,
  attributes: unknown,
  existingVisualText: string[] = [],
): string {
  if (!isRecord(attributes)) {
    return '';
  }
  const labels = PROMPT_ATTRIBUTE_LABELS[type] ?? {};
  return Object.entries(labels)
    .filter(
      ([key]) =>
        key !== 'visualIdentity' &&
        isDisplayValue(attributes[key]) &&
        !existingVisualText.some((text) =>
          isCoveredBy(serializeAttributeValue(attributes[key]), text),
        ),
    )
    .map(
      ([key, label]) => `${label}: ${serializeAttributeValue(attributes[key])}`,
    )
    .join(', ');
}

function extractCharacterVisualDescription(description: string | null): string {
  if (!description?.trim()) {
    return '';
  }

  const patterns = [
    /\b(?:ojos?|mirada|cabello|pelo|piel|tono de piel|complexión|estatura|altura|rostro|cara|barba|bigote|pecas|canas|cicatrices?|vestimenta|ropa)\b(?:\s+(?:de|color|muy))?(?:\s+(?!y\b|pero\b|aunque\b|es\b|tiene\b|conoce\b)[\p{L}\p{M}\d-]+){1,3}/giu,
    /\b(?:viste|lleva)\s+(?:un[oa]s?\s+)?[\p{L}\p{M}\d-]+(?:\s+(?!y\b|pero\b|aunque\b|es\b|tiene\b|conoce\b)[\p{L}\p{M}\d-]+){0,3}/giu,
    /\b(?:es|mide)\s+(?:alto|alta|bajo|baja|delgado|delgada|robusto|robusta|musculoso|musculosa|\d+(?:[,.]\d+)?\s*(?:cm|m))\b/giu,
  ];
  const matches = patterns.flatMap((pattern) =>
    [...description.matchAll(pattern)].map((match) => match[0].trim()),
  );
  return [...new Set(matches)].join(', ');
}

function isCoveredBy(text: string, source: string): boolean {
  const normalize = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const normalizedText = normalize(text);
  const significantWords = normalizedText
    .split(' ')
    .filter(
      (word) =>
        word.length > 2 && !['una', 'unos', 'con', 'sobre'].includes(word),
    );
  const normalizedSource = normalize(source);
  return (
    normalizedText.length > 4 &&
    (normalizedSource.includes(normalizedText) ||
      (significantWords.length > 0 &&
        significantWords.every((word) => normalizedSource.includes(word))))
  );
}

function isDisplayValue(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    serializeAttributeValue(value).trim() !== ''
  );
}

function serializeAttributeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(serializeAttributeValue).filter(Boolean).join(', ');
  }
  if (value === null) {
    return 'sin especificar';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? 'sin especificar';
  } catch {
    return 'valor no serializable';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
