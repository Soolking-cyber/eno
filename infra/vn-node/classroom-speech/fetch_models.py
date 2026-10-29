"""Build step (Dockerfile): put the speech models into /models, pinned and checked, so the
running container never downloads anything (same rule as mt-server: a request path must not
depend on the box's egress to GitHub or Hugging Face).

  /models/phonon-31m-en/   gradium/phonon-31m-en (Apache-2.0) + voices/<Name>.safetensors — English
  /models/zerotts-int8/    zeroweight-ai/ZeroTTS (MIT; codec MOSS-Audio-Tokenizer-Nano decoder, Apache-2.0), its three
                           hot graphs quantized to int8 HERE, + the one voice the guide speaks: voices/baotrang —
                           Vietnamese (owner, 2026-10-29: "bao tran go", "go live")

⛔ PARAKEET IS NOT FETCHED SINCE 2026-10-29: no app code calls /stt (the classroom's ears are Soniox since 10-28), and
its ~0.7 GB of RAM is what the Vietnamese voice uses. To bring /stt back: call parakeet() below again AND put
sherpa-onnx==2.0.0 back in the Dockerfile (server.py imports it only when the model folder exists).

⛔ Every file — the four Parakeet files, the four Phonon files and each of the nine voices — is
checked against a SHA-256 measured on 2026-10-26. A re-uploaded release asset or a moved Hugging
Face revision fails the build here: it never silently changes the voice or the transcripts a
commit was tested with.
"""
import hashlib, io, json, os, shutil, sys, tarfile, urllib.request
from pathlib import Path

from huggingface_hub import hf_hub_download

MODELS = Path(os.environ.get('MODELS_DIR', '/models'))

PARAKEET_URL = ('https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'
                'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2')
PARAKEET = {
    'encoder.int8.onnx': 'a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab',
    'decoder.int8.onnx': 'b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e',
    'joiner.int8.onnx': '7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2',
    'tokens.txt': 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d',
}

# The revisions ptts 0.4.2 itself pins (ptts.DEFAULT_MODEL / DEFAULT_VOICE_CATALOG).
PHONON_REPO, PHONON_REV = 'gradium/phonon-31m-en', '8c64b55ec301728e2d1695bfea87a08a267d0c2d'
PHONON = {
    'config.json': '7062ea376e6b158543c8abec8e5af67df171c49ad70eb7e2a0fb25c16f265e06',
    'tokenizer.json': '691a00068fa7b989f2f3e5ae5daa2d1a5bb319f2d5360deafcfb19a8bb6e7936',
    'model.safetensors': '8a04cf833cfe69b67c2ec968b2d31244655b9accc84ade9c0ebcc176f2074607',
    'default-voice.safetensors': 'f739e8c4c76ee7f92e7c94a82002748c8cd22e99582ac49f7b9b94cd63786e18',
}
VOICES_REPO, VOICES_REV = 'gradium/phonon-voices', 'da6c9ec0d47be8df5c87c730a3aa97187f3229c3'
# name -> catalogue voice_id (voices.jsonl at VOICES_REV). server.py's VOICES must match.
VOICES = {
    'Harper': '4SZHfMpw-p46Ywgs', 'Hadley': 'bXwrkHhURL1VFJdG', 'Zoey': 'NbpkqMVS3CJeq2j8',
    'Trevor': '0zLApsZfVLLNaEGl', 'Preston': 'qIxlZ7Ei8KvWlyQH',
    'Imogen': 'gDT1nz7Ie36ZhL-C', 'Maeve': '6PWnV0Nq4wu7RVBT', 'Spencer': 'JOW0vchyswkQUMDS', 'Toby': 'dME3IWyZBvmh1n1q',
}
VOICE_SHA256 = {
    'Harper': '6b3da6e2d796a20c51af892c482bd6509fb88267a221aff83c870843dee2a123',
    'Hadley': 'a879938aa9a2df0a8220bdadef88137929f71e887bd91e7db205bd5fa11661d2',
    'Zoey': '97c7f8c253413574406ab80dd23f49c3ebb2517163b00a9bf86b9c4cf43e7e23',
    'Trevor': 'dc1341c8937af5534e6bbcc5c0fc5e7c10312229b59061228074f93683fe2261',
    'Preston': '6e04b84d3ae8751b22bca0a4f63936f9cb648f4f2182b2d0788071ea1c0b68a1',
    'Imogen': '1980ab3c35fa98a25b5f3b5e643fd852e14ca8a12a4a26b06aaf1abf2a8c68b1',
    'Maeve': '56494ee67d533ad227ff0dfd0b1c13ff5aa91f1ad6e596e66c2986ba3005e844',
    'Spencer': 'cc9ac1107b0ffce282374a19beb7bfa95847724e6b7afbac991b4ae4277d5e6d',
    'Toby': '09ab315c7f4b72b4d71e66cb756184cedfb1f14d222d096e115bf95bfe7b29dc',
}


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def check(path, want):
    got = sha256(path)
    if got != want:
        sys.exit(f'CHECKSUM MISMATCH {path}: {got} != {want}')


def parakeet():
    dest = MODELS / 'parakeet-tdt-0.6b-v2-int8'
    dest.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(PARAKEET_URL, timeout=600) as r:
        data = r.read()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:bz2') as tar:
        for m in tar.getmembers():
            name = Path(m.name).name
            if m.isfile() and name in PARAKEET:  # only the four files we checksum; nothing else unpacks
                with tar.extractfile(m) as src, open(dest / name, 'wb') as out:
                    shutil.copyfileobj(src, out)
    for name, want in PARAKEET.items():
        check(dest / name, want)


def phonon():
    dest = MODELS / 'phonon-31m-en'
    (dest / 'voices').mkdir(parents=True, exist_ok=True)
    for name, want in PHONON.items():
        p = hf_hub_download(PHONON_REPO, name, revision=PHONON_REV)
        check(p, want)
        shutil.copy(p, dest / name)
    catalog = Path(hf_hub_download(VOICES_REPO, 'voices.jsonl', revision=VOICES_REV))
    lines = [line for line in catalog.read_text().splitlines() if line.strip()]
    by_id = {d['voice_id']: d for d in map(json.loads, lines)}
    for name, vid in VOICES.items():
        entry = by_id.get(vid)
        if not entry or entry.get('name') != name:
            sys.exit(f'voice {name} is not {vid} in the catalogue at {VOICES_REV}')
        p = hf_hub_download(VOICES_REPO, entry['filename'], revision=VOICES_REV)
        check(p, VOICE_SHA256[name])
        shutil.copy(p, dest / 'voices' / f'{name}.safetensors')


# ZeroTTS (Vietnamese), pinned to the revision measured and listened to on 2026-10-29 (zerotts 0.1.5's own default is the
# moving `main` — never that). ZeroWeight's written answer (github.com/zeroweight-ai/ZeroTTS/issues/9, 2026-09-23): code
# and weights MIT, commercial use permitted, "the preset voices may be used with the released model"; keep the notices,
# pin the version.
ZEROTTS_REPO, ZEROTTS_REV = 'zeroweight-ai/ZeroTTS', 'c2bfbd67dc648cac455077333f7cf5c18a2e3bb4'
ZEROTTS = {
    'config.json': '3676da6a9f4dba7a8f2d106d5c1fb02c491391dc19c91dae893133a7e219d666',
    'tokenizer.json': '4fd646e8a1fd6694cb9c876c914a516ef8dd84b4f84db2605be1a7388885ae91',
    'null_voice_emb.npy': 'ec014c14f79e8fc16f4ca6ea557f33fa2cbd7d448b5de5f467aace9ca0321e9f',
    'silence_frame.npy': 'bb2628efa99ae02819b04ff7509ef43ddb3213a9fb0916e4e88b8d1a7c3a1810',
    'onnx/text_encoder.onnx': 'd37557a4abe07953a02686a176664486e73838389a14ff4a3f36b47ac2bccd52',
    'onnx/prefix_step.onnx': 'b7544c9fdd3535b21fe8dea855407180ad2084f9da298f8a153893522496565b',
    'onnx/local_frame_decode.onnx': '3c4540ef4e69dcf604dc6f60f6f99f119189694ff5f31113def20406e274f025',
    'onnx/codec/moss_audio_tokenizer_decode_full.onnx': '0fbbafe3fd4afa2a019af5c5ced204af6e2d1db044fa40f021525d2aee95b4ac',
    'onnx/codec/moss_audio_tokenizer_decode_shared.data': 'e69d52e0f4e84ca27850557ee54face46632d3a5a16c89bd246c7c408466dcad',
    'onnx/codec/moss_audio_tokenizer_decode_step.onnx': '9527c86a29e1837edec1f74db57d5eeaadb3a715af3382703566460afed25855',
    'onnx/codec/codec_browser_onnx_meta.json': '32009d6ac1cd2663bbbf5c06d6835b3a862c02f7de121663071938f2edac8e92',
    'onnx/codec/LICENSE-Apache-2.0.txt': '38ab08051cc3a06dd39507b77d7e8b928b563c49288eb7263339712652d41c6d',
    'voices/baotrang/voice.npz': 'abbc5807cc4767e7c62cc59f7b7cd04b4b7e0dba176086447a0c114578cf695a',
    'voices/baotrang/meta.json': 'eb2f68dde7d10da196b23adf0e276f77f9b4304e07e6517fc42b7a52104133f1',
}
# The three graphs every frame runs. fp32 they are too slow for the box (RTF 1.2-1.7 on the i9, 2026-10-29: memory-bound);
# int8 is ZeroTTS's own recipe (its tools/quantize_onnx_int8.py, read 2026-10-29): fold the Identity nodes with ORT's basic
# optimizations first (else only 41 of 561 MatMuls quantize), then dynamic-quantize the MatMuls — PLUS reduce_range, ONNX
# Runtime's advice for x86 without VNNI (the box's Broadwell), where u8s8 products can saturate. Measured on the i9 (AVX2,
# no VNNI): first sound ~0.1 s, RTF 0.47 at 2 threads, ~1.0 GB. The codec decoder stays fp32 (not on the per-frame path).
ZEROTTS_HOT = ('onnx/text_encoder.onnx', 'onnx/prefix_step.onnx', 'onnx/local_frame_decode.onnx')
# ⛔ AND THE INT8 THEY BECOME IS PINNED — PER PLATFORM (codex + opus, commit review). The same recipe on the same pinned
# inputs and versions (onnxruntime 1.23.2, onnx 1.19.1, numpy 2.5.4) gives different BYTES on macOS and on Linux, and the
# same bytes again on each: two macOS runs agreed, and so did two Linux builds on different machines — the box's and a
# linux/amd64 Docker build (2026-10-29; the first deploy stopped on a macOS-only pin, nothing changed). The Linux voice
# was rendered and listened to before it was pinned here. Any other platform, or new bytes on these, fails the build.
ZEROTTS_INT8 = {
    'linux': {
        'onnx/text_encoder.onnx': 'a1936ff1adf18f2bedf76c4f4ca84dfc499d58e442e1400ecee02e07441369bd',
        'onnx/prefix_step.onnx': 'e2dc19ee89d4fabb20cf95585344a6d617e5912afe71cd74388b2a24fa1b2b38',
        'onnx/local_frame_decode.onnx': '0876c4d5dd7c1a900d1f00fc499a398b9014b1027d6baa58756972a328c61597',
    },
    'darwin': {
        'onnx/text_encoder.onnx': 'fc076bf58fa412f1bfaee79446cfecc9aaa29db1c63c2bb03b2effc6e23de1f2',
        'onnx/prefix_step.onnx': '86a6050cfaf5c8b5a9a92c9bb52712201635b67d7ab1284a38e26faf6cc00f0d',
        'onnx/local_frame_decode.onnx': '004ea141c7a228dbde3273312aeb56d3d2d8656cb4095ceabbef75abeccfeffc',
    },
}


def zerotts():
    import onnxruntime as ort
    from onnxruntime.quantization import QuantType, quantize_dynamic

    dest = MODELS / 'zerotts-int8'
    for name, want in ZEROTTS.items():
        p = hf_hub_download(ZEROTTS_REPO, name, revision=ZEROTTS_REV)
        check(p, want)
        (dest / name).parent.mkdir(parents=True, exist_ok=True)
        # copyfile, not copy: the data without the cache blob's read-only mode — the hot graphs are replaced below.
        shutil.copyfile(p, dest / name)
    for name in ZEROTTS_HOT:
        fp32 = dest / name
        folded, int8 = fp32.with_name(fp32.name + '.opt'), fp32.with_name(fp32.name + '.int8')
        try:
            opts = ort.SessionOptions()
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
            opts.optimized_model_filepath = str(folded)
            ort.InferenceSession(str(fp32), opts, providers=['CPUExecutionProvider'])
            quantize_dynamic(str(folded), str(int8), weight_type=QuantType.QInt8, op_types_to_quantize=['MatMul'],
                             reduce_range=True)
            os.replace(int8, fp32)
        finally:
            folded.unlink(missing_ok=True)
            int8.unlink(missing_ok=True)
        print(f'zerotts int8 {name} {fp32.stat().st_size / 1e6:.0f} MB sha256 {sha256(fp32)}')
        check(fp32, ZEROTTS_INT8[sys.platform][name])  # an unknown platform is a KeyError: the build stops


if __name__ == '__main__':
    phonon()
    zerotts()
    print('models ok:', sorted(str(p.relative_to(MODELS)) for p in MODELS.rglob('*') if p.is_file()))
