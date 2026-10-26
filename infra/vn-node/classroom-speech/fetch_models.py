"""Build step (Dockerfile): put the classroom's models into /models, pinned and checked, so the
running container never downloads anything (same rule as mt-server: a request path must not
depend on the box's egress to GitHub or Hugging Face).

  /models/parakeet-tdt-0.6b-v2-int8/   sherpa-onnx's int8 export of nvidia/parakeet-tdt-0.6b-v2 (CC-BY-4.0)
  /models/phonon-31m-en/               gradium/phonon-31m-en (Apache-2.0) + voices/<Name>.safetensors

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


if __name__ == '__main__':
    parakeet()
    phonon()
    print('models ok:', sorted(str(p.relative_to(MODELS)) for p in MODELS.rglob('*') if p.is_file()))
