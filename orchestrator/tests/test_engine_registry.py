import pytest
from orchestrator.engine_registry import ENGINES, get_engine


def test_five_engines_registered():
    assert len(ENGINES) == 5


def test_pocket_tts_is_default():
    engine = get_engine("pocket-tts")
    assert engine.display_name == "Pocket TTS"
    assert engine.builtin_voices is True


def test_all_engines_have_repo_dir():
    for name, engine in ENGINES.items():
        assert engine.repo_dir, f"{name} missing repo_dir"


def test_unknown_engine_raises():
    with pytest.raises(ValueError, match="Unknown engine"):
        get_engine("nonexistent")
