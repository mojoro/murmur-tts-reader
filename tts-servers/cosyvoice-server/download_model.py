"""Download the CosyVoice2-0.5B model from ModelScope.

Usage:
    cd cosyvoice-server
    uv run --no-project --python .venv/bin/python download_model.py
"""
from modelscope import snapshot_download

snapshot_download(
    "iic/CosyVoice2-0.5B",
    local_dir="models/CosyVoice2-0.5B",
)
print("Model downloaded to models/CosyVoice2-0.5B")
