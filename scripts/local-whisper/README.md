# Whisper local para PlumIA

Este servicio recibe audio desde el backend NestJS y devuelve la transcripción usando `faster-whisper`. No guarda los audios: cada archivo se escribe temporalmente, se procesa y se elimina.

## Inicio en Windows

Desde la raíz de `plumia-backend`:

```powershell
py -3.11 -m venv .venv-whisper
.\.venv-whisper\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r scripts/local-whisper/requirements.txt
python scripts/local-whisper/server.py
```

La primera transcripción descarga el modelo configurado. Por defecto usa `base`, CPU e `int8`. Para priorizar precisión se puede iniciar con:

```powershell
$env:WHISPER_MODEL = "small"
python scripts/local-whisper/server.py
```

Configurar el backend con:

```dotenv
STT_PROVIDER=local
LOCAL_WHISPER_URL=http://127.0.0.1:8001
LOCAL_WHISPER_LANGUAGE=es
LOCAL_WHISPER_TIMEOUT_MS=90000
```

Si el backend NestJS corre dentro de Docker y Whisper corre en Windows, usar `http://host.docker.internal:8001` como `LOCAL_WHISPER_URL`.

Verificación rápida:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
```
