"""Writes the iOS identity tokens (one file per direction × mode) and checks WCAG contrast.

Source of truth for the M3.0 prototypes; mirrors ios/Prototypes/Sources/Theme.swift.
Run: python3 make_tokens.py  (exits 1 if any pair fails)
"""
import json, sys, pathlib

# role: {direction: (light, dark)}. "linen" and "ink" are the shipped themes beside Postcard (M3.5):
# Chrome's Moss and Minimalist styles, rethought for the Postcard objects.
C = {
 "table":    {"postcard": ("#EDE6DA", "#15130F"), "cabinet": ("#D9D3C7", "#0F1011"), "daylight": ("#F3F4F7", "#08090C"), "linen": ("#E6E9E3", "#121513"), "ink": ("#F4F4F2", "#0B0B0B")},
 "paper":    {"postcard": ("#FBF8F2", "#24211C"), "cabinet": ("#F6F2EA", "#222326"), "daylight": ("#FFFFFF", "#16181D"), "linen": ("#F8F9F6", "#1D211E"), "ink": ("#FFFFFF", "#171717")},
 "well":     {"postcard": ("#E4DCCD", "#1D1A16"), "cabinet": ("#CBC4B6", "#18191B"), "daylight": ("#E9EBF0", "#111318"), "linen": ("#DCE0D9", "#181B19"), "ink": ("#EAEAE7", "#121212")},
 "ink":      {"postcard": ("#1E1C19", "#F1ECE3"), "cabinet": ("#191A1B", "#ECE9E3"), "daylight": ("#0F1115", "#F0F2F5"), "linen": ("#1A1F1B", "#E9EDE8"), "ink": ("#111111", "#F2F2F2")},
 "ink-muted":{"postcard": ("#5C554B", "#AEA698"), "cabinet": ("#4E4C48", "#A39F97"), "daylight": ("#575D68", "#A0A6B0"), "linen": ("#4F5750", "#A3ACA4"), "ink": ("#5A5A5A", "#A3A3A3")},
 "accent":   {"postcard": ("#24439A", "#9AB0F2"), "cabinet": ("#7E5210", "#E2B366"), "daylight": ("#2B59D9", "#7C9BFF"), "linen": ("#3F5B45", "#A9C4AE"), "ink": ("#111111", "#F2F2F2")},
 "on-accent":{"postcard": ("#FFFFFF", "#0E1630"), "cabinet": ("#FFFFFF", "#1A1204"), "daylight": ("#FFFFFF", "#0B1020"), "linen": ("#FFFFFF", "#102014"), "ink": ("#FFFFFF", "#0B0B0B")},
 "stamp":    {d: ("#A8342A", "#F08E7E") for d in ("postcard", "cabinet", "daylight", "linen", "ink")},
}
KIND = {"place": ("#A8342A", "#F08E7E"), "recipe": ("#4A6E12", "#A9D46A"), "film": ("#4F3DBF", "#ADA2FF"),
        "book": ("#7E4519", "#E3A878"), "product": ("#8C5300", "#F0B45A"), "video": ("#8E1D9C", "#E59CF0"),
        "article": ("#1D5AA8", "#8DB8FF"), "workout": ("#0C6E69", "#5FD3CB")}
SHAPE = {"postcard": {"card": 4, "control": 6, "sheet": 6}, "linen": {"card": 4, "control": 6, "sheet": 6}, "ink": {"card": 2, "control": 4, "sheet": 4}, "cabinet": {"card": 10, "control": 12, "sheet": 16},
         "daylight": {"card": 26, "control": 29, "sheet": 38}}
TYPE = {"linen": {"display": "New York semibold", "title": "New York semibold", "label": "SF Pro medium", "body": "SF Pro"},
        "ink": {"display": "New York regular", "title": "New York medium", "label": "SF Pro medium", "body": "SF Pro"},
        "postcard": {"display": "New York (system serif) semibold", "title": "New York semibold", "label": "SF Pro medium", "body": "SF Pro / New York for reading"},
        "cabinet": {"display": "SF Pro Condensed bold, uppercase", "title": "SF Pro Condensed semibold", "label": "SF Mono medium, uppercase", "body": "SF Pro"},
        "daylight": {"display": "SF Pro Rounded bold", "title": "SF Pro Rounded semibold", "label": "SF Pro Rounded semibold", "body": "SF Pro Rounded"}}

def lum(h):
    r, g, b = (int(h[i:i+2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

# (fg, bg, minimum): 4.5 for text, 3.0 for large text and UI marks
PAIRS = [("ink", "table", 4.5), ("ink", "paper", 4.5), ("ink", "well", 4.5),
         ("ink-muted", "table", 4.5), ("ink-muted", "paper", 4.5), ("ink-muted", "well", 3.0),
         ("on-accent", "accent", 4.5), ("accent", "paper", 4.5), ("accent", "table", 3.0),
         ("stamp", "paper", 4.5)] + [(f"kind-{k}", "paper", 4.5) for k in KIND] + [(f"kind-{k}", "table", 4.5) for k in KIND]
SHIPPED = ("postcard", "linen", "ink")   # the M3.0 prototype directions (cabinet, daylight) keep the old 3:1 for kind-on-table

fails = 0
out = pathlib.Path(__file__).parent
for d in ("postcard", "cabinet", "daylight", "linen", "ink"):
    for m, i in (("light", 0), ("dark", 1)):
        col = {r: v[d][i] for r, v in C.items()} | {f"kind-{k}": v[i] for k, v in KIND.items()}
        (out / f"{d}.{m}.json").write_text(json.dumps({"direction": d, "mode": m, "color": col, "radius": SHAPE[d], "type": TYPE[d]}, indent=1) + "\n")
        lines = []
        for fg, bg, need in PAIRS:
            if d not in SHIPPED and fg.startswith("kind-") and bg == "table": need = 3.0
            r = ratio(col[fg], col[bg]); ok = r >= need; fails += not ok
            lines.append(f"{'ok  ' if ok else 'FAIL'} {r:5.2f} (≥{need}) {fg} on {bg}")
        (out / f"{d}.{m}.contrast.txt").write_text("\n".join(lines) + "\n")
        bad = [l for l in lines if l.startswith("FAIL")]
        print(f"{d}.{m}: {len(lines) - len(bad)}/{len(lines)} pass", *bad, sep="\n  ")
sys.exit(1 if fails else 0)
