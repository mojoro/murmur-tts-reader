"""Download CosyVoice2 model during install via ModelScope."""
from pathlib import Path

MODEL_DIR = Path(__file__).parent / "models" / "CosyVoice2-0.5B"

if not MODEL_DIR.exists():
    print("Downloading CosyVoice2 model from ModelScope...")
    from modelscope import snapshot_download
    snapshot_download("iic/CosyVoice2-0.5B", local_dir=str(MODEL_DIR))
    print("Model download complete.")
else:
    print("CosyVoice2 model already present.")
