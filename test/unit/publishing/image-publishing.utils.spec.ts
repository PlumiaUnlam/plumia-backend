import {
  buildSpanishPrompt,
  buildSpanishPromptFromData,
} from '../../../src/publishing/image-publishing.utils';

describe('image publishing prompts', () => {
  it('prioritizes visual identity, relevant attributes and requested changes for a character', () => {
    const prompt = buildSpanishPrompt(
      {
        canonicalName: 'Maren Solís',
        type: 'CHARACTER',
        description: 'Cabello negro y una cicatriz en la ceja.',
        attributes: {
          visualIdentity: 'Cabello negro y una cicatriz en la ceja.',
          appearance: 'Ojos verdes',
          age: 29,
          internalNote: 'No enviar al proveedor',
        },
      },
      {
        expression: 'sonriente',
        background: 'bosque al atardecer',
      },
      'conservar la cicatriz',
    );

    expect(prompt).toContain('Maren Solís');
    expect(prompt).toContain(
      'Identidad visual prioritaria: Cabello negro y una cicatriz en la ceja.',
    );
    expect(prompt).toContain(
      'Datos relevantes de la ficha: apariencia: Ojos verdes, edad: 29',
    );
    expect(prompt).toContain('expresión: sonriente');
    expect(prompt).toContain('instrucción adicional: conservar la cicatriz');
    expect(prompt).toContain('Crear una variante nueva');
    expect(prompt).not.toContain('No enviar al proveedor');
    expect(prompt).not.toContain('estilo realista');
  });

  it('uses visual instruction labels that match the entity type', () => {
    const prompt = buildSpanishPrompt(
      {
        canonicalName: 'Torre del Norte',
        type: 'LOCATION',
        description: 'Una fortaleza sobre la montaña.',
        attributes: {},
      },
      {
        background: 'cubierta de nieve',
        framing: 'vista aérea',
        lighting: 'al amanecer',
      },
    );

    expect(prompt).toContain('entorno: cubierta de nieve');
    expect(prompt).toContain('perspectiva: vista aérea');
    expect(prompt).toContain('momento y atmósfera: al amanecer');
    expect(prompt).not.toContain('background:');
  });

  it('keeps the existing preview prompt compatible with new entities', () => {
    expect(
      buildSpanishPromptFromData({
        name: 'Torre del Norte',
        type: 'LOCATION',
        description: 'Una fortaleza sobre la montaña.',
      }),
    ).toContain('Crear una representación visual del lugar Torre del Norte');
  });

  it('includes the visual identity profile in preview prompts', () => {
    const prompt = buildSpanishPromptFromData({
      name: 'Maren Solís',
      type: 'CHARACTER',
      description: 'Archivista del valle.',
      attributes: {
        visualIdentity: 'Cabello negro, ojos verdes y una cicatriz en la ceja.',
      },
    });

    expect(prompt).toContain(
      'Identidad visual prioritaria: Cabello negro, ojos verdes y una cicatriz en la ceja.',
    );
  });

  it('distingue una primera imagen y omite rasgos de rostro en entidades no humanas', () => {
    const initial = buildSpanishPromptFromData({
      name: 'Círculo de Sal',
      type: 'ORGANIZATION',
      description: 'Una organización de navegantes.',
      attributes: {
        emblem: 'Un círculo blanco sobre fondo azul.',
        colors: ['azul', 'blanco'],
        privateNote: 'dato interno',
      },
    });
    const variant = buildSpanishPrompt(
      {
        canonicalName: 'Círculo de Sal',
        type: 'ORGANIZATION',
        description: 'Una organización de navegantes.',
        attributes: { emblem: 'Un círculo blanco sobre fondo azul.' },
      },
      {},
      undefined,
      { generationMode: 'variant' },
    );

    expect(initial).toContain(
      'Crear un emblema o una representación de la organización Círculo de Sal',
    );
    expect(initial).toContain(
      'Datos relevantes de la ficha: emblema: Un círculo blanco sobre fondo azul., colores: azul, blanco',
    );
    expect(initial).toContain('Crear la imagen base de la entidad');
    expect(initial).not.toContain('dato interno');
    expect(initial).not.toContain('rostro');
    expect(initial).not.toContain('cabello');
    expect(variant).toContain('Crear una variante nueva');
  });
});
