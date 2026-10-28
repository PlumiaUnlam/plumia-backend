export const TEMPORAL_RELATIONSHIP_GUIDANCE = `
Contexto de relaciones:
- temporalContext.relationships contiene las relaciones vigentes en la escena analizada.
- temporalContext.relationshipHistory contiene relaciones aceptadas que terminaron antes de
  esta escena, con las escenas donde comenzaron y terminaron cuando esa informacion existe.
- Usa las relaciones historicas como registro de sucesos y guia de continuidad, no como estados
  actuales ni permanentes. Las relaciones pueden evolucionar, terminar o retomarse.
- Que un personaje haya sido enemigo, aliado, pareja o propietario en el pasado no implica que
  lo siga siendo, y el cambio de vinculo por si solo no es una inconsistencia.
- Usa un antecedente historico para detectar un error solo si el texto actual lo contradice de
  forma explicita (por ejemplo, afirma que un encuentro registrado nunca ocurrio). Exige evidencia
  textual clara del fragmento actual; no infieras contradicciones por ausencia o por cambio.
- No uses relaciones de escenas futuras. Si temporalContext no incluye un vinculo, no asumas que
  existe.
`.trim();
