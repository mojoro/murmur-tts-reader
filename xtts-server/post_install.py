"""Download XTTS v2 model during install so it's ready at engine start."""
import torch
# Patch torch.load for Coqui TTS compatibility with PyTorch 2.6+
_orig_load = torch.load
torch.load = lambda *a, **kw: _orig_load(*a, **{**kw, "weights_only": False})

from TTS.api import TTS

print("Downloading XTTS v2 model...")
device = "cuda" if torch.cuda.is_available() else "cpu"
TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
print("Model download complete.")
