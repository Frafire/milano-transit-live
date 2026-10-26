"""Pixel-art M3 signal icons (11 x 18 pixels) - the same maps are used in the page (web/template.html, SIGPIX).
Writes previews to web/assets/signals/. Aspects: stop (red), go (red + white, via libera on M3), white (white only, M1)."""
import os
from PIL import Image
MAP = [
    "..ggggggg..",
    ".gGkkkkkGg.",
    "gGkkkkkkkGg",
    "gGkkRRRkkGg",
    "gGkRhRRRkGg",
    "gGkRRRRRkGg",
    "gGkRRRRRkGg",
    "gGkkRRRkkGg",
    "gGkkkkkkkGg",
    "gGkkkkkkkGg",
    "gGkkWWWkkGg",
    "gGkWhWWWkGg",
    "gGkWWWWWkGg",
    "gGkWWWWWkGg",
    "gGkkWWWkkGg",
    "gGkkkkkkkGg",
    ".gGkkkkkGg.",
    "..ggggggg..",
]
BASE = {'g': (160, 160, 160), 'G': (222, 222, 222), 'k': (16, 16, 16)}
ASPECT = {
    'stop':  {'R': (214, 0, 18), 'W': (58, 58, 58)},
    'go':    {'R': (214, 0, 18), 'W': (236, 236, 236)},
    'white': {'R': (60, 10, 12), 'W': (236, 236, 236)},
}
def render(aspect, scale=1):
    w, h = len(MAP[0]), len(MAP)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); px = im.load()
    for y, row in enumerate(MAP):
        for x, ch in enumerate(row):
            if ch == '.': continue
            if ch == 'h':        # lamp highlight: one lighter pixel when lit
                lamp = 'R' if y < 9 else 'W'; c = ASPECT[aspect][lamp]
                lit = c[0] > 150 or c[1] > 150
                c = tuple(min(255, v + 60) for v in c) if lit else c
            else:
                c = BASE.get(ch) or ASPECT[aspect][ch]
            px[x, y] = c + (255,)
    return im.resize((w * scale, h * scale), Image.NEAREST)
if __name__ == '__main__':
    out = os.path.join(os.path.dirname(__file__), '..', 'web', 'assets', 'signals')
    os.makedirs(out, exist_ok=True)
    for a in ASPECT:
        render(a).save(os.path.join(out, a + '.png'))
        render(a, 8).save(os.path.join(out, a + '@8x.png'))
    sheet = Image.new('RGBA', (3 * 11 * 8 + 4 * 16, 18 * 8 + 32), (30, 34, 38, 255))
    for i, a in enumerate(ASPECT): sheet.paste(render(a, 8), (16 + i * (88 + 16), 16), render(a, 8))
    sheet.save(os.path.join(out, 'preview.png'))
    print('icons written to', os.path.abspath(out))
