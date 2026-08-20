import {
  buildSpanishPrompt,
  buildSpanishPromptFromData,
} from '../../../src/publishing/image-publishing.utils';

describe('image publishing prompts', () => {
  it('includes stable identity data and requested variant changes', () => {
    const prompt = buildSpanishPrompt(
      {
        canonicalName: 'Maren Solís',
        type: 'CHARACTER',
        description: 'Cabello negro y una cicatriz en la ceja.',
        attributes: { eyes: 'green', age: 29 },
      },
      {
        expression: 'sonriente',
        background: 'bosque al atardecer',
      },
      'conservar la cicatriz',
    );

    expect(prompt).toContain('Maren Solís');
    expect(prompt).toContain('Mantener exactamente la identidad visual');
    expect(prompt).toContain('Atributos de identidad: age: 29, eyes: green');
    expect(prompt).toContain('expresión: sonriente');
    expect(prompt).toContain('instrucción adicional: conservar la cicatriz');
    expect(prompt).toContain('Sin texto');
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
    ).toContain('Ilustración realista de un lugar');
  });
});
