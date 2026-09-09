# eno · self-hosted NLLB translation server (see server.py for why this exists).
#
# ⚠️ THE MODEL IS BAKED IN, NOT DOWNLOADED AT BOOT. A container that fetches ~2.5GB from
# huggingface.co on every start is a restart that fails whenever the box's egress to HF is
# slow or blocked, and this serves a request path. Conversion happens once, here.
FROM python:3.12-slim AS convert

RUN pip install --no-cache-dir \
      torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir \
      "ctranslate2==4.8.2" "transformers==5.17.0" "sentencepiece==0.2.2" "protobuf==7.36.1"

# ⛔ facebook/m2m100_418M — MIT. NOT NLLB-200, which is CC-BY-NC-4.0 and therefore unusable on a
# commercial marketplace; server.py's header records the full comparison and why the MIT model
# also won on quality. Do not swap this for an NC-licensed model however good its benchmarks.
#
# int8 quantisation: ~1.9GB fp32 → 493MB, which is what makes this fit beside Postgres and two
# Next.js containers in 15GiB. Measured quality cost against the fp32 model: none worth the RAM.
RUN ct2-transformers-converter \
      --model facebook/m2m100_418M \
      --revision 55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636 \
      --output_dir /models/m2m100-418m-int8 \
      --quantization int8 \
 && python -c "\
from transformers import AutoTokenizer; \
AutoTokenizer.from_pretrained('facebook/m2m100_418M', revision='55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636').save_pretrained('/models/tokenizer')"

FROM python:3.12-slim
# ⚠️ NO torch IN THE RUNTIME IMAGE. CTranslate2 runs the converted model on its own runtime;
# torch is a build-time dependency of the converter only, and dropping it takes ~800MB off
# the served image.
# ⚠️ PINNED, AND THE VERSIONS ARE THE ONES MEASURED WORKING ON THIS KERNEL — not the newest.
# An unpinned rebuild months from now can install an incompatible CTranslate2 or a re-uploaded
# model and produce different translations from the same commit, with nothing in git to explain
# it (codex, reviewing this diff). ⛔ ctranslate2 4.5.0 does NOT work here: it fails at import
# with `libctranslate2-*.so.4.5.0: cannot enable executable stack as shared object requires:
# Invalid argument`. Measured on this box — do not "downgrade to a stable version".
RUN pip install --no-cache-dir \
      "ctranslate2==4.8.2" "transformers==5.17.0" "sentencepiece==0.2.2" "protobuf==7.36.1"
COPY --from=convert /models /models
COPY server.py /app/server.py
ENV MT_MODEL_DIR=/models/m2m100-418m-int8 \
    MT_TOKENIZER=/models/tokenizer \
    MT_INTRA_THREADS=4 \
    OMP_NUM_THREADS=4 \
    PORT=8088
EXPOSE 8088
# ⛔ NO healthcheck curl — the slim image has none, and a HEALTHCHECK that always fails would
# make the container look broken forever. The app's own /health endpoint is the probe.
CMD ["python", "/app/server.py"]
