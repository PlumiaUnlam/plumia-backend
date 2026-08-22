from __future__ import annotations

import os
import logging
import tempfile
import threading
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

MAX_AUDIO_BYTES = int(os.getenv("WHISPER_MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))
MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

app = FastAPI(title="PlumIA Local Whisper")
model: WhisperModel | None = None
model_lock = threading.Lock()
logger = logging.getLogger(__name__)


def get_model() -> WhisperModel:
    global model
    if model is None:
        with model_lock:
            if model is None:
                model = WhisperModel(
                    MODEL_NAME,
                    device=DEVICE,
                    compute_type=COMPUTE_TYPE,
                )
    return model


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "model": MODEL_NAME,
        "device": DEVICE,
        "loaded": model is not None,
    }


@app.post("/transcribe")
def transcribe(
    audio: Annotated[UploadFile, File(...)],
    language: Annotated[str, Form()] = "es",
) -> dict[str, str]:
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail="El archivo debe ser un audio.")

    content = audio.file.read(MAX_AUDIO_BYTES + 1)
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="El audio supera el límite permitido.")

    suffix = Path(audio.filename or "audio.webm").suffix.lower() or ".webm"
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(content)
            temporary_path = temporary.name

        segments, info = get_model().transcribe(
            temporary_path,
            language=language.strip() or "es",
            beam_size=5,
            vad_filter=True,
        )
        text = " ".join(
            segment.text.strip() for segment in segments if segment.text.strip()
        ).strip()
    except Exception as error:
        logger.exception("Whisper no pudo procesar el audio")
        raise HTTPException(
            status_code=502,
            detail="Whisper no pudo procesar el audio.",
        ) from error
    finally:
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)

    if not text:
        raise HTTPException(status_code=422, detail="No se detectó voz en el audio.")

    return {"text": text, "language": info.language}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("WHISPER_HOST", "127.0.0.1"),
        port=int(os.getenv("WHISPER_PORT", "8001")),
    )
