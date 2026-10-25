# Principios de implementación del backend

## Reglas

- Antes de cambiar código, entiende el propósito, los contratos y el comportamiento esperado; conserva lo que ya funciona.
- Da a cada unidad una responsabilidad clara y usa abstracciones que hagan visible el flujo.
- Separa las reglas del negocio de la entrada, persistencia y servicios externos; integra módulos mediante contratos explícitos.
- Valida datos y permisos en el límite del servidor; no confíes en valores ni autorizaciones enviados por el cliente.
- Define una fuente de verdad por dato; considera cachés e índices como copias reconstruibles.
- Delega el trabajo costoso: persiste la tarea junto al cambio que la dispara, evita duplicados al reintentar y expone su estado.
- Acota el consumo de tiempo, memoria y llamadas externas; paraleliza solo operaciones independientes y seguras.
- Atiende los errores donde se pueda responder correctamente, conserva contexto útil y limpia efectos parciales cuando corresponda.
- Sigue las convenciones del proyecto y verifica los flujos afectados con las comprobaciones disponibles.
