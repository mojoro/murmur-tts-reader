import re

ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "ave", "blvd",
    "gen", "gov", "sgt", "cpl", "pvt", "capt", "lt", "col", "maj",
    "rev", "hon", "pres", "dept", "univ", "assn", "bros", "inc", "ltd",
    "co", "corp", "vs", "est", "vol", "fig", "eq", "approx",
    "i.e", "e.g", "etc", "al", "cf",
}

IMAGE_MARKER_RE = re.compile(r"^\[image:\d+\]$")


def split_sentences(text: str) -> list[str]:
    sentences: list[str] = []

    # Split on image markers first — they become standalone segments
    parts = re.split(r"(\[image:\d+\])", text)

    for part in parts:
        stripped = part.strip()
        if not stripped:
            continue
        if IMAGE_MARKER_RE.match(stripped):
            sentences.append(stripped)
            continue
        # Split prose into sentences
        sentences.extend(_split_prose(stripped))

    return sentences


def _split_prose(text: str) -> list[str]:
    sentences: list[str] = []
    current = ""

    tokens = re.split(r"(\s+)", text)

    for token in tokens:
        current += token

        match = re.match(r"^(.+?)([.!?]+)$", token)
        if not match:
            continue

        word = re.sub(r"[^a-z.]", "", match.group(1).lower())

        if word in ABBREVIATIONS:
            continue

        if len(word) == 1 and word.isalpha():
            continue

        trimmed = current.strip()
        if trimmed:
            sentences.append(trimmed)
            current = ""

    remaining = current.strip()
    if remaining:
        sentences.append(remaining)

    return sentences
