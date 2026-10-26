# eno · classroom speech server — the AI tutor's ears and voice (server.py says why these models).
#
# ⚠️ THE MODELS ARE BAKED IN, NOT DOWNLOADED AT BOOT (mt-server's rule): a request path must not
# depend on the box's egress to GitHub or Hugging Face. fetch_models.py pins every file by SHA-256.
FROM python:3.12-slim AS models
RUN pip install --no-cache-dir "huggingface_hub==2.3.0"
COPY fetch_models.py /build/fetch_models.py
RUN python -I /build/fetch_models.py

FROM python:3.12-slim
# ⚠️ PINNED — the versions measured working on 2026-10-26. sherpa-onnx 2.0.0 is the first release
# without GPL espeak-ng compiled in (PR #4055) and carries the quiet-audio fix (PR #3999): never
# go below it. The MP3 line proves this libsndfile can WRITE mp3 — the reply format the page needs.
RUN pip install --no-cache-dir "sherpa-onnx==2.0.0" "ptts==0.4.2" "numpy==2.5.4" "soundfile==0.14.0" \
 && python -I -c "import io, numpy, soundfile; b = io.BytesIO(); soundfile.write(b, numpy.zeros(2400, dtype='float32'), 24000, format='MP3'); assert len(b.getvalue()) > 100, 'no mp3'"
COPY --from=models /models /models
COPY server.py test_server.py test_trim.py /app/
# MALLOC_ARENA_MAX: glibc otherwise grows an arena per thread, and this server's memory cap is tight.
# HF_HUB_OFFLINE + a /tmp HF_HOME: the models are local paths; nothing may be fetched, nothing written.
ENV STT_MODEL_DIR=/models/parakeet-tdt-0.6b-v2-int8 \
    TTS_MODEL_DIR=/models/phonon-31m-en \
    STT_THREADS=4 \
    TTS_THREADS=2 \
    OMP_NUM_THREADS=4 \
    MALLOC_ARENA_MAX=2 \
    HF_HUB_OFFLINE=1 \
    HF_HOME=/tmp/hf \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8090
EXPOSE 8090
USER nobody
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["python", "-I", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=4).status == 200 else 1)"]
CMD ["python", "-I", "/app/server.py"]
