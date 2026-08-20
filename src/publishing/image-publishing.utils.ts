import { HttpException, HttpStatus } from '@nestjs/common';

export const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const UPLOAD_TIMEOUT_MS = 10_000;

const TYPE_TO_SPANISH: Record<string, { noun: string; article: string }> = {
  CHARACTER: { noun: 'personaje', article: 'un' },
  LOCATION: { noun: 'lugar', article: 'un' },
  OBJECT: { noun: 'objeto', article: 'un' },
  ORGANIZATION: { noun: 'organización', article: 'una' },
  EVENT: { noun: 'evento', article: 'un' },
  CONCEPT: { noun: 'concepto', article: 'un' },
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
}): string {
  const { noun, article } = TYPE_TO_SPANISH[data.type] ?? {
    noun: 'entidad',
    article: 'una',
  };
  const parts: string[] = [`Ilustración realista de ${article} ${noun}`];
  if (data.description) {
    parts.push(data.description);
  }
  parts.push(
    'Sin texto, sin letras, sin palabras, sin tipografía, sin escritura sobre la imagen. Estilo realista, alta calidad',
  );
  return parts.join('. ');
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
    'Mantener exactamente la identidad visual del mismo personaje o entidad entre variantes',
  ];
  if (entity.description) {
    parts.push(entity.description);
  }
  const attributes = serializeAttributes(entity.attributes);
  if (attributes) {
    parts.push(`Atributos de identidad: ${attributes}`);
  }
  const requestedChanges = Object.entries(instructions).map(
    ([key, value]) => `${key}: ${value}`,
  );
  if (customPrompt?.trim()) {
    requestedChanges.push(`instrucción adicional: ${customPrompt.trim()}`);
  }
  if (requestedChanges.length > 0) {
    parts.push(
      `Cambios solicitados para esta variante: ${requestedChanges.join('. ')}`,
    );
  }
  parts.push(
    'Sin texto, sin letras, sin palabras, sin tipografía, sin escritura sobre la imagen. Estilo realista, alta calidad',
  );
  return parts.join('. ');
}

function serializeAttributes(attributes: unknown): string {
  if (!isRecord(attributes)) {
    return '';
  }
  return Object.entries(attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
