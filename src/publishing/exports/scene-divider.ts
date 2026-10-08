export const SCENE_DIVIDER_VARIANTS = [
  'flourish',
  'diamonds',
  'stars',
  'waves',
  'dots',
  'asterisks',
  'moon',
] as const;

export type SceneDividerVariant = (typeof SCENE_DIVIDER_VARIANTS)[number];

export const DEFAULT_SCENE_DIVIDER_VARIANT: SceneDividerVariant = 'flourish';

export const SCENE_DIVIDER_COLOR = '#5b3d6f';

export function isSceneDividerVariant(
  value: unknown,
): value is SceneDividerVariant {
  return (
    typeof value === 'string' &&
    (SCENE_DIVIDER_VARIANTS as readonly string[]).includes(value)
  );
}

export function normalizeSceneDividerVariant(
  value: unknown,
): SceneDividerVariant {
  return isSceneDividerVariant(value) ? value : DEFAULT_SCENE_DIVIDER_VARIANT;
}

const SVG_PREFIX = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 64" width="256" height="64" role="img" aria-label="Adorno ornamental" color="${SCENE_DIVIDER_COLOR}"><g fill="none" stroke="${SCENE_DIVIDER_COLOR}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5">`;
const SVG_SUFFIX = '</g></svg>';

const DIVIDER_SVGS: Record<SceneDividerVariant, string> = {
  flourish: `${SVG_PREFIX}
    <path d="M8 36c16-22 48-26 58-10 8 14-8 22-20 14-8-6-2-16 8-16"/>
    <path d="M56 36c24 0 44-14 66-16 16-2 24 6 24 16"/>
    <path d="M248 36c-16-22-48-26-58-10-8 14 8 22 20 14 8-6 2-16-8-16"/>
    <path d="M200 36c-24 0-44-14-66-16-16-2-24 6-24 16"/>
    <path d="M8 32h40M208 32h40"/>
    <path d="M128 38v18"/>
    <path d="M128 6l8 16-8 12-8-12z" fill="${SCENE_DIVIDER_COLOR}" opacity=".82" stroke="none"/>
    <circle cx="128" cy="38" r="3.4" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <circle cx="114" cy="38" r="1.8" fill="${SCENE_DIVIDER_COLOR}" opacity=".72" stroke="none"/>
    <circle cx="142" cy="38" r="1.8" fill="${SCENE_DIVIDER_COLOR}" opacity=".72" stroke="none"/>
  ${SVG_SUFFIX}`,
  diamonds: `${SVG_PREFIX}
    <path d="M8 32h70M248 32h-70M86 20l12 12-12 12M170 20l-12 12 12 12M102 32h52"/>
    <circle cx="108" cy="32" r="3.4" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <circle cx="118" cy="32" r="3.4" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <path d="M128 14l16 18-16 18-16-18z" fill="${SCENE_DIVIDER_COLOR}" opacity=".18" stroke="none"/>
    <path d="M128 20l11 12-11 12-11-12z" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <circle cx="138" cy="32" r="3.4" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <circle cx="148" cy="32" r="3.4" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <path d="M128 20l11 12-11 12-11-12z"/>
  ${SVG_SUFFIX}`,
  stars: `${SVG_PREFIX}
    <path d="M8 32h80M168 32h80" stroke-dasharray="2 8"/>
    <path d="M128 6l5.4 16.6h16.6l-13.4 10.2 5 16.4-13.6-9.8-13.6 9.8 5-16.4L106 22.6h16.6z" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <path d="M92 18l3.2 9.6h10.2l-8.2 6 3.2 9.8-8.4-6-8.2 6 3.2-9.8-8.2-6h10.2z" fill="${SCENE_DIVIDER_COLOR}" opacity=".7" stroke="none"/>
    <path d="M164 18l3.2 9.6h10.2l-8.2 6 3.2 9.8-8.4-6-8.2 6 3.2-9.8-8.2-6h10.2z" fill="${SCENE_DIVIDER_COLOR}" opacity=".7" stroke="none"/>
  ${SVG_SUFFIX}`,
  waves: `${SVG_PREFIX}
    <path d="M8 46c36 0 72-10 120-18"/>
    <path d="M248 46c-36 0-72-10-120-18"/>
    <path d="M114 28c6 0 10 6 14 10 4-4 8-10 14-10"/>
    <path d="M36 42c-4-12-14-18-24-18 4 10 12 16 24 18z"/>
    <path d="M50 40c0 10-6 16-16 20 0-10 6-16 16-20z"/>
    <path d="M62 38c-2-12-10-18-20-22 2 10 8 18 20 22z"/>
    <path d="M78 36c0 10-6 16-16 20 0-10 6-16 16-20z"/>
    <path d="M92 34c-2-10-10-16-20-20 2 10 8 16 20 20z"/>
    <path d="M220 42c4-12 14-18 24-18-4 10-12 16-24 18z"/>
    <path d="M206 40c0 10 6 16 16 20 0-10-6-16-16-20z"/>
    <path d="M194 38c2-12 10-18 20-22-2 10-8 18-20 22z"/>
    <path d="M178 36c0 10 6 16 16 20 0-10-6-16-16-20z"/>
    <path d="M164 34c2-10 10-16 20-20-2 10-8 16-20 20z"/>
  ${SVG_SUFFIX}`,
  dots: `${SVG_PREFIX}
    <circle cx="88" cy="32" r="6" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <circle cx="128" cy="32" r="6" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <circle cx="168" cy="32" r="6" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
  ${SVG_SUFFIX}`,
  asterisks: `${SVG_PREFIX}
    <path d="M88 16v32M74 24l28 16M74 40l28-16"/>
    <path d="M128 16v32M114 24l28 16M114 40l28-16"/>
    <path d="M168 16v32M154 24l28 16M154 40l28-16"/>
  ${SVG_SUFFIX}`,
  moon: `${SVG_PREFIX}
    <path d="M138 8a24 24 0 1 0 0 48c-20-6-20-42 0-48z" fill="${SCENE_DIVIDER_COLOR}" stroke="none"/>
    <path d="M80 20v24M68 32h24M180 20v24M168 32h24"/>
  ${SVG_SUFFIX}`,
};

export function sceneDividerSvg(variant: SceneDividerVariant): string {
  return DIVIDER_SVGS[normalizeSceneDividerVariant(variant)];
}
