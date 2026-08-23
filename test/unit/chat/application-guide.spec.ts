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
    ['Quiero ir a los resúmenes', 'worldbuilding?tab=summaries'],
    ['¿Dónde está el storyboard?', 'storyboard'],
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
  });
});
