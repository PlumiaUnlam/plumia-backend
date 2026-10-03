# API de exportación — guía para frontend

Todos los endpoints requieren autenticación (header `Authorization: Bearer <token>`), igual que el resto de la API. Todas las rutas devuelven/reciben JSON salvo donde se indique.

## Resumen de cambios

- **Breaking change**: la exportación ya no es por proyecto completo. Ahora siempre es de **un libro específico**. Las rutas cambiaron de `projects/:projectId/exports` a `projects/:projectId/books/:bookId/exports`.
- La portada del documento exportado (PDF/DOCX/EPUB) muestra el **título del libro**, no el del proyecto.
- Nuevo recurso: **configuración de exportación** (`export-settings`) por proyecto — márgenes, encabezado y pie de página, aplicados automáticamente en cada export.

---

## 1. Crear un export

```
POST /projects/:projectId/books/:bookId/exports
```

Encola la generación del archivo y responde inmediatamente (no espera a que termine).

### Path params
| Param | Tipo | Descripción |
|---|---|---|
| `projectId` | UUID | Proyecto dueño del libro |
| `bookId` | UUID | Libro a exportar |

### Body
```json
{
  "format": "PDF"
}
```
| Campo | Tipo | Requerido | Valores |
|---|---|---|---|
| `format` | string | Sí | `"PDF"` \| `"DOCX"` \| `"EPUB"` |

### Respuesta — `202 Accepted`
```json
{
  "id": "3f2a1c4e-...",
  "projectId": "b7e5...",
  "bookId": "a91c...",
  "format": "PDF",
  "status": "QUEUED",
  "progress": 0,
  "errorMessage": null,
  "downloadUrl": null,
  "createdAt": "2026-09-29T10:00:00.000Z",
  "completedAt": null
}
```

### Errores
| Código | Causa |
|---|---|
| `404` | El libro no existe, no pertenece a `projectId`, o no pertenece al usuario autenticado |
| `400` | `format` inválido o ausente |

---

## 2. Consultar estado de un export

```
GET /projects/:projectId/books/:bookId/exports/:exportId
```

Se usa para hacer **polling** hasta que `status` sea `COMPLETED` o `FAILED`.

### Path params
Los mismos `projectId`/`bookId` que en la creación, más `exportId` (el `id` devuelto por el `POST`).

### Respuesta — `200 OK`

Mismo shape que la respuesta del `POST`. Campos relevantes:

| Campo | Tipo | Notas |
|---|---|---|
| `status` | string | `"QUEUED"` \| `"PROCESSING"` \| `"COMPLETED"` \| `"FAILED"` |
| `progress` | number | 0–100, informativo mientras procesa |
| `errorMessage` | string \| null | Solo si `status === "FAILED"` |
| `downloadUrl` | string \| null | URL prefirmada de descarga directa, **solo presente cuando `status === "COMPLETED"`**. Expira (es una signed URL de storage) — no persistirla, volver a pedir el estado si venció. |

Ejemplo cuando terminó:
```json
{
  "id": "3f2a1c4e-...",
  "projectId": "b7e5...",
  "bookId": "a91c...",
  "format": "PDF",
  "status": "COMPLETED",
  "progress": 100,
  "errorMessage": null,
  "downloadUrl": "https://.../exports/....pdf?X-Amz-...",
  "createdAt": "2026-09-29T10:00:00.000Z",
  "completedAt": "2026-09-29T10:00:07.000Z"
}
```
El nombre sugerido del archivo (`Content-Disposition`) ya viene resuelto en la URL — es el slug del **título del libro** (ej. `mi-libro.pdf`).

### Errores
| Código | Causa |
|---|---|
| `404` | El `exportId` no existe, o no coincide con `projectId`/`bookId`, o no pertenece al usuario |

---

## 3. Configuración de exportación (márgenes / encabezado / pie de página)

Nuevo recurso, uno por proyecto. Se aplica automáticamente a **todos** los exports futuros de ese proyecto (cualquier libro), en los 3 formatos — con la salvedad de que en **EPUB el encabezado/pie de página no tiene efecto visual** (formato reflowable, sin concepto de página fija); solo los márgenes se aproximan como padding del texto.

### 3.1. Obtener configuración actual

```
GET /projects/:projectId/export-settings
```

Nunca da 404: si el proyecto no tiene configuración guardada, devuelve los valores por defecto sin persistir nada.

**Respuesta — `200 OK`:**
```json
{
  "margins": { "topCm": 2.5, "bottomCm": 2.5, "leftCm": 2.5, "rightCm": 2.5 },
  "header": null,
  "footer": null
}
```
(esos son los defaults cuando no hay config guardada)

### 3.2. Guardar/reemplazar configuración

```
PUT /projects/:projectId/export-settings
```

Reemplaza la configuración completa (no es un PATCH parcial — siempre hay que mandar el objeto entero).

**Body:**
```json
{
  "margins": {
    "topCm": 3,
    "bottomCm": 2.5,
    "leftCm": 2,
    "rightCm": 2
  },
  "header": {
    "text": "{{tituloLibro}}",
    "alignment": "center",
    "pageNumber": { "enabled": false, "format": "" }
  },
  "footer": {
    "text": null,
    "alignment": "center",
    "pageNumber": { "enabled": true, "format": "Página {{pagina}} de {{totalPaginas}}" }
  }
}
```

**Respuesta — `200 OK`:** mismo shape que el `GET`, con los valores recién guardados.

#### Shape de `margins` (siempre requerido, los 4 campos)
| Campo | Tipo | Rango | Unidad |
|---|---|---|---|
| `topCm` | number | 0–10 | centímetros |
| `bottomCm` | number | 0–10 | centímetros |
| `leftCm` | number | 0–10 | centímetros |
| `rightCm` | number | 0–10 | centímetros |

> **`margins` controla solo dónde arranca el cuerpo del texto.** El encabezado/pie de página se dibuja a una distancia fija del borde de la página (no configurable), independiente del margen — igual que en Word: cambiar el margen no mueve el header/footer. Si `topCm`/`bottomCm` es menor al mínimo necesario para no superponerse con el header/footer activo, el margen efectivo se ajusta hacia arriba automáticamente (nunca hacia abajo) para evitar la superposición — aplica a PDF y DOCX. No aplica a EPUB (ver abajo).

#### Shape de `header` / `footer` (cada uno opcional — mandar `null` o no incluirlo para no mostrar esa banda)
| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `text` | string \| null | No | Texto libre, máx. 300 caracteres. Admite variables (ver abajo). |
| `alignment` | string | Sí (si se manda header/footer) | `"left"` \| `"center"` \| `"right"` |
| `pageNumber.enabled` | boolean | Sí | Muestra/oculta el número de página |
| `pageNumber.format` | string | Sí | Texto libre, máx. 80 caracteres, con variables `{{pagina}}`/`{{totalPaginas}}` (ver abajo) |

Si `header`/`footer` se omiten o se mandan como `null`, esa banda queda deshabilitada (sin texto ni número de página).

#### Variables de plantilla soportadas

En `header.text` / `footer.text`:
- `{{tituloLibro}}` → título del libro que se está exportando
- `{{fecha}}` → fecha de generación del export

En `footer.pageNumber.format` / `header.pageNumber.format` (además de las anteriores):
- `{{pagina}}` → número de página actual
- `{{totalPaginas}}` → total de páginas **de contenido** (la portada nunca se numera ni cuenta en el total)

Ejemplo de `format` típico: `"Página {{pagina}} de {{totalPaginas}}"`.

### Errores (ambos endpoints de `export-settings`)
| Código | Causa |
|---|---|
| `404` | El proyecto no existe o no pertenece al usuario |
| `400` | Body inválido (margen fuera de rango, alignment inválido, `text`/`format` muy largos, etc.) |

---

## 4. Notas al pie y notas al final

Las notas (al pie o al final) se insertan directamente en el contenido de la escena, como un nodo más del documento TipTap de `Scene.content` — no son un recurso aparte de la API, viajan con el contenido normal de la escena (y con su versionado existente).

### Contrato del nodo `footnoteReference`

```json
{
  "type": "footnoteReference",
  "attrs": { "id": "uuid-string", "noteType": "FOOTNOTE" },
  "content": [
    { "type": "paragraph", "content": [{ "type": "text", "text": "Texto de la nota." }] }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `attrs.id` | string | No vacío, único **dentro de la misma escena**. El front lo genera (por ejemplo un UUID) al crear la nota. |
| `attrs.noteType` | string | `"FOOTNOTE"` (nota al pie) \| `"ENDNOTE"` (nota al final) — se elige **por nota individual**, no es una config global. |
| `content` | array | Cuerpo de la nota, con los mismos bloques TipTap soportados en el resto del documento (párrafos, encabezados, cita, listas, texto con formato). **No se puede anidar una nota dentro de otra.** |

El backend valida esta estructura (id único, `noteType` válido, sin anidamiento) al guardar el contenido de la escena — un documento que viole estas reglas es rechazado con `400`.

### Numeración

Los números que ve el lector **no se guardan** en el contenido — se calculan en el momento de exportar. La numeración central (continua a lo largo de **todo el libro**, nunca se reinicia) es la que usan las notas al final en los 3 formatos, y las notas al pie solo en EPUB. **En PDF, las notas al pie se numeran aparte: se reinician en 1 en cada hoja física** (no comparten esa numeración con las notas al final); en DOCX, Word numera las notas al pie por su cuenta. Ver la tabla de abajo para el detalle por formato.

### Comportamiento por formato de export

| Formato | Notas al pie (`FOOTNOTE`) | Notas al final (`ENDNOTE`) |
|---|---|---|
| **PDF** | Se dibujan al pie de la página física donde aparece la referencia, con **superíndice real**. La numeración **se reinicia en 1 en cada hoja** (se calcula en el momento de maquetar el PDF, no es la numeración central del libro). | Se agrupan en **una sola sección "Notas" al final de todo el libro** (no una por capítulo), con superíndice real y numeración continua de principio a fin. |
| **DOCX** | Usan el mecanismo nativo de notas al pie de Word, con la numeración configurada para **reiniciarse en cada hoja** (Word lo calcula dinámicamente al abrir/imprimir, igual que si el usuario lo activara a mano). | Usan el mecanismo nativo de notas al final de Word — se ubican al final de todo el documento y Word las numera de forma continua por defecto (sin necesidad de configuración extra). |
| **EPUB** | No existe el concepto de "página física" en un formato reflowable: **se tratan igual que las notas al final** — numeración continua de todo el libro, en la misma sección única al final, con un enlace de ida (marcador → nota) y de vuelta (nota → marcador). | Numeración continua de todo el libro, en una sección "Notas" única al final del libro (no una por capítulo). |

> En EPUB, `FOOTNOTE` y `ENDNOTE` son visualmente indistinguibles (misma numeración compartida, misma sección) — es la única forma consistente de manejarlas dado que el formato no tiene páginas fijas.

---

## 5. Comportamiento a tener en cuenta en el front

- **Portada**: siempre es una página/pantalla separada con solo el título del libro, sin encabezado ni pie de página, en los 3 formatos.
- **Márgenes independientes del header/footer**: el margen configurado solo afecta dónde arranca el texto del cuerpo. El header/footer queda siempre a la misma distancia del borde de la página, sin importar el margen (aplica a PDF y DOCX; en EPUB no hay header/footer visible, ver abajo).
- **Numeración**: si el footer/header tiene número de página activado, empieza en 1 en la primera página de contenido (la portada no se numera).
- **Salto de página**: hay salto automático entre escenas, entre capítulos y (en el flujo anterior, ya no aplica) entre libros — esto es interno al renderer, no requiere nada del front.
- **EPUB**: si el proyecto tiene `header`/`footer` configurado, no se ve reflejado en el EPUB (limitación del formato). No es un bug si el usuario reporta que "no aparece" en EPUB — vale la pena aclararlo en la UI si se expone esta config cerca de un selector de formato.
- **Polling recomendado**: tras el `POST`, hacer `GET` cada 1–2 segundos hasta `COMPLETED`/`FAILED`. No hay webhook/SSE todavía.
- **Notas en el editor**: como el cuerpo de la nota viaja embebido en el JSON de `Scene.content` (ver sección 4), los endpoints de escenas ya existentes devuelven todo lo necesario para mostrar un marcador en superíndice con un tooltip/popover al pasar el mouse o hacer click — no hace falta ningún endpoint nuevo para esto.
