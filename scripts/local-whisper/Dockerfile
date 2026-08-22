FROM python:3.11-slim-bookworm

RUN addgroup --system whisper \
    && adduser --system --ingroup whisper --home /home/whisper whisper

WORKDIR /app

# CTranslate2, usado por faster-whisper, necesita OpenMP en tiempo de ejecución.
RUN apt-get update \
    && apt-get install --no-install-recommends --yes libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/local-whisper/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement ./requirements.txt

COPY --chown=whisper:whisper scripts/local-whisper/server.py ./server.py

ENV HOME=/home/whisper
ENV HF_HOME=/home/whisper/.cache/huggingface

RUN mkdir -p "$HF_HOME" \
    && chown -R whisper:whisper /app /home/whisper

USER whisper

EXPOSE 8001

CMD ["python", "server.py"]
