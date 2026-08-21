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

const TYPE_TO_SPANISH: Record<string, { noun: string; article: string }> = {
  CHARACTER: { noun: 'personaje', article: 'un' },
  LOCATION: { noun: 'lugar', article: 'un' },
  OBJECT: { noun: 'objeto', article: 'un' },
  ORGANIZATION: { noun: 'organización', article: 'una' },
  EVENT: { noun: 'evento', article: 'un' },
  CONCEPT: { noun: 'concepto', article: 'un' },
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
    if (err.message.includes('Pollinations API error')) {
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
): string {
  const { noun, article } = TYPE_TO_SPANISH[entity.type] ?? {
    noun: 'entidad',
    article: 'una',
  };
  const parts: string[] = [
    `Ilustración realista de ${article} ${noun} llamado ${entity.canonicalName}`,
    'La referencia visual y los rasgos de identidad de la ficha tienen prioridad sobre el nombre de la entidad',
    'Conservar el rostro, la estructura facial, el color y estilo del cabello, los ojos, el tono de piel, la edad aparente, la complexión y los rasgos distintivos',
  ];
  if (entity.description) {
    parts.push(entity.description);
  }
  const attributes = serializeAttributes(entity.attributes);
  if (attributes) {
    parts.push(`Rasgos y datos de identidad de la ficha: ${attributes}`);
  }
  const requestedChanges = Object.entries(instructions).map(
    ([key, value]) => `${getInstructionLabel(entity.type, key)}: ${value}`,
  );
  if (customPrompt?.trim()) {
    requestedChanges.push(`instrucción adicional: ${customPrompt.trim()}`);
  }
  if (requestedChanges.length > 0) {
    parts.push(
      `Cambios solicitados para esta variante (aplicar sin cambiar la identidad): ${requestedChanges.join('. ')}`,
    );
  }
  parts.push(
    'Generar una variante nueva: cambiar composición, pose, encuadre, fondo o iluminación cuando corresponda; no copiar exactamente la composición de la referencia salvo que se solicite explícitamente',
  );
  parts.push(
    'Sin texto, sin letras, sin palabras, sin tipografía, sin escritura sobre la imagen. Estilo realista, alta calidad',
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

function serializeAttributes(attributes: unknown): string {
  if (!isRecord(attributes)) {
    return '';
  }
  return Object.entries(attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${serializeAttributeValue(value)}`)
    .join(', ');
}

function serializeAttributeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null) {
    return 'sin especificar';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
