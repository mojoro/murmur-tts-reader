"""Post-install for GPT-SoVITS:
1. Fix LangSegment (PyPI 0.2.0 is broken, install from GitHub)
2. Download pretrained models from HuggingFace
"""
import subprocess
import sys
from pathlib import Path

# 1. Fix LangSegment — PyPI only has 0.2.0 which is missing setLangfilters
print("Installing LangSegment from GitHub (PyPI 0.2.0 is broken)...")
subprocess.check_call([
    "uv", "pip", "install", "--python", sys.executable, "--quiet",
    "git+https://github.com/ishine/LangSegment.git",
])

# 2. Download pretrained models from HuggingFace
MODELS_DIR = Path(__file__).parent / "pretrained_models"
MODELS_DIR.mkdir(exist_ok=True)

HF_REPO = "lj1995/GPT-SoVITS"

# Files to download (path in repo -> local path)
FILES = [
    "s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt",
    "s2G488k.pth",
]
# Directories to download (HuggingFace model dirs)
DIRS = [
    "chinese-hubert-base",
    "chinese-roberta-wwm-ext-large",
]

print("Downloading pretrained models from HuggingFace...")
from huggingface_hub import hf_hub_download, snapshot_download  # noqa: E402

for fname in FILES:
    dest = MODELS_DIR / fname
    if not dest.exists():
        print(f"  Downloading {fname}...")
        hf_hub_download(repo_id=HF_REPO, filename=fname, local_dir=str(MODELS_DIR))
    else:
        print(f"  {fname} already exists")

for dirname in DIRS:
    dest = MODELS_DIR / dirname
    if not dest.exists():
        print(f"  Downloading {dirname}/...")
        snapshot_download(
            repo_id=HF_REPO,
            allow_patterns=f"{dirname}/*",
            local_dir=str(MODELS_DIR),
        )
    else:
        print(f"  {dirname}/ already exists")

# 3. Pre-download NLTK data used by g2p-en
print("Downloading NLTK data...")
import nltk  # noqa: E402
nltk.download("averaged_perceptron_tagger", quiet=True)
nltk.download("averaged_perceptron_tagger_eng", quiet=True)
nltk.download("cmudict", quiet=True)

print("GPT-SoVITS post-install complete.")
