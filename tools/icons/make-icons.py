"""Renders every Keepsake icon from tools/icons/pocket.png (the felt pocket artwork, light version).

Light keeps the artwork as drawn. Dark lifts the felt and dims the cards so the pocket reads on a dark
background without glare. Tinted is a grayscale version for iOS tinted home screens.

Run from the repo root: python3 tools/icons/make-icons.py [preview-dir]
Needs Pillow.
"""
import json, os, sys
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART = Image.open(os.path.join(ROOT, 'tools/icons/pocket.png')).convert('RGBA')

LIGHT_BG = ((0xF6, 0xF1, 0xE7), (0xE8, 0xE0, 0xD0))   # warm linen, top to bottom
DARK_BG = ((0x1D, 0x24, 0x1E), (0x0E, 0x12, 0x0F))    # deep forest, top to bottom


def art(mode):
    if mode == 'light':
        return ART.copy()
    r, g, b, a = ART.split()
    if mode == 'dark':
        # Compress the tones: felt 58 -> 70, cards 226 -> 202, gold keeps its warmth.
        lift = lambda v: round(24 + v * 0.786)
        rgb = ImageEnhance.Color(Image.merge('RGB', (r, g, b)).point(lift)).enhance(1.15)
        out = rgb.convert('RGBA')
        out.putalpha(a)
        return out
    if mode == 'tinted':
        gray = ImageOps.autocontrast(Image.merge('RGB', (r, g, b)).convert('L'), cutoff=1)
        gray = gray.point(lambda v: round(40 + v * 215 / 255))
        out = Image.merge('RGBA', (gray, gray, gray, a))
        return out
    raise ValueError(mode)


def gradient(size, top, bottom):
    g = Image.new('RGB', (1, size))
    for y in range(size):
        t = y / (size - 1)
        g.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return g.resize((size, size)).convert('RGBA')


def placed(mode, size, height_frac, shadow=True, rim=False):
    """The pocket centered on a transparent square canvas, `height_frac` of its height."""
    pocket = art(mode)
    h = round(size * height_frac)
    w = round(pocket.width * h / pocket.height)
    pocket = pocket.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    x, y = (size - w) // 2, (size - h) // 2 + round(size * 0.01)
    if shadow:
        alpha = pocket.getchannel('A')
        color = (0, 0, 0) if mode != 'light' else (40, 52, 36)
        strength = 0.55 if mode != 'light' else 0.28
        sh = Image.new('RGBA', (size, size), color + (0,))
        mask = Image.new('L', (size, size), 0)
        mask.paste(alpha.point(lambda v: round(v * strength)), (x, y + round(size * 0.018)))
        mask = mask.filter(ImageFilter.GaussianBlur(size * 0.022))
        sh.putalpha(mask)
        canvas.alpha_composite(sh)
    if rim:
        # A faint cream edge so the dark felt separates from a dark background.
        alpha = pocket.getchannel('A')
        edge = Image.new('L', (size, size), 0)
        edge.paste(alpha, (x, y))
        grown = edge.filter(ImageFilter.MaxFilter(max(3, (round(size * 0.004) // 2) * 2 + 1)))
        ring = ImageChops.subtract(grown, edge).filter(ImageFilter.GaussianBlur(size * 0.0015))
        glow = Image.new('RGBA', (size, size), (236, 228, 210, 0))
        glow.putalpha(ring.point(lambda v: round(v * 0.22)))
        canvas.alpha_composite(glow)
    canvas.alpha_composite(pocket, (x, y))
    return canvas


def tile(mode, size=1024, height_frac=0.74):
    """A full-bleed square app icon (iOS masks the corners itself)."""
    if mode == 'tinted':
        bg = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    else:
        bg = gradient(size, *(LIGHT_BG if mode == 'light' else DARK_BG))
    bg.alpha_composite(placed(mode, size, height_frac, shadow=mode != 'tinted', rim=mode == 'dark'))
    return bg.convert('RGB')


def mac_tile(mode, size=1024):
    """macOS icon grid: an 824 pt rounded square inset 100 pt, with a soft drop shadow."""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner = round(size * 824 / 1024)
    off = (size - inner) // 2
    radius = round(inner * 0.2237)
    mask = Image.new('L', (inner, inner), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, inner - 1, inner - 1), radius, fill=255)
    shadow = Image.new('L', (size, size), 0)
    shadow.paste(mask.point(lambda v: round(v * 0.3)), (off, off + round(size * 0.012)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.014))
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sh.putalpha(shadow)
    canvas.alpha_composite(sh)
    face = tile(mode, inner, 0.76).convert('RGBA')
    face.putalpha(mask)
    canvas.alpha_composite(face, (off, off))
    return canvas


def save(img, rel, size=None):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if size and img.size != (size, size):
        img = img.resize((size, size), Image.LANCZOS)
    img.save(path, optimize=True)


def contents(rel, data):
    with open(os.path.join(ROOT, rel, 'Contents.json'), 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')


XC = {'info': {'author': 'xcode', 'version': 1}}
DARK = [{'appearance': 'luminosity', 'value': 'dark'}]
TINTED = [{'appearance': 'luminosity', 'value': 'tinted'}]


def main():
    tiles = {m: tile(m) for m in ('light', 'dark', 'tinted')}

    # Chrome and Safari web extension: the pocket on a transparent square, artwork about 96/128 tall
    # as the Chrome Web Store asks. Light is the manifest default; the extension swaps in dark/ when
    # the browser is dark (src/toolbar/icon.js).
    for mode, folder in (('light', 'keepsake/icons'), ('dark', 'keepsake/icons/dark')):
        big = placed(mode, 512, 0.80, shadow=False, rim=mode == 'dark')
        for s in (16, 32, 48, 128):
            save(big, f'{folder}/icon{s}.png', s)

    # iOS app icon: light, dark and tinted appearances, plus fixed Light and Dark alternates.
    xc = 'ios/App/Assets.xcassets'
    save(tiles['light'], f'{xc}/AppIcon.appiconset/icon-1024.png')
    save(tiles['dark'], f'{xc}/AppIcon.appiconset/icon-1024-dark.png')
    save(tiles['tinted'], f'{xc}/AppIcon.appiconset/icon-1024-tinted.png')
    base = {'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}
    contents(f'{xc}/AppIcon.appiconset', {'images': [
        {**base, 'filename': 'icon-1024.png'},
        {**base, 'appearances': DARK, 'filename': 'icon-1024-dark.png'},
        {**base, 'appearances': TINTED, 'filename': 'icon-1024-tinted.png'},
    ], **XC})
    for mode in ('light', 'dark'):
        name = f'AppIcon{mode.title()}'
        save(tiles[mode], f'{xc}/{name}.appiconset/icon-1024.png')
        contents(f'{xc}/{name}.appiconset', {'images': [{**base, 'filename': 'icon-1024.png'}], **XC})
        save(tiles[mode], f'{xc}/{name}Preview.imageset/preview.png', 180)
        contents(f'{xc}/{name}Preview.imageset', {'images': [{'filename': 'preview.png', 'idiom': 'universal'}], **XC})
    # The picker's "Automatic" row follows the system appearance, like the icon itself.
    save(tiles['light'], f'{xc}/AppIconPreview.imageset/preview.png', 180)
    save(tiles['dark'], f'{xc}/AppIconPreview.imageset/preview-dark.png', 180)
    contents(f'{xc}/AppIconPreview.imageset', {'images': [
        {'filename': 'preview.png', 'idiom': 'universal'},
        {'appearances': DARK, 'filename': 'preview-dark.png', 'idiom': 'universal'},
    ], **XC})

    # Safari for Mac container app: macOS app icon sizes, and the icon on its welcome page.
    mac = mac_tile('light')
    appicon = 'safari/Keepsake/Keepsake/Assets.xcassets/AppIcon.appiconset'
    for s in (16, 32, 128, 256, 512):
        save(mac, f'{appicon}/mac-icon-{s}@1x.png', s)
        save(mac, f'{appicon}/mac-icon-{s}@2x.png', s * 2)
    res = 'safari/Keepsake/Keepsake/Resources'
    save(mac, f'{res}/Icon.png', 256)
    save(mac_tile('dark'), f'{res}/Icon-dark.png', 256)

    if len(sys.argv) > 1:
        out = sys.argv[1]
        os.makedirs(out, exist_ok=True)
        for mode, img in tiles.items():
            img.save(os.path.join(out, f'keepsake-icon-{mode}.png'))
        mac_tile('dark').save(os.path.join(out, 'keepsake-icon-mac-dark.png'))
        mac.save(os.path.join(out, 'keepsake-icon-mac-light.png'))


if __name__ == '__main__':
    main()
