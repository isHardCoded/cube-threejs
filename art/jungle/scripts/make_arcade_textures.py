"""Soft-arcade albedos from ambientCG Color maps (CC0).

Tint + flatten contrast so they read as toon detail under MeshToonMaterial,
not photo-PBR mud.
"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "refs" / "ambientcg"
OUT = ROOT.parents[1] / "public" / "assets" / "maps" / "jungle" / "textures"
REF_OUT = ROOT / "refs" / "textures"
SIZE = 512


def find_color(folder: Path) -> Path | None:
    if not folder.is_dir():
        return None
    for p in folder.rglob("*Color*.png"):
        return p
    for p in folder.rglob("*.png"):
        if "Normal" in p.name or "Rough" in p.name or "Disp" in p.name or "AO" in p.name:
            continue
        if "Ambient" in p.name:
            continue
        return p
    return None


def soft_grade(img: Image.Image, tint: tuple[int, int, int], *, sat=0.55, contrast=0.62, bright=1.18, blur=0.6):
    img = img.convert("RGB").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    # flatten toward pastel tint
    tint_img = Image.new("RGB", img.size, tint)
    img = Image.blend(img, tint_img, 0.42)
    img = ImageEnhance.Color(img).enhance(sat)
    img = ImageEnhance.Contrast(img).enhance(contrast)
    img = ImageEnhance.Brightness(img).enhance(bright)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(radius=blur))
    # slight unsharp for readable grain without noise
    img = img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=4))
    return img


def make_water() -> Image.Image:
    """Stylized soft water — ambientCG water packs are often unavailable."""
    import math
    import random

    rnd = random.Random(42)
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    c0 = (122, 210, 230)
    c1 = (90, 180, 210)
    c2 = (200, 245, 255)
    for y in range(SIZE):
        for x in range(SIZE):
            n = (
                math.sin(x * 0.045 + y * 0.02) * 0.5
                + math.sin(x * 0.02 - y * 0.05) * 0.35
                + math.sin((x + y) * 0.08) * 0.15
            )
            t = (n + 1) * 0.5
            if t < 0.45:
                a = t / 0.45
                r = int(c0[0] * (1 - a) + c1[0] * a)
                g = int(c0[1] * (1 - a) + c1[1] * a)
                b = int(c0[2] * (1 - a) + c1[2] * a)
            else:
                a = (t - 0.45) / 0.55
                r = int(c1[0] * (1 - a) + c2[0] * a)
                g = int(c1[1] * (1 - a) + c2[1] * a)
                b = int(c1[2] * (1 - a) + c2[2] * a)
            # soft sparkle
            if rnd.random() < 0.004:
                r = g = b = 245
            px[x, y] = (r, g, b)
    img = img.filter(ImageFilter.GaussianBlur(radius=1.1))
    return img


def shift_hue_green(img: Image.Image, amount=0.15) -> Image.Image:
    """Nudge foliage toward soft spring green."""
    r, g, b = img.split()
    g = g.point(lambda v: min(255, int(v * (1 + amount) + 12)))
    r = r.point(lambda v: max(0, int(v * (1 - amount * 0.35))))
    return Image.merge("RGB", (r, g, b))


def save(name: str, img: Image.Image):
    OUT.mkdir(parents=True, exist_ok=True)
    REF_OUT.mkdir(parents=True, exist_ok=True)
    for dest in (OUT / f"{name}.png", REF_OUT / f"{name}.png"):
        img.save(dest, optimize=True)
        print("wrote", dest, dest.stat().st_size)


def main():
    jobs = [
        ("bark", "bark", (196, 150, 108), dict(sat=0.5, contrast=0.58, bright=1.22)),
        ("moss", "moss", (130, 200, 100), dict(sat=0.6, contrast=0.55, bright=1.2)),
        ("dirt", "dirt", (220, 198, 150), dict(sat=0.45, contrast=0.5, bright=1.28)),
        ("stone", "stone", (210, 205, 198), dict(sat=0.35, contrast=0.55, bright=1.25)),
        ("leaf", "leaf", (120, 195, 105), dict(sat=0.65, contrast=0.55, bright=1.18)),
        ("leaf_alt", "leaf_dark", (90, 160, 95), dict(sat=0.6, contrast=0.58, bright=1.1)),
    ]
    for folder, name, tint, kw in jobs:
        src = find_color(REF / folder)
        if not src:
            print("MISSING", folder)
            continue
        img = soft_grade(Image.open(src), tint, **kw)
        if "leaf" in name or name == "moss":
            img = shift_hue_green(img, 0.12 if name != "leaf_dark" else 0.05)
        save(name, img)

    # yellow leaves from leaf
    leaf = find_color(REF / "leaf")
    if leaf:
        img = soft_grade(Image.open(leaf), (230, 210, 90), sat=0.7, contrast=0.55, bright=1.25)
        save("leaf_yellow", img)

    save("water", make_water())
    print("done")


if __name__ == "__main__":
    main()
