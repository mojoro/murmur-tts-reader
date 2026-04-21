"""Download Pocket TTS model during install so it's ready at engine start."""
from pocket_tts import TTSModel

print("Downloading Pocket TTS model...")
TTSModel.load_model()
print("Model download complete.")
