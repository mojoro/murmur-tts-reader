from pathlib import Path
import os

DATA_DIR = Path(os.environ.get("MURMUR_DATA_DIR", "./data"))
DB_PATH = DATA_DIR / "murmur.db"
AUDIO_DIR = DATA_DIR / "audio"
THUMBNAILS_DIR = DATA_DIR / "thumbnails"
VOICES_DIR = DATA_DIR / "voices" / "cloned"
JWT_SECRET = os.environ.get("MURMUR_JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72

ENGINES_DIR = DATA_DIR / "engines"
ENGINE_PORT = int(os.environ.get("MURMUR_ENGINE_PORT", "8100"))
ALIGN_SERVER_URL = os.environ.get("MURMUR_ALIGN_URL", "http://localhost:8001")
