"""Rasterize the Ilzi mark from favicon.svg — even-odd path, optically padded."""

from __future__ import annotations

import re
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public"
BG = (33, 33, 33)  # #212121
GOLD = (212, 188, 130)  # #d4bc82
PAD = 0.18

# Same even-odd path as public/favicon.svg and EalzyMark.
PATH = (
    "M36 0C55.8823 0 72 16.1177 72 36C72 55.8823 55.8823 72 36 72C16.1177 72 0 55.8823 0 36C0 16.1177 16.1177 0 36 0Z"
    "M46 7C33.8497 7 24 19.9837 24 36C24 52.0163 33.8497 65 46 65C58.1503 65 68 52.0163 68 36C68 19.9837 58.1503 7 46 7Z"
    "M59.7891 44.668C57.4951 52.5081 52.1856 58 46 58C39.8143 58 34.5039 52.5083 32.21 44.668C35.288 46.9081 39.8385 49 46 49C52.1611 49 56.7111 46.9079 59.7891 44.668Z"
    "M41 22C45.9706 22 50 26.0294 50 31C50 35.9706 45.9706 40 41 40C36.0294 40 32 35.9706 32 31C32 26.0294 36.0294 22 41 22Z"
)


def write_png(path: Path, size: int, pixels: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    rows = b"".join(b"\x00" + pixels[y * size * 3 : (y + 1) * size * 3] for y in range(size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")
    )


def _cubic(p0: tuple[float, float], p1: tuple[float, float], p2: tuple[float, float], p3: tuple[float, float], steps: int):
    pts: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
        y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
        pts.append((x, y))
    return pts


def parse_rings(d: str) -> list[list[tuple[float, float]]]:
    spaced = re.sub(r"([A-Za-z])", r" \1 ", d)
    spaced = spaced.replace(",", " ")
    spaced = re.sub(r"(?<![eE])-", r" -", spaced)
    tokens = spaced.split()
    rings: list[list[tuple[float, float]]] = []
    ring: list[tuple[float, float]] = []
    cmd = ""
    i = 0

    def num() -> float:
        nonlocal i
        value = float(tokens[i])
        i += 1
        return value

    while i < len(tokens):
        token = tokens[i]
        if token in {"M", "C", "Z", "m", "c", "z"}:
            cmd = token.upper()
            i += 1
            if cmd == "Z":
                if ring:
                    rings.append(ring)
                    ring = []
            continue
        if cmd == "M":
            if ring:
                rings.append(ring)
                ring = []
            ring.append((num(), num()))
            cmd = "L"
            continue
        if cmd == "C":
            start = ring[-1]
            c1 = (num(), num())
            c2 = (num(), num())
            end = (num(), num())
            ring.extend(_cubic(start, c1, c2, end, 48)[1:])
            continue
        raise ValueError(f"unsupported SVG command {cmd!r}")
    if ring:
        rings.append(ring)
    return rings


def even_odd_mask(size: int, pad: float) -> bytearray:
    """1 = gold, 0 = background. Mark lives in 0..72, padded into the square."""
    scale = (size - pad * 2) / 72.0
    rings = [
        [((x * scale) + pad, (y * scale) + pad) for x, y in ring] for ring in parse_rings(PATH)
    ]
    hits: list[list[float]] = [[] for _ in range(size)]
    mask = bytearray(size * size)
    for ring in rings:
        count = len(ring)
        for i in range(count):
            x0, y0 = ring[i]
            x1, y1 = ring[(i + 1) % count]
            if y0 == y1:
                continue
            if y0 > y1:
                x0, y0, x1, y1 = x1, y1, x0, y0
            y_start = max(0, int(y0))
            y_end = min(size - 1, int(y1))
            dy = y1 - y0
            for y in range(y_start, y_end + 1):
                cy = y + 0.5
                if cy < y0 or cy >= y1:
                    continue
                t = (cy - y0) / dy
                hits[y].append(x0 + t * (x1 - x0))
    for y, xs in enumerate(hits):
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            left = max(0, int(xs[i] + 0.5))
            right = min(size, int(xs[i + 1] + 0.5))
            row = y * size
            for x in range(left, right):
                mask[row + x] = 1
    return mask


def render(size: int, samples: int = 4) -> bytes:
    pad = size * PAD
    hi = size * samples
    mask = even_odd_mask(hi, pad * samples)
    pixels = bytearray(size * size * 3)
    area = samples * samples
    for y in range(size):
        for x in range(size):
            filled = 0
            base = (y * samples) * hi + (x * samples)
            for oy in range(samples):
                row = base + oy * hi
                filled += sum(mask[row : row + samples])
            t = filled / area
            o = (y * size + x) * 3
            pixels[o] = int(BG[0] + (GOLD[0] - BG[0]) * t + 0.5)
            pixels[o + 1] = int(BG[1] + (GOLD[1] - BG[1]) * t + 0.5)
            pixels[o + 2] = int(BG[2] + (GOLD[2] - BG[2]) * t + 0.5)
    return bytes(pixels)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    files = {
        "apple-touch-icon.png": 180,
        "apple-touch-icon-120x120.png": 120,
        "apple-touch-icon-152x152.png": 152,
        "apple-touch-icon-167x167.png": 167,
        "apple-touch-icon-180x180.png": 180,
        "apple-touch-icon-precomposed.png": 180,
        "apple-touch-icon-180x180-precomposed.png": 180,
        "icon-192.png": 192,
        "icon-512.png": 512,
    }
    for name, size in files.items():
        write_png(ROOT / name, size, render(size))
    leftover = ROOT / "_icon-gen"
    if leftover.exists():
        for child in leftover.iterdir():
            child.unlink()
        leftover.rmdir()


if __name__ == "__main__":
    main()
