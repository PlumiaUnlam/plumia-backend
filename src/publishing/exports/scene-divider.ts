export const SCENE_DIVIDER_VARIANTS = [
  'flourish',
  'diamonds',
  'stars',
  'waves',
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
};

export function sceneDividerSvg(variant: SceneDividerVariant): string {
  return DIVIDER_SVGS[normalizeSceneDividerVariant(variant)];
}

// Pre-generated transparent PNG fallbacks for Word versions that do not render SVG.
// The SVG remains the primary image in modern Word documents.
const DIVIDER_PNG_FALLBACKS: Record<SceneDividerVariant, string> = {
  flourish:
    'iVBORw0KGgoAAAANSUhEUgAAAQAAAABACAYAAAAAAAAA9V2pvgAAAZJJREFUeNrt2jGSwjAMBdBcjJNwCO5fQUWZxrFsWXpvhm4HvJL8EweuCwAAAAAAAAAAgHO9X5/v/6Ua0HTzCwFovvmFADTf/EIAmm9+IQDNN78QgOabXwhA880vBMAdADifqjFqnOi21KDG1l21zHL6YhncmB6okjlOedURBPE9UR2zvKxg2d+/2zCrilk+oliuaPPrpho55uvoINi9cEGAeXauvHasw0PLWrXLPsupZifjAqPX5Mlv3fp1nOc6iwpc34qvf6oHQfYadpvp8ueTp2uMGr6OIbCibhG9dtQ+sFCj691xta4eBDvr97TvFWY6/IO73X62f+Kb+P/qdgwLXfuq81qnV7Zkj37v6F/JeQUGmsLtacTopll55RjdyOZOAGjEQP1n/N2sAIhcl7lL9s2SH6/UOwPOPqLoQtFnApp9XtMz3QFweAjY/Gc1PdszAPKEwLIrC7XvHNBfDAggAAABAAgAQAAAAgAQAIAAAAQAIAAAAQAIAEAAAAIAEACAAAAEACAAAAAAAAAAAAC48wNayI7qAAAAAITjMTwAAAAASUVORAAAAACuQmCC',
  diamonds:
    'iVBORw0KGgoAAAANSUhEUgAAAQAAAABACAYAAAAAAAAA9V2pvgAAATFJREFUeNrt3LkVwjAQBUA3RiUUQf8RRGQOkO098M68pxQkrL+SL7YNAAAAAAAAAAAAAAAAAAAAAAAAAIBUz8fr/W1+DRgafkUABq3Ae+Gv7ofZgBW4OPzV/TArGBv+jBD8Ev7qfpgdjA1/ZAhWwl/dD7OEUdv+6BAcCX9WP5wO4Jw/MARnwh/dD9cEEP7AEFwR/qh+ZIwf/ib8KytldvhXwnh2ZVcEGBv+1fBmBf/K74383UiYwFrOVvqOBcC86z/vHIhGB2L186rGUTFuTQGwA7AD0Bo82IVrAK4BgLsA7gLA4UntOQDhZ2gR8CSg8DO0CHgXQPgZXAS8DSj8KAL+D0D4cU3gnjuQLuOHlkVgwg6ky/hB8bECgyIg/AAAAAAAAAAAAAAAAAAAAAAAAABlPvc849oAAAAAV4Aa+QAAAABJRU5EAAAAAK5CYII=',
  stars:
    'iVBORw0KGgoAAAANSUhEUgAAAQAAAABACAYAAAAAAAAA9V2pvgAAAaxJREFUeNrt3E1ShDAQBlAuNifxEN5/5axcWsLQfyHvVbFRKmKb/khAPQ4AAAAAAAAAAAAAAFby9fr++T1UAwQAsFvzCwEQAAIABACwXfMLARAAAgB2CoDD2wDY9+7/18cAAQBkLb0nXcPkawMBkHT3P/M5AQDBzdcxyScHgDcSCIDmO2zn9QkABMCH43xyVI8tAND8AZM8u0k7AsAvJiEACgOgc3wBwFYNfua9e9RSfcL3PKE+8OgA6AyB7FWFAEAAXJjglY0RfY0C4EET29G3pK9ojoivcXYM86Rm3gmA5h9E9mu0iBCIHvdOXRwC4PEBMKlhK0PFvBsYAMRN9DONkLlc7xxnWn2g/PnJ8c8/4sjes2c06Mr1gXEPUKtXIBUhMrk+8NgAyNgCCABImtzZzwG6VhFT6wPlAXD1nOzlf9Q5K9YHSgPgznnRd/8rd9iK66uuD5QFQMcy++479soA6NqGwFYBdGe/rQFh0e1HxJ7bMhwWfv4Q/Xf7qgyLBkDVGMCwAKgOEmDB5j/7bAAYHgCTxwUSAyBzfNUGAAAAAAAAAAAAAAAAAKjwBpHd7wEAAAAAMHzmVwAAAABJRU5EAAAAAK5CYII=',
  waves:
    'iVBORw0KGgoAAAANSUhEUgAAAQAAAABACAYAAAAAAAAA9V2pvgAAAclJREFUeNrt3NtxgzAQBVAaSyUpIv1/JRVkbPBK2sc5M/yuLWl1YTD4ugAAAAAAAAAAAAAAAAAAAAAAAADY6fvr5/e/w+zAoA3/6jB7MGSzCwUYsulX1gGKX867QoBGZ/eu3wds+kObTBgMbkx1Yup020Qrx6Nv9tR5e3HVeVZnypkzcpx6b08dk7eoztSbalHj1nsJA+DpB02qE9Hsna4AToaiOgIgVQAcX9DDAbBi7vRdYL/seKps2pEu1RNsfn2X9OlNEycABIAAcCQJgCohsGrsjgQ3kqM+oEqduxOcbVwVA+DdOrs3Rdc6YRula507dbONK9PPfjvqnHg3onKd0QGw4owhAHKMP3ptBUCDycjwJl3nEKh8Vfe0b0b2RaeFFgD6Ql98sNDXB48hrqgTdQMv27iuXY97Bm3+K+jlqNV1Tv2qc3p+WgRA9KIJgHkBsLqnRgTA0+a8W2d1Up8a1+o6Jzb/k8bMXif6RaZT4yoVAE8nXwAIgBV1Iu8blA2AOw274wZNxPeJGlelOifWvVudnTcUyzwQ5i+pmaxN/7d5fhkah0Lpl4G0BsKhaQBYWsgREmYQAAAAAAAAAAAAAAAAAAAA6vgD7JtSWgAAAACzZIBzAAAAAElFTkSuQmCC',
};

export function sceneDividerPngFallback(variant: SceneDividerVariant): Buffer {
  return Buffer.from(
    DIVIDER_PNG_FALLBACKS[normalizeSceneDividerVariant(variant)],
    'base64',
  );
}
