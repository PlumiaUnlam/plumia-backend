# Whisper local para PlumIA

Este servicio recibe audio desde el backend NestJS y devuelve la transcripción usando `faster-whisper`. No guarda los audios: cada archivo se escribe temporalmente, se procesa y se elimina.

## Inicio con Docker Compose

No hace falta instalar Python, crear un `venv` ni instalar dependencias en Windows. Desde la raíz de `plumia-backend`, con Docker Desktop iniciado:

```powershell
docker compose up --build
```

El Compose levanta `api`, `postgres`, `redis` y `whisper`. Dentro de la red de Docker, NestJS encuentra Whisper en `http://whisper:8001`; el navegador sigue llamando al backend en `http://localhost:3000`.

La primera transcripción descarga el modelo configurado y puede tardar un poco. El modelo queda guardado en el volumen `whisper-models`, por lo que no se vuelve a descargar en cada inicio.

Por defecto se usa `base` en CPU con `int8`. Para cambiar el modelo antes de levantar los servicios:

```powershell
$env:WHISPER_MODEL = "small"
docker compose up --build
```

Verificar que el servicio está disponible:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
```

Para levantar solo la infraestructura y Whisper mientras el backend corre fuera de Docker:

```powershell
docker compose up postgres redis whisper
```

En ese caso el backend local debe usar `LOCAL_WHISPER_URL=http://127.0.0.1:8001`.
