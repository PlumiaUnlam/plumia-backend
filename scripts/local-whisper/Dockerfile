FROM python:3.11-slim-bookworm

WORKDIR /app

# CTranslate2, usado por faster-whisper, necesita OpenMP en tiempo de ejecución.
RUN apt-get update \
    && apt-get install --no-install-recommends --yes libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/local-whisper/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement ./requirements.txt

COPY scripts/local-whisper/server.py ./server.py

EXPOSE 8001

CMD ["python", "server.py"]
