"""Frames raw App Store screenshots (store/ios/raw/<iphone|ipad>/*.png, from the screenshot UI test) into
captioned store images in store/ios/screenshots/en-US: iPhone 6.9-inch (1320 x 2868) and 6.5-inch
(1284 x 2778), and iPad 13-inch (2064 x 2752).

Captions and colours: store/ios/screenshots.json, for example
  {"kicker": "MY APP", "background": "#FFC23D", "dots": "#E8A92E", "ink": "#16130F", "accent": "#16130F",
   "headline_color": "#16130F", "subtitle_color": "#3A2F1C",
   "shots": [{"raw": "01-home", "headline": "Line one,\\nline two.", "subtitle": "One sentence."}]}
Without that file, or with "frame": false, the raw shots are only resized (no captions).
Needs Pillow: python3 -m pip install --user pillow
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "store/ios/raw"
STORE = ROOT / "store/ios/screenshots/en-US"
CONFIG = ROOT / "store/ios/screenshots.json"
SF = "/System/Library/Fonts/SFNS.ttf"
# Raw folder -> canvas, text scale, device inset and corner radius, and the store sizes cut from it.
DEVICES = {
    "iphone": dict(size=(1320, 2868), k=1.0, side=150, radius=120, out={"6.9": (1320, 2868), "6.5": (1284, 2778)}),
    "ipad": dict(size=(2064, 2752), k=1.05, side=170, radius=56, out={"ipad-13": (2064, 2752)}),
}


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def font(size, weight):
    try:
        f = ImageFont.truetype(SF, size)
        f.set_variation_by_axes([100, min(size, 96), 400, weight])  # Width, Optical size, GRAD, Weight
        return f
    except Exception:
        return ImageFont.load_default(size)


def background(cfg, W, H):
    bg = Image.new("RGB", (W, H), rgb(cfg.get("background", "#FFC23D")))
    d = ImageDraw.Draw(bg)
    dot = rgb(cfg.get("dots", "#E8A92E"))
    for y in range(22, H, 44):  # the app's dotted paper
        for x in range(22, W, 44):
            d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=dot)
    return bg


def wrap(text, f, width, draw):
    lines = wrap_greedy(text, f, width, draw)
    # Balance the lines: narrow the box while the line count stays the same, so no word is left alone.
    while len(lines) > 1 and width > 200:
        narrower = wrap_greedy(text, f, width - 20, draw)
        if len(narrower) != len(lines):
            break
        lines, width = narrower, width - 20
    return lines


def wrap_greedy(text, f, width, draw):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=f) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


def centered(d, y, text, f, fill, W, tracking=0):
    if tracking:
        width = sum(d.textlength(ch, font=f) + tracking for ch in text) - tracking
        x = (W - width) / 2
        for ch in text:
            d.text((x, y), ch, font=f, fill=fill)
            x += d.textlength(ch, font=f) + tracking
    else:
        d.text(((W - d.textlength(text, font=f)) / 2, y), text, font=f, fill=fill)


def frame(raw, shot, cfg, dev):
    W, H = dev["size"]
    k = dev["k"]
    im = background(cfg, W, H)
    d = ImageDraw.Draw(im)
    ink = rgb(cfg.get("ink", "#16130F"))
    y = round(150 * k)
    if cfg.get("kicker"):
        centered(d, y, cfg["kicker"].upper(), font(round(38 * k), 700), rgb(cfg.get("accent", "#16130F")), W, 8)
        y += round(80 * k)
    head = font(round(124 * k), 860)
    for line in shot.get("headline", "").split("\n"):
        centered(d, y, line, head, rgb(cfg.get("headline_color", "#16130F")), W)
        y += round(132 * k)
    sub = font(round(50 * k), 500)
    y += round(36 * k)
    for line in wrap(shot.get("subtitle", ""), sub, W - 2 * round(150 * k), d):
        centered(d, y, line, sub, rgb(cfg.get("subtitle_color", "#3A2F1C")), W)
        y += round(66 * k)
    # Device: thick ink outline with a hard offset shadow, running off the bottom edge (the app's card look).
    top, left, bezel, radius, lift = y + round(80 * k), dev["side"], 16, dev["radius"], 26
    sw = W - 2 * left - 2 * bezel
    s = raw.convert("RGB").resize((sw, round(raw.height * sw / raw.width)), Image.LANCZOS)
    pw, ph = sw + 2 * bezel, s.height + 2 * bezel
    d.rounded_rectangle((left + lift, top + lift, left + pw + lift, top + ph + lift), radius + bezel, fill=ink)
    d.rounded_rectangle((left, top, left + pw, top + ph), radius + bezel, fill=ink)
    mask = Image.new("L", s.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *s.size), radius, fill=255)
    im.paste(s, (left + bezel, top + bezel), mask)
    return im


def main():
    cfg = json.loads(CONFIG.read_text()) if CONFIG.exists() else {"frame": False}
    framed = cfg.get("frame", True) and cfg.get("shots")
    STORE.mkdir(parents=True, exist_ok=True)
    made = 0
    for name, dev in DEVICES.items():
        src = RAW / name
        if not any(src.glob("*.png")):
            continue  # no new shots for this device: keep its current store images
        for size in dev["out"]:
            for old in STORE.glob(f"*-{size}.png"):
                old.unlink()
        shots = cfg["shots"] if framed else [{"raw": p.stem} for p in sorted(src.glob("*.png"))]
        W, H = dev["size"]
        for i, shot in enumerate(shots, 1):
            raw = Image.open(src / f"{shot['raw']}.png")
            full = frame(raw, shot, cfg, dev) if framed else raw.convert("RGB").resize((W, H), Image.LANCZOS)
            slug = shot["raw"].split("-", 1)[-1]
            for size, (w, h) in dev["out"].items():
                full.resize((w, round(H * w / W)), Image.LANCZOS).crop((0, 0, w, h)).save(STORE / f"{i:02d}-{slug}-{size}.png")
                made += 1
    print(f"{made} store screenshots in {STORE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
