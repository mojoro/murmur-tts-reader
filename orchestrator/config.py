from pathlib import Path
import os

DATA_DIR = Path(os.environ.get("MURMUR_DATA_DIR", "./data"))
DB_PATH = DATA_DIR / "murmur.db"
AUDIO_DIR = DATA_DIR / "audio"
VOICES_DIR = DATA_DIR / "voices" / "cloned"
JWT_SECRET = os.environ.get("MURMUR_JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72
