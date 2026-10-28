# Eval del prompt de extracción de entidades

Mide `src/system/entity-extraction/prompts/entity-extraction.prompt.ts` contra un set fijo de casos, para poder cambiar el prompt sin romper casos que ya funcionaban.

Llama al modelo real con las credenciales de `.env` (`ENTITY_EXTRACTION_PROVIDER`, `ENTITY_EXTRACTION_MODEL`, `ENTITY_EXTRACTION_EFFORT`, `ANTHROPIC_API_KEY` / `ENTITY_EXTRACTION_API_KEY`). Por eso no corre dentro de `pnpm run test`.

## Flujo

```bash
# 1. Baseline del prompt actual (una vez, o cuando cambien los casos o el modelo)
pnpm run eval:extraction --runs 5 --out test/evals/entity-extraction/results/baseline.json

# 2. Cambiás el prompt y volvés a correr
pnpm run eval:extraction --runs 5

# 3. Comparás contra el baseline (sale con código 1 si hay regresiones)
pnpm run eval:extraction:compare test/evals/entity-extraction/results/baseline.json test/evals/entity-extraction/results/<nuevo>.json
```

Opciones de `eval:extraction`:

| Flag                                  | Default                       |                                                  |
| ------------------------------------- | ----------------------------- | ------------------------------------------------ |
| `--runs`                              | 3                             | Corridas por caso (el modelo no es determinista) |
| `--filter`                            | —                             | Un id parcial (`inc-`) o un tag (`tag:negativo`) |
| `--concurrency`                       | 4                             | Llamadas en paralelo                             |
| `--provider` / `--model` / `--effort` | `.env`                        | Pisan la configuración para esa corrida          |
| `--out`                               | `results/<fecha>-<hash>.json` | Dónde guardar el resultado                       |

Cada resultado guarda el hash del prompt, el proveedor y modelo, el commit y la salida cruda de cada corrida, para poder ver qué devolvió el modelo cuando un caso falla.

## Cómo se puntúa

- **Expectativas por caso** (`expect`) deciden si una corrida pasa. Por sección (`entities`, `relationships`, `stateChanges`, `inconsistencies`):
  - `mustInclude`: lo que tiene que aparecer (mide recall).
  - `mustNotInclude`: lo que nunca tiene que aparecer (trampas).
  - `exhaustive: true`: cualquier ítem que no esté en `mustInclude` o `allow` falla (mide precisión). `{ "exhaustive": true }` solo = "la sección tiene que venir vacía".
- **Pass rate por caso** = corridas que pasan / corridas. Un caso "pasa" con ≥ 80% (`--threshold` en el compare). Si un caso pasa en algunas corridas y en otras no, el resultado lo marca como inestable, aunque no cruce el umbral.
- **Invariantes globales**: no hacen fallar casos, se reportan como % de cumplimiento:
  - `evidence_present` / `evidence_grounded`: la evidencia existe y es cita literal del texto.
  - `canonical_names`: entidades conocidas referidas por su nombre canónico y no por un alias.
  - `references_resolvable`: estados, inconsistencias y relaciones apuntan a entidades que el pipeline puede resolver (si no, las descarta en silencio).
  - `aliases_in_text`, `no_generic_objects`, `scores_in_range`.

Los nombres se comparan con la misma normalización que usa el pipeline (`EntityResolutionService.normalize`).

## Agregar un caso

Un JSON en `cases/` con `id`, `description`, `tags`, `input` (igual al payload de `EntityExtractionClient.extractEntities`) y `expect`. Reglas:

- Un caso apunta a **una** regla del prompt; incluí la versión positiva y la trampa negativa.
- Afirmá solo lo que importa para esa regla; lo demás dejalo libre.
- Cuando un caso de producción salga mal (propuesta rechazada, falso positivo de auditoría), convertilo en caso antes de tocar el prompt.
- Si agregás o cambiás casos, regenerá el baseline: el compare marca los casos sin baseline como "nuevos".
