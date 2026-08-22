import { getApplicationGuidance } from '../../../src/chat/domain/application-guide';

describe('application guide', () => {
  it('understands colloquial navigation requests for a specific section', () => {
    const guidance = getApplicationGuidance(
      '¿Me podés llevar a la pestaña de resúmenes?',
      'project-1',
    );

    expect(guidance).toMatchObject({
      source: {
        kind: 'application',
        route: '/projects/project-1/worldbuilding?tab=summaries',
      },
    });
    expect(guidance?.answer).toContain('Resúmenes');
  });

  it('answers general application usage questions without project evidence', () => {
    const guidance = getApplicationGuidance(
      '¿Cómo funciona PlumIA y qué puedo hacer?',
      'project-1',
    );

    expect(guidance).toMatchObject({
      source: {
        kind: 'application',
        label: 'PlumIA · Guía de uso',
        route: '/projects/project-1/editor',
      },
    });
    expect(guidance?.answer).toContain('Storyboard');
  });

  it('keeps a specific section guide more precise than the general guide', () => {
    const guidance = getApplicationGuidance(
      '¿Cómo uso la línea de tiempo?',
      'project-1',
    );

    expect(guidance?.source.route).toBe(
      '/projects/project-1/worldbuilding?tab=timeline',
    );
  });
});
