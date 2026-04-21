"""Download F5-TTS model + Vocos vocoder + Whisper ASR during install."""
from f5_tts.api import F5TTS

print("Downloading F5-TTS model and Vocos vocoder...")
model = F5TTS()

# Pre-download Whisper model used for reference audio transcription
print("Downloading Whisper ASR model...")
from f5_tts.infer.utils_infer import initialize_asr_pipeline
initialize_asr_pipeline()

print("All models downloaded.")
