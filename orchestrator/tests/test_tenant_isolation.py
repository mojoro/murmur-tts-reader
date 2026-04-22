import pytest
from pathlib import Path

pytestmark = pytest.mark.anyio


async def _register(client, email: str) -> int:
    res = await client.post(
        "/auth/register", json={"email": email, "password": "secret12345"}
    )
    assert res.status_code == 201
    return res.json()["user"]["id"]


async def _create_read(client, user_id: int, title: str = "t") -> int:
    res = await client.post(
        "/reads",
        headers={"X-User-Id": str(user_id)},
        json={"title": title, "content": "Hello world."},
    )
    assert res.status_code == 201
    return res.json()["id"]


def _write_fake_audio(audio_dir: Path, read_id: int, seg_index: int = 0) -> None:
    d = audio_dir / str(read_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{seg_index}.wav").write_bytes(b"RIFF...fakewav")


async def test_cannot_fetch_other_users_audio_segment(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice, "alice-secret")
    _write_fake_audio(tmp_path / "audio", alice_read, 0)

    res = await client.get(
        f"/audio/{alice_read}/0",
        headers={"X-User-Id": str(bob)},
    )
    assert res.status_code == 404


async def test_cannot_fetch_other_users_audio_bundle(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice, "alice-secret")
    _write_fake_audio(tmp_path / "audio", alice_read, 0)

    res = await client.get(
        f"/audio/{alice_read}/bundle",
        headers={"X-User-Id": str(bob)},
    )
    assert res.status_code == 404


async def test_owner_can_fetch_their_audio(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    alice_read = await _create_read(client, alice)
    _write_fake_audio(tmp_path / "audio", alice_read, 0)

    res = await client.get(
        f"/audio/{alice_read}/0",
        headers={"X-User-Id": str(alice)},
    )
    assert res.status_code == 200


async def test_cannot_fetch_other_users_thumbnail(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice)
    (tmp_path / "thumbnails" / f"{alice_read}.jpg").write_bytes(b"fakejpeg")

    res = await client.get(
        f"/thumbnails/{alice_read}",
        headers={"X-User-Id": str(bob)},
    )
    assert res.status_code == 404


async def test_cannot_overwrite_other_users_thumbnail(client):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice)

    res = await client.post(
        f"/reads/{alice_read}/thumbnail",
        headers={"X-User-Id": str(bob), "Content-Type": "application/json"},
        json={"url": "http://example.com/x.jpg"},
    )
    assert res.status_code == 404


async def test_cannot_fetch_other_users_image(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice)
    img_dir = tmp_path / "images" / str(alice_read)
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / "0.jpg").write_bytes(b"fakejpeg")

    res = await client.get(
        f"/images/{alice_read}/0",
        headers={"X-User-Id": str(bob)},
    )
    assert res.status_code == 404


async def test_cannot_upload_image_to_other_users_read(client):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice)

    res = await client.post(
        f"/reads/{alice_read}/images",
        headers={"X-User-Id": str(bob), "Content-Type": "application/json"},
        json={"url": "http://example.com/x.jpg", "index": 0},
    )
    assert res.status_code == 404
