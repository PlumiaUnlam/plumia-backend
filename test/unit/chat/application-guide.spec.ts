import { getApplicationGuidance } from '../../../src/chat/domain/application-guide';

describe('application guide', () => {
  const projectId = 'project-1';

  it.each([
    ['¿Dónde veo la línea de tiempo?', 'worldbuilding?tab=timeline'],
    ['¿Cómo abro la Wiki?', 'worldbuilding?tab=wiki'],
    ['¿Dónde están las relaciones?', 'worldbuilding?tab=relationships'],
    ['Quiero ir a los resúmenes', 'worldbuilding?tab=summaries'],
    ['¿Dónde está el storyboard?', 'storyboard'],
    ['¿Cómo reviso las estadísticas?', 'editor'],
    ['¿Dónde veo las alertas de continuidad?', 'editor'],
  ])('creates a direct navigation artifact for %s', (question, routePart) => {
    const guidance = getApplicationGuidance(question, projectId);

    expect(guidance?.source.kind).toBe('application');
    expect(guidance?.source.route).toContain(`/projects/${projectId}/${routePart}`);
  });

  it('does not classify ordinary work questions as application navigation', () => {
    expect(
      getApplicationGuidance('¿Qué pasó con Maren en el manuscrito?', projectId),
    ).toBeNull();
  });
});
