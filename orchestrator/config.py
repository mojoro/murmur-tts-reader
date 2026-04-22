import logging
from pathlib import Path
import os

DATA_DIR = Path(os.environ.get("MURMUR_DATA_DIR", "./data"))
DB_PATH = DATA_DIR / "murmur.db"
AUDIO_DIR = DATA_DIR / "audio"
THUMBNAILS_DIR = DATA_DIR / "thumbnails"
IMAGES_DIR = DATA_DIR / "images"
VOICES_DIR = DATA_DIR / "voices" / "cloned"


def _resolve_jwt_secret() -> str:
    """Return the JWT signing secret, or raise if unset in prod.

    Set MURMUR_JWT_SECRET to a 32+ byte random value in production.
    For local dev, set MURMUR_ALLOW_DEV_SECRET=1 to use a fixed
    placeholder secret.
    """
    secret = os.environ.get("MURMUR_JWT_SECRET")
    if secret:
        if len(secret) < 32:
            logging.getLogger(__name__).warning(
                "MURMUR_JWT_SECRET is shorter than 32 bytes; this triggers "
                "jwt's InsecureKeyLengthWarning and weakens HS256."
            )
        return secret
    if os.environ.get("MURMUR_ALLOW_DEV_SECRET") == "1":
        return "dev-secret-change-in-production-ONLY-for-local-dev"
    raise RuntimeError(
        "MURMUR_JWT_SECRET is not set. Set a 32+ byte random secret "
        "(see .env.example), or set MURMUR_ALLOW_DEV_SECRET=1 for "
        "local development."
    )


JWT_SECRET = _resolve_jwt_secret()
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72

ENGINES_DIR = DATA_DIR / "engines"
ENGINE_PORT = int(os.environ.get("MURMUR_ENGINE_PORT", "8100"))
ALIGN_SERVER_URL = os.environ.get("MURMUR_ALIGN_URL", "http://localhost:8001")
