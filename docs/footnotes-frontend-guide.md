# Notas al pie y notas al final — guía de implementación para frontend

Esta guía describe todo lo necesario para implementar en el editor (TipTap) la funcionalidad de notas al pie (`FOOTNOTE`) y notas al final (`ENDNOTE`), que el backend ya soporta de punta a punta: almacenamiento, validación y export a PDF/DOCX/EPUB.

> No hay endpoints nuevos para esta feature. El contenido de las notas viaja embebido en el JSON de `Scene.content` que ya se lee/escribe con los endpoints de escenas existentes.

---

## 1. Resumen del modelo

- Una nota es un **nodo de TipTap** (`footnoteReference`), no una marca (`mark`) — porque tiene contenido propio (el cuerpo de la nota puede incluir párrafos, listas, texto con formato, etc.).
- Cada nota tiene un **tipo elegido por el autor, nota por nota**: `FOOTNOTE` (al pie) o `ENDNOTE` (al final). No es una configuración global del proyecto ni del libro.
- El cuerpo de la nota se guarda **inline, dentro del mismo nodo**, como contenido hijo del nodo `footnoteReference`. No hay una tabla ni un recurso aparte — viaja con el resto del contenido de la escena, incluyendo el versionado de escenas (`SceneVersion`) ya existente.
- La numeración visible (`1`, `2`, `3`...) **no se guarda** en el contenido. Se calcula únicamente en el momento de exportar (ver sección 5). El editor puede mostrar una numeración de referencia en vivo (ver sección 4.3), pero es solo una ayuda visual del cliente, no una fuente de verdad.

---

## 2. Contrato JSON del nodo `footnoteReference`

```json
{
  "type": "footnoteReference",
  "attrs": {
    "id": "a1b2c3d4-5e6f-...",
    "noteType": "FOOTNOTE"
  },
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Texto de la nota." }]
    }
  ]
}
```

### Atributos (`attrs`)

| Atributo | Tipo | Reglas |
|---|---|---|
| `id` | `string` | No vacío. **Único dentro de la misma escena.** Lo genera el cliente (recomendado: `crypto.randomUUID()`) al insertar la nota. No reutilizar el `id` de una nota al duplicar/pegar contenido — generar uno nuevo. |
| `noteType` | `string` | Exactamente `"FOOTNOTE"` o `"ENDNOTE"`. Cualquier otro valor es rechazado por el backend. |

### Contenido (`content`)

- Es el **cuerpo de la nota**, en el mismo formato que el resto del documento: puede contener `paragraph`, `heading`, `blockquote`, `bulletList`/`orderedList`, `text` con marks (`bold`, `italic`, `link`), etc.
- **No se puede anidar una nota dentro de otra** (un `footnoteReference` dentro del `content` de otro `footnoteReference`). El backend lo rechaza con `400`. El editor debería impedir esto desde la UI (por ejemplo, deshabilitando el comando de insertar nota mientras el cursor está dentro del cuerpo de otra nota).

### Dónde puede aparecer el nodo

`footnoteReference` es un **nodo inline**, al mismo nivel que `text` o `hardBreak` dentro de un `paragraph` (o cualquier nodo que acepte contenido inline). Debe poder insertarse en medio de una oración, igual que una palabra.

---

## 3. Validación (reglas que el backend hace cumplir)

El backend valida esto al guardar el contenido de una escena (`PATCH`/`PUT` de contenido de escena, creación/edición de `SceneVersion`). Si el documento no cumple, la respuesta es `400`. **Conviene replicar estas mismas reglas en el cliente** para dar feedback inmediato antes de guardar:

1. `attrs.id` debe ser un string no vacío.
2. `attrs.noteType` debe ser `"FOOTNOTE"` o `"ENDNOTE"` (nada más).
3. `attrs.id` debe ser único **dentro del documento de la escena** (no entre escenas distintas — cada escena tiene su propio espacio de ids).
4. No puede haber un `footnoteReference` anidado dentro del `content` de otro `footnoteReference` (en cualquier nivel de profundidad).
5. El resto del contenido del nodo (`content`) debe ser un árbol de bloques TipTap válido (igual que cualquier otro contenido de escena).

---

## 4. UX del editor

Decisión de producto ya validada: **marcador en superíndice + tooltip/popover al pasar el mouse o hacer click**, igual que el comportamiento estándar de Google Docs / Word.

### 4.1. Marcador inline

- Renderizar el nodo `footnoteReference` como un superíndice clickeable/hoverable en el punto donde está insertado (ej. `¹`, `²`, ...).
- El número a mostrar **no viene del backend ni se guarda** — se calcula en el cliente en base al orden de aparición de las notas en el documento (ver 4.3). Esto es solo una referencia visual para el autor mientras escribe; el número final en el export puede diferir levemente según la convención de numeración por capítulo (ver sección 5).

### 4.2. Tooltip / popover

- Al hacer **hover** o **click** sobre el marcador, mostrar un popover con el contenido de la nota (renderizado como rich text, no texto plano, ya que el cuerpo puede tener formato).
- El popover debería permitir **editar el contenido de la nota in-place** (un mini-editor TipTap anidado, o al menos un textarea con formato básico) y, idealmente, **cambiar el tipo** (`FOOTNOTE` ⇄ `ENDNOTE`) desde ahí mismo.
- No se necesita ningún llamado a la API para mostrar el contenido del popover: el cuerpo de la nota ya está en el JSON de la escena que el editor tiene cargado en memoria.

### 4.3. Numeración en vivo (opcional pero recomendado)

**La numeración final no es uniforme entre formatos** (ver sección 5): en PDF las notas al pie se reinician por página física (algo que el editor no puede anticipar, ya que la paginación no existe hasta exportar), mientras que las notas al final llevan una numeración continua de todo el libro. Por eso, cualquier numeración que se muestre en el editor es necesariamente una **aproximación de referencia**, no el número final exacto que verá el lector en PDF.

Recomendación práctica para el editor:

- Recorrer el documento en orden y numerar cada `footnoteReference` secuencialmente, **sin reiniciar** (numeración continua de todo el libro) — esto coincide exactamente con el comportamiento final en EPUB, y con el de las notas al final en PDF/DOCX. Es la aproximación más simple y la que menos diverge del resultado real en la mayoría de los formatos.
- `FOOTNOTE` y `ENDNOTE` **comparten esta misma secuencia** continua en el editor (no hay un contador separado por tipo) — igual que ya se comportan en EPUB.
- Dejar claro en la UI (por ejemplo, con un tooltip o una nota al pie del propio editor) que en PDF la numeración de las notas al pie puede verse distinta al exportar, ya que ahí se recalculan por página.
- Como el editor normalmente edita una escena a la vez, calcular esta numeración continua puede requerir conocer cuántas notas preceden a la escena actual en el libro. Si eso no es viable con los datos que ya tiene el editor, una alternativa aceptable es numerar solo dentro de la escena actual.

### 4.4. Inserción de una nota nueva

Al insertar una nota (por ejemplo con un botón en la toolbar o un comando `/footnote`):

1. Generar un `id` nuevo (`crypto.randomUUID()`).
2. Preguntar o permitir elegir el tipo (`FOOTNOTE` por defecto, con opción de cambiar a `ENDNOTE`).
3. Insertar el nodo `footnoteReference` en la posición del cursor, con un cuerpo inicial vacío (ej. un `paragraph` vacío) y abrir inmediatamente el popover de edición para que el autor escriba el texto.

### 4.5. Copiar/pegar y duplicar

- Si el usuario copia texto que incluye una nota y lo pega **en la misma escena**, hay que generar un `id` nuevo para la copia (no se puede duplicar el `id` original, el backend lo rechazaría).
- Si se pega **en otra escena**, no hay colisión de `id` (los ids son únicos por escena), pero igual se recomienda generar uno nuevo para evitar sorpresas si el contenido se mueve de escena más adelante.

---

## 5. Comportamiento en el export (para que la UI fije expectativas correctas)

Esto ya está implementado en el backend; se documenta acá para que el frontend pueda explicarlo en la UI si corresponde (por ejemplo, un tooltip cerca del selector de formato de export).

| Formato | `FOOTNOTE` | `ENDNOTE` |
|---|---|---|
| **PDF** | Se dibuja al pie de la página física donde aparece la referencia, con **superíndice real**. La numeración **se reinicia en 1 en cada hoja** — no usa la numeración continua del libro. | Se agrupan en **una sola sección "Notas" al final de todo el libro** (no una por capítulo), con superíndice real y numeración continua de principio a fin. |
| **DOCX** | Nota al pie nativa de Word, configurada para **reiniciar la numeración en cada hoja** (Word la recalcula dinámicamente al abrir/imprimir). | Nota al final nativa de Word — se ubica al final de todo el documento y Word la numera de forma continua por defecto. |
| **EPUB** | No existe el concepto de "página física" en un formato reflowable: **se trata igual que `ENDNOTE`** — numeración continua de todo el libro, en la misma sección única al final del libro. | Numeración continua de todo el libro, en una sección "Notas" única al final (no una por capítulo). |

**Numeración**: hay una numeración central continua de todo el libro (nunca se reinicia) que usan las `ENDNOTE` en los 3 formatos, y las `FOOTNOTE` solo en EPUB. En PDF, las `FOOTNOTE` usan en cambio un contador independiente que se reinicia por hoja; en DOCX, Word numera las notas al pie por su cuenta. Ninguna de estas numeraciones se guarda en el contenido — se calculan al exportar.

> En EPUB, `FOOTNOTE` y `ENDNOTE` terminan siendo visualmente indistinguibles (misma sección, misma numeración compartida) — es la única forma consistente de manejarlas en un formato sin páginas fijas. Esto hace que la recomendación de numeración continua del punto 4.3 sea exacta para EPUB, y solo aproximada para PDF (notas al pie) y, visualmente, para DOCX (Word muestra su propio número).

---

## 6. Ejemplo de extensión TipTap (esqueleto orientativo)

Esto es una guía de forma, no código listo para producción — adaptarlo a la configuración real del editor (React/Vue, versión de `@tiptap/core`, etc.).

```ts
import { Node, mergeAttributes } from '@tiptap/core';

export interface FootnoteOptions {
  HTMLAttributes: Record<string, unknown>;
}

type NoteType = 'FOOTNOTE' | 'ENDNOTE';

export const FootnoteReference = Node.create<FootnoteOptions>({
  name: 'footnoteReference',
  group: 'inline',
  inline: true,
  // El cuerpo de la nota admite los mismos bloques que el resto del documento,
  // pero NO otro footnoteReference (se valida también en el backend).
  content: 'block+',

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-note-id'),
        renderHTML: (attrs) => ({ 'data-note-id': attrs.id }),
      },
      noteType: {
        default: 'FOOTNOTE',
        parseHTML: (el) =>
          (el.getAttribute('data-note-type') as NoteType) ?? 'FOOTNOTE',
        renderHTML: (attrs) => ({ 'data-note-type': attrs.noteType }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-note-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'footnote-ref' }), 0];
  },

  // Usar un NodeView (React/Vue) en lugar de renderHTML plano para poder
  // mostrar el número en vivo (calculado) y el popover al hover/click.
  // addNodeView() { ... }

  addCommands() {
    return {
      insertFootnote:
        (noteType: NoteType = 'FOOTNOTE') =>
        ({ chain }: { chain: () => any }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { id: crypto.randomUUID(), noteType },
              content: [{ type: 'paragraph' }],
            })
            .run(),
    };
  },
});
```

Puntos clave de este esqueleto:

- `group: 'inline'` + `inline: true` + `content: 'block+'`: es lo que permite que el nodo viva en medio de un párrafo pero tenga contenido de bloque propio (igual que un `Mention` con contenido, no como un nodo atómico).
- El **NodeView** (no incluido arriba, depende del framework de UI) es donde conviene implementar el superíndice numerado y el popover de edición — un nodo de TipTap renderizado como componente permite manejar hover/click/edición con las herramientas normales de UI del frontend.
- El comando `insertFootnote` es un ejemplo de helper para la toolbar; se puede extender para pasar contenido inicial, pedir el `noteType` por UI, etc.

---

## 7. Checklist de QA antes de dar por cerrada la integración

- [ ] Insertar una nota `FOOTNOTE` y otra `ENDNOTE` en la misma escena, guardar, recargar la escena y verificar que el contenido persiste igual.
- [ ] Verificar que el backend rechaza (`400`) un intento de guardar con dos notas con el mismo `id` en la misma escena (para confirmar que el cliente nunca genera ids duplicados en flujos normales de copiar/pegar/duplicar).
- [ ] Verificar que no se puede insertar una nota dentro del cuerpo de otra nota desde la UI.
- [ ] Exportar un libro con notas `FOOTNOTE` en **más de una hoja/página** y notas `ENDNOTE` en más de un capítulo, a **PDF, DOCX y EPUB**, y confirmar visualmente:
  - PDF: la nota `FOOTNOTE` aparece al pie de la página correspondiente con superíndice real, y la numeración vuelve a 1 en cada hoja nueva; todas las `ENDNOTE` del libro aparecen juntas en una única sección "Notas" al final de todo el documento (no una por capítulo).
  - DOCX: ambas usan el mecanismo nativo de Word; al abrir el archivo, verificar que Word reinicia la numeración de las notas al pie en cada página, y que las notas al final quedan al final de todo el documento con numeración continua.
  - EPUB: todas las notas (de ambos tipos) aparecen juntas en una única sección "Notas" al final del libro, con numeración continua y un link que vuelve al punto de referencia en el texto.
- [ ] Confirmar que el popover de edición no requiere ningún llamado adicional a la API (el contenido ya está en memoria).
- [ ] Probar con una nota cuyo cuerpo tiene formato (negrita, cursiva, un link) y confirmar que se exporta correctamente en los 3 formatos.

---

## 8. Referencias

- Documentación del backend sobre el contrato del nodo y el comportamiento por formato: `docs/export-api.md`, sección 4 ("Notas al pie y notas al final").
- Validador del backend (fuente de verdad de las reglas de la sección 3): `src/manuscript/dto/scenes/tiptap-document.validator.ts`.
- Pipeline de export donde se procesan las notas (referencia si hace falta entender el comportamiento exacto de numeración/render): `src/publishing/exports/tiptap-export.ts` y `src/publishing/exports/renderers/{pdf,docx,epub}-export.renderer.ts`.
