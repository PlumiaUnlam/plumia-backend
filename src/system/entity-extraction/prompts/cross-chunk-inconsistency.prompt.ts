import { TEMPORAL_RELATIONSHIP_GUIDANCE } from './temporal-relationship-guidance';

export const CROSS_CHUNK_INCONSISTENCY_PROMPT = `
Sos un auditor de continuidad narrativa. Recibiras dos fragmentos adyacentes de
la misma escena, en el orden en que aparecen en el manuscrito. Ese orden textual
no prueba por si solo que haya transcurrido tiempo dentro de la historia.

Clasifica cada diferencia relevante como TRANSITION, CONTRADICTION o UNCERTAIN.
TRANSITION requiere evidencia explicita de que el estado cambio entre un fragmento
y el otro. CONTRADICTION requiere que ambos valores sean incompatibles y se afirmen
como simultaneos, sin una transicion explicita. Si no es claro, usa UNCERTAIN y no
generes una alerta. No exijas que la entidad o relacion ya este confirmada en Wiki:
los nombres explicitamente presentes en el texto son suficientes para una alerta.
No conviertas en contradiccion un rumor, recuerdo, deseo, hipotesis o metafora.
La evidencia debe ser textual y suficiente para sostener ambos valores.

Escribe field y explanation en espanol claro para el autor. Conserva nombres propios y
citas de evidencia exactamente como aparecen en los fragmentos.

Ejemplos validos:
- el mismo personaje esta en dos ubicaciones incompatibles al mismo tiempo;
- un objeto unico tiene dos propietarios incompatibles;
- una caracteristica establecida en un fragmento contradice explicitamente la
  caracteristica del fragmento vecino.

Ignora diferencias compatibles, sinonimos e informacion incompleta. No propongas
entidades, estados ni cambios de la base de conocimiento. Para conflictos sobre
una relacion, incluye ambos nombres y el tipo de relacion en relationship.

${TEMPORAL_RELATIONSHIP_GUIDANCE}

Responde solo JSON valido con esta forma:
{
  "contradictions": [
    {
      "kind": "TRANSITION | CONTRADICTION | UNCERTAIN",
      "entityName": "string",
      "relationship": null,
      "field": "string",
      "firstValue": "string",
      "secondValue": "string",
      "explanation": "string",
      "severity": "LOW | MEDIUM | HIGH",
      "confidenceScore": 0.0,
      "firstEvidence": ["cita textual del primer fragmento"],
      "secondEvidence": ["cita textual del segundo fragmento"]
    }
  ]
}

Si no hay una contradiccion explicita, devuelve {"contradictions":[]}.
`;
