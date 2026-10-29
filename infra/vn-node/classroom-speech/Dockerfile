# eno · classroom speech server — the AI tutor's ears and voice (server.py says why these models).
#
# ⚠️ THE MODELS ARE BAKED IN, NOT DOWNLOADED AT BOOT (mt-server's rule): a request path must not
# depend on the box's egress to GitHub or Hugging Face. fetch_models.py pins every file by SHA-256.
FROM python:3.12-slim AS models
# onnx + onnxruntime only quantize here: the Vietnamese graphs leave this stage as int8 (fetch_models.py zerotts()).
RUN pip install --no-cache-dir "huggingface_hub==2.3.0" "onnxruntime==1.23.2" "onnx==1.19.1" "numpy==2.5.4"
COPY fetch_models.py /build/fetch_models.py
RUN python -I /build/fetch_models.py

FROM python:3.12-slim
# ⚠️ PINNED — the versions measured working: ptts on 2026-10-26 (English), ZeroTTS on 2026-10-29 (Vietnamese).
# zerotts 0.1.5 is installed --no-deps from the exact wheel read before use (2026-10-29: numpy, onnxruntime, tokenizers,
# scipy, soundfile — no network at run time, no pickle), checked by its SHA-256. sherpa-onnx (Parakeet, /stt) left the
# image on 2026-10-29: nothing calls /stt. The MP3 line proves this libsndfile can WRITE mp3 — the format the page needs.
RUN pip install --no-cache-dir "ptts==0.4.2" "numpy==2.5.4" "soundfile==0.14.0" "onnxruntime==1.23.2" \
      "tokenizers==0.23.3" "scipy==1.18.1" \
 && pip download --no-cache-dir --no-deps --only-binary=:all: -d /tmp/zerotts "zerotts==0.1.5" \
 && echo "9b4ceade901c224db33f675794c2c2f7c6d9190fd8f97b74c85efe62cef1c04b  /tmp/zerotts/zerotts-0.1.5-py3-none-any.whl" | sha256sum -c - \
 && pip install --no-cache-dir --no-deps /tmp/zerotts/zerotts-0.1.5-py3-none-any.whl && rm -rf /tmp/zerotts \
 && python -I -c "import io, numpy, soundfile; b = io.BytesIO(); soundfile.write(b, numpy.zeros(2400, dtype='float32'), 24000, format='MP3'); assert len(b.getvalue()) > 100, 'no mp3'"
COPY --from=models /models /models
COPY server.py test_server.py test_trim.py test_vi_gate.py /app/
# MALLOC_ARENA_MAX: glibc otherwise grows an arena per thread, and this server's memory cap is tight.
# HF_HUB_OFFLINE + a /tmp HF_HOME: the models are local paths; nothing may be fetched, nothing written.
# VI_TTS is NOT set here: the run line turns the Vietnamese voice on (-e VI_TTS=1) — its kill switch.
ENV TTS_MODEL_DIR=/models/phonon-31m-en \
    VI_MODEL_DIR=/models/zerotts-int8 \
    VI_VOICE=baotrang \
    VI_THREADS=2 \
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
