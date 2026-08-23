import { getApplicationGuidance } from '../../../src/chat/domain/application-guide';

describe('application guide', () => {
  const projectId = 'project-1';

  it.each([
    ['¿Dónde veo la línea de tiempo?', 'worldbuilding?tab=timeline'],
    [
      '¿Cómo puedo ver los hechos que pasaron en mi obra?',
      'worldbuilding?tab=timeline',
    ],
    ['¿Cómo abro la Wiki?', 'worldbuilding?tab=wiki'],
    ['¿Dónde están las relaciones?', 'worldbuilding?tab=relationships'],
    [
      '¿Dónde veo las relaciones entre los personajes?',
      'worldbuilding?tab=relationships',
    ],
    ['¿Dónde veo los personajes?', 'worldbuilding?tab=wiki'],
    ['Quiero ir a los resúmenes', 'worldbuilding?tab=summaries'],
    [
      '¿Dónde veo los resúmenes de cada capítulo?',
      'worldbuilding?tab=summaries',
    ],
    ['¿Dónde está el storyboard?', 'storyboard'],
    ['¿Cómo funcionan los modos de escritura?', 'editor'],
    ['¿Cómo reviso las estadísticas?', 'editor'],
    ['¿Dónde veo las alertas de continuidad?', 'editor'],
  ])('creates a direct navigation artifact for %s', (question, routePart) => {
    const guidance = getApplicationGuidance(question, projectId);

    expect(guidance?.action.kind).toBe('navigation');
    expect(guidance?.action.route).toContain(
      `/projects/${projectId}/${routePart}`,
    );
  });

  it('does not classify ordinary work questions as application navigation', () => {
    expect(
      getApplicationGuidance(
        '¿Qué pasó con Maren en el manuscrito?',
        projectId,
      ),
    ).toBeNull();
    expect(
      getApplicationGuidance(
        '¿Qué hechos importantes registra la línea de tiempo?',
        projectId,
      ),
    ).toBeNull();
    expect(
      getApplicationGuidance(
        '¿Cómo funcionan las relaciones entre los personajes?',
        projectId,
      ),
    ).toBeNull();
    expect(
      getApplicationGuidance(
        '¿Dónde aparece el secreto del capítulo futuro?',
        projectId,
      ),
    ).toBeNull();
  });

  it('uses the previous application question to route a short follow-up', () => {
    const guidance = getApplicationGuidance(
      '¿Y la línea de tiempo?',
      projectId,
      {
        history: [
          {
            role: 'user',
            content: '¿Dónde veo los resúmenes de cada capítulo?',
          },
        ],
      },
    );

    expect(guidance?.action.route).toContain(
      `/projects/${projectId}/worldbuilding?tab=timeline`,
    );
  });

  it('does not turn an ambiguous short follow-up into navigation without context', () => {
    expect(
      getApplicationGuidance('¿Y la línea de tiempo?', projectId),
    ).toBeNull();
  });
});
