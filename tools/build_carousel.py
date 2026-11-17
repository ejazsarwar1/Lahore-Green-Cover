"""Build the LinkedIn carousel (7 slides, 4:5) from the study's saved numbers and the story site's map images.

Usage:
  python -I build_carousel.py <map_dir> <out_dir>

<map_dir> holds map_2025, map_change (.png or .webp, transparent outside the district); larger maps give
sharper slides. Slides are laid out on a 1080 x 1350 grid and drawn at 2x (2160 x 2700) so text and charts stay
crisp. Writes slide_1.png ... slide_7.png and lahore_city_of_gardens_carousel.pdf (upload the PDF to LinkedIn as a
document). Colours and wording follow the story site (docs/index.html).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

S = 2                                   # drawing scale: 1080 x 1350 layout, 2160 x 2700 pixels
W, H = 1080, 1350
FONT_DIR = r'C:\Windows\Fonts'
PAPER, CARD, INK, INK2, MUTED, LINE = '#f6f3ea', '#fffdf8', '#14231d', '#3d4a44', '#6b756f', '#e3ddcf'
BRAND, GOLD, RED = '#14532d', '#c98714', '#b4361f'
C = {'trees': '#1f6e3d', 'grass': '#9cc44a', 'built': '#6b7280', 'crops': '#c98714', 'water': '#2f8ad0', 'bare': '#c0573a'}
N_SLIDES = 7

# ---------------------------------------------------------------- the study's numbers (saved results, November 2026)
YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025]
TREES = [62.92, 67.24, 73.45, 76.85, 74.04, 68.82, 69.81]
GRASS = [144.32, 147.92, 151.82, 153.43, 154.85, 156.60, 171.40]
CROP_CHANGE = [0, 12, -24, -48, -73, -63, -66]      # farmland, this study's crop model, km² since 2019
BUILT_CHANGE = [0, 11, -7, 28, 88, 71, 66]          # built-up, Google Dynamic World, km² since 2019
BUDGET = [('trees', 'Trees', 70), ('grass', 'Grass, lawns, parks', 171), ('built', 'Built-up', 496),
          ('crops', 'Cropland', 748), ('water', 'Water', 11), ('bare', 'Bare ground', 197)]
CROP_SEASONS = [('Two crops a year', 603, '#8a5a00'), ('Winter only', 89, '#c98714'),
                ('Summer only', 49, '#e3b860'), ('Unclear', 8, '#efdcae')]
GAINS = [('DHA Phase 7', 16), ('Govt Servants Housing', 16), ('Lakhoder (Mehmood Booti)', 15), ('DHA Phase 8', 14)]


def font(name, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, name), int(size * S))


SERIF_B = lambda s: font('georgiab.ttf', s)
SANS = lambda s: font('segoeui.ttf', s)
SANS_B = lambda s: font('segoeuib.ttf', s)
SANS_SB = lambda s: font('seguisb.ttf', s)
SYM = lambda s: font('seguisym.ttf', s)      # arrows and ticks (missing from Georgia and Segoe UI Bold)


class Draw:
    """ImageDraw on the 2x canvas, addressed in 1080 x 1350 layout units."""

    def __init__(self, im):
        self.d = ImageDraw.Draw(im)

    @staticmethod
    def _p(v):
        return [x * S for x in v]

    def text(self, xy, t, font, fill, anchor=None):
        self.d.text(self._p(xy), t, font=font, fill=fill, anchor=anchor)

    def textlength(self, t, font):
        return self.d.textlength(t, font=font) / S

    def line(self, pts, fill, width=1, joint=None):
        flat = [c * S for p in pts for c in (p if isinstance(p, tuple) else (p,))]
        self.d.line(flat, fill=fill, width=int(width * S), joint=joint)

    def rectangle(self, box, fill):
        self.d.rectangle(self._p(box), fill=fill)

    def rounded_rectangle(self, box, radius, fill=None, outline=None, width=1):
        self.d.rounded_rectangle(self._p(box), radius=radius * S, fill=fill, outline=outline, width=int(width * S))

    def ellipse(self, box, fill, outline=None, width=1):
        self.d.ellipse(self._p(box), fill=fill, outline=outline, width=int(width * S))


def wrap(d, text, f, width):
    lines, line = [], ''
    for w in text.split():
        t = (line + ' ' + w).strip()
        if d.textlength(t, f) <= width:
            line = t
        else:
            lines.append(line)
            line = w
    lines.append(line)
    return lines


def text_block(d, xy, text, f, fill, width, gap=1.3):
    x, y = xy
    for ln in wrap(d, text, f, width):
        d.text((x, y), ln, f, fill)
        y += f.size / S * gap
    return y


def runs(d, x, y, parts):
    """Draw [(text, font, colour), ...] side by side on one baseline row; returns the end x."""
    for t, f, c in parts:
        d.text((x, y), t, f, c, anchor='ls')
        x += d.textlength(t, f)
    return x


def base(n, kicker, title, dark=False):
    im = Image.new('RGB', (W * S, H * S), BRAND if dark else PAPER)
    d = Draw(im)
    y = 0
    if not dark:
        d.rectangle([0, 0, W, 10], BRAND)
        d.text((70, 62), kicker.upper(), SANS_B(24), GOLD)
        y = text_block(d, (70, 100), title, SERIF_B(58), INK, W - 140, 1.15)
    fc = '#cfe3cb' if dark else MUTED
    d.text((70, H - 74), 'City of Gardens? · Muhammad Ejaz Sarwar (PAS)', SANS(22), fc)
    for i in range(N_SLIDES):
        cx = W - 70 - (N_SLIDES - 1 - i) * 22
        d.ellipse([cx - 6, H - 68, cx + 6, H - 56], fill=(GOLD if i == n - 1 else ('#4a7a5c' if dark else LINE)))
    return im, d, y


def card(d, box, fill=CARD):
    d.rounded_rectangle(box, radius=24, fill=fill, outline=LINE, width=2)


def find_map(folder, name):
    for ext in ('.png', '.webp'):
        p = os.path.join(folder, name + ext)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(name)


def paste_map(im, path, box):
    m = Image.open(path).convert('RGBA')
    bw, bh = (box[2] - box[0]) * S, (box[3] - box[1]) * S
    m.thumbnail((bw, bh), Image.LANCZOS) if m.width > bw or m.height > bh else None
    if m.width < bw and m.height < bh:
        k = min(bw / m.width, bh / m.height)
        m = m.resize((int(m.width * k), int(m.height * k)), Image.LANCZOS)
    x = box[0] * S + (bw - m.width) // 2
    y = box[1] * S + (bh - m.height) // 2
    im.paste(m, (int(x), int(y)), m)
    return x / S, y / S, m.width / S, m.height / S


def stat_card(d, box, big, caption, colour):
    card(d, box)
    x0, y0 = box[0] + 30, box[1] + 22
    if isinstance(big, list):
        runs(d, x0, y0 + 76, big)
    else:
        d.text((x0, y0), big, SERIF_B(74), colour)
    text_block(d, (x0, y0 + 108), caption, SANS(27), INK2, box[2] - box[0] - 60)


def tick(d, cx, cy, ok):
    d.ellipse([cx - 23, cy - 23, cx + 23, cy + 23], fill='#2f7d4f' if ok else '#b7791f')
    if ok:
        d.line([(cx - 11, cy + 1), (cx - 3, cy + 10), (cx + 12, cy - 9)], fill='#ffffff', width=5, joint='curve')
    else:
        d.text((cx, cy + 1), '!', SANS_B(30), '#ffffff', anchor='mm')


# ---------------------------------------------------------------- slides
def slide1(maps):
    im, d, _ = base(1, '', '', dark=True)
    d.text((70, 90), 'LAHORE DISTRICT · 2019–2025 · FROM SPACE', SANS_B(26), '#f2c45a')
    d.text((64, 140), 'City of', SERIF_B(130), '#ffffff')
    d.text((64, 290), 'Gardens?', SERIF_B(150), '#f2c45a')
    d.text((70, 488), 'Grass cover up. Fields down.', SERIF_B(52), '#ffffff')
    d.text((70, 553), 'Trees still at 4%.', SERIF_B(52), '#f6a58c')
    d.rounded_rectangle([70, 650, W - 70, 1170], radius=28, fill=PAPER)
    paste_map(im, find_map(maps, 'map_2025'), (85, 660, W - 85, 1160))
    d.text((70, 1196), 'Seven years of Sentinel-2 satellite images, read at 10 m', SANS(28), '#d9ead3')
    runs(d, W - 190, 1232, [('Swipe ', SANS_B(30), '#f2c45a'), ('→', SYM(30), '#f2c45a')])
    return im


def slide2(maps):
    im, d, y = base(2, 'Non-crop green cover', 'Lahore got a little greener, mostly in grass')
    stat_card(d, (70, y + 30, 520, y + 262), '+34 km²', 'trees and grass added, 2019 to 2025', BRAND)
    stat_card(d, (560, y + 30, W - 70, y + 262),
              [('12%', SERIF_B(70), BRAND), (' → ', SYM(56), BRAND), ('14%', SERIF_B(70), BRAND)],
              'of the district: about 2 points more', BRAND)
    top, bot, left, right = y + 330, H - 300, 130, W - 120
    vmax = 260
    d.text((left, top - 46), 'km² of non-crop green (crops are not counted as green)', SANS(24), MUTED)
    d.line([(left, bot), (right, bot)], LINE, 2)
    for v in (0, 100, 200):
        yy = bot - (bot - top) * v / vmax
        d.line([(left, yy), (right, yy)], '#ebe6da', 1)
        d.text((left - 14, yy), str(v), SANS(22), MUTED, anchor='rm')
    n = len(YEARS)
    bw = (right - left) / n * 0.62
    for i, yr in enumerate(YEARS):
        cx = left + (right - left) * (i + 0.5) / n
        ht = (bot - top) * TREES[i] / vmax
        hg = (bot - top) * GRASS[i] / vmax
        d.rounded_rectangle([cx - bw / 2, bot - ht, cx + bw / 2, bot], radius=4, fill=C['trees'])
        d.rounded_rectangle([cx - bw / 2, bot - ht - hg, cx + bw / 2, bot - ht - 3], radius=4, fill=C['grass'])
        d.text((cx, bot + 14), str(yr), SANS(24), MUTED, anchor='ma')
        if i in (0, n - 1):
            d.text((cx, bot - ht - hg - 12), '%d' % round(TREES[i] + GRASS[i]), SANS_B(28), INK, anchor='mb')
    cx = left + (right - left) * (n - 0.5) / n
    d.text((cx + bw / 2 + 10, bot - (bot - top) * TREES[-1] / vmax / 2), 'Trees', SANS_B(22), INK, anchor='lm')
    d.text((cx + bw / 2 + 10, bot - (bot - top) * (TREES[-1] + GRASS[-1] / 2) / vmax), 'Grass', SANS_B(22), INK,
           anchor='lm')
    text_block(d, (70, H - 232), 'Tree cover barely moved. The rise is only just statistically significant, and '
               'part of the year-to-year swing follows rainfall.', SANS(28), INK2, W - 140)
    return im


def slide3(maps):
    im, d, y = base(3, 'Where it grew', 'The new green is mostly grass, much of it in new schemes')
    mx, my, mw, mh = paste_map(im, find_map(maps, 'map_change'), (70, y + 16, W - 70, y + 520))
    ky = my + mh + 22
    stops = ['#b2182b', '#f4a582', '#f7f7f7', '#a6dba0', '#1b7837']
    seg = (W - 140) / len(stops)
    for i, s in enumerate(stops):
        d.rectangle([70 + i * seg, ky, 70 + (i + 1) * seg, ky + 16], s)
    d.text((70, ky + 26), 'green lost', SANS(22), MUTED)
    d.text((W / 2, ky + 26), 'no change', SANS(22), MUTED, anchor='ma')
    d.text((W - 70, ky + 26), 'green gained', SANS(22), MUTED, anchor='ra')
    ly = ky + 78
    d.text((70, ly), 'Biggest gains, share of each 1 km² that turned green', SANS_B(27), INK)
    yy = ly + 50
    for name, pts in GAINS:
        d.text((70, yy), 'near ' + name, SANS(28), INK2)
        d.text((W - 70, yy), '+%d points' % pts, SANS_B(28), C['trees'], anchor='ra')
        d.line([(70, yy + 42), (W - 70, yy + 42)], LINE, 1)
        yy += 50
    text_block(d, (70, yy + 18), 'This study counts trees, grass and parks as green, not crop fields, so a field '
               'turned into grass or a green belt shows up as new green.', SANS(26), MUTED, W - 140)
    return im


def slide4(maps):
    im, d, y = base(4, 'Farmland', 'The city is growing over its fields')
    stat_card(d, (70, y + 30, 520, y + 262), '−66 km²', 'farmland lost, 2019 to 2025 (−9%)', C['crops'])
    stat_card(d, (560, y + 30, W - 70, y + 262), '+66 km²', 'built-up land, same years', C['built'])
    top, bot, left, right = y + 340, H - 330, 140, W - 200
    vmin, vmax = -100, 100
    yv = lambda v: top + (bot - top) * (vmax - v) / (vmax - vmin)
    d.text((left, top - 50), 'Change since 2019, km²', SANS(24), MUTED)
    for v in (-100, -50, 0, 50, 100):
        d.line([(left, yv(v)), (right, yv(v))], '#b9b2a2' if v == 0 else '#ebe6da', 2 if v == 0 else 1)
        d.text((left - 14, yv(v)), ('+%d' % v) if v > 0 else ('−%d' % -v if v < 0 else '0'), SANS(22), MUTED,
               anchor='rm')
    n = len(YEARS)
    xv = lambda i: left + (right - left) * i / (n - 1)
    for series, key, label in ((CROP_CHANGE, 'crops', 'Farmland'), (BUILT_CHANGE, 'built', 'Built-up')):
        pts = [(xv(i), yv(v)) for i, v in enumerate(series)]
        d.line(pts, C[key], 6, joint='curve')
        for p in pts:
            d.ellipse([p[0] - 9, p[1] - 9, p[0] + 9, p[1] + 9], fill=C[key], outline=PAPER, width=3)
        d.text((pts[-1][0] + 20, pts[-1][1]), label, SANS_B(26), INK, anchor='lm')
    for i, yr in enumerate(YEARS):
        d.text((xv(i), bot + 16), str(yr), SANS(22), MUTED, anchor='ma')
    text_block(d, (70, H - 232), 'About 41 km² of 2019 farmland was built on by 2025. A second, separate method '
               'finds about 51 km².', SANS(28), INK2, W - 140)
    return im


def slide5(maps):
    im, d, y = base(5, 'The whole picture, 2025', 'All of Lahore in 100 squares')
    total = sum(v for _, _, v in BUDGET)
    raw = [100 * v / total for _, _, v in BUDGET]
    cells = [int(r) for r in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - int(raw[i]), reverse=True)[:100 - sum(cells)]:
        cells[i] += 1
    colours = []
    for (k, _, _), c in zip(BUDGET, cells):
        colours += [C[k]] * c
    gx, gy, size, gap = 70, y + 40, 56, 6
    for i, col in enumerate(colours):
        r, cidx = divmod(i, 10)
        x0, y0 = gx + cidx * (size + gap), gy + r * (size + gap)
        d.rounded_rectangle([x0, y0, x0 + size, y0 + size], radius=7, fill=col)
    lx, ly = gx + 10 * (size + gap) + 34, gy + 4
    for k, name, v in BUDGET:
        d.rounded_rectangle([lx, ly + 8, lx + 26, ly + 34], radius=6, fill=C[k])
        d.text((lx + 40, ly), name, SANS_SB(27), INK)
        d.text((lx + 40, ly + 38), '%d%% · %d km²' % (round(100 * v / total), v), SANS(25), MUTED)
        ly += 100
    # inside the biggest slice: cropland by growing season, one 100% bar
    by = gy + 10 * (size + gap) + 50
    d.text((70, by), 'Inside cropland: most fields grow two crops a year', SANS_B(28), INK)
    bx, bw, crop_total = 70, W - 140, sum(v for _, v, _ in CROP_SEASONS)
    x = bx
    for name, v, col in CROP_SEASONS:
        w = bw * v / crop_total
        d.rounded_rectangle([x, by + 52, x + max(w - 3, 3), by + 96], radius=6, fill=col)
        x += w
    ky = by + 120
    for i, (name, v, col) in enumerate(CROP_SEASONS):
        cx = 70 + (i % 2) * 470
        cy = ky + (i // 2) * 44
        d.rounded_rectangle([cx, cy + 6, cx + 22, cy + 28], radius=5, fill=col)
        d.text((cx + 34, cy), '%s  %d km²' % (name, v), SANS(25), INK2)
    text_block(d, (70, ky + 110), 'Each square is 1% of the district, about 17 km². Wheat grows in winter, '
               'rice in summer.', SANS(25), MUTED, W - 140)
    return im


def bullet(d, x, y, w, label, value, unit, vmax, marks, colour):
    d.text((x, y), label, SANS_SB(30), INK)
    d.text((x + w, y - 14), value + unit, SERIF_B(56), colour, anchor='ra')
    by = y + 74
    d.rounded_rectangle([x, by, x + w, by + 28], radius=14, fill='#ece6d8')
    d.rounded_rectangle([x, by, x + max(28, w * float(value) / vmax), by + 28], radius=14, fill=colour)
    for m, t in marks:
        mx = x + w * m / vmax
        d.line([(mx, by - 10), (mx, by + 38)], INK, 4)
        d.text((min(mx, x + w), by + 50), t, SANS(23), INK2, anchor='ra' if mx > x + w - 120 else 'ma')
    return by + 132


def slide6(maps):
    im, d, y = base(6, 'Green for whom?', 'Far from the benchmarks')
    yy = y + 56
    yy = bullet(d, 70, yy, W - 140, 'Tree canopy of the district', '4.1', '%', 35, [(30, 'target 30% (3-30-300 rule)')], RED)
    yy = bullet(d, 70, yy, W - 140, 'Residents within 300 m of a park', '24', '%', 100, [(100, 'WHO/Europe: everyone')], RED)
    yy = bullet(d, 70, yy, W - 140, 'Non-crop green per resident', '19', ' m²', 55, [(9, 'minimum 9'), (50, 'ideal 50')], GOLD)
    card(d, (70, yy + 10, W - 70, H - 140))
    d.text((104, yy + 40), '0 of 137', SERIF_B(84), RED)
    d.text((104, yy + 150), 'neighbourhoods reach 30% tree canopy', SANS_SB(32), INK)
    rows = [('Leafiest', 'Zaman Park 25% · Mayo Gardens 24% · GOR 24%'),
            ('Least', 'Bagrian 1% · DHA Phase 9 Prism 1.5% · Chah Miran 1.5%')]
    ry = yy + 222
    for k, v in rows:
        d.text((104, ry), k, SANS_B(26), INK)
        text_block(d, (230, ry), v, SANS(26), INK2, W - 340)
        ry += 56
    return im


def slide7(maps):
    im, d, y = base(7, 'How we know', 'Checked against data the model never saw')
    checks = [(True, 'NASA GEDI space laser agrees with the tree change'),
              (True, 'Green fell on 74% of land newly built 2019–2023 (Google Open Buildings)'),
              (True, 'About 1% false change on land that cannot change'),
              (True, 'Same direction under every model setting'),
              (True, 'Farmland loss confirmed by two separate methods'),
              (False, 'Trees under-counted by about 9%, mostly very small trees'),
              (False, 'The rise is only just significant: 7 years is a short record')]
    yy = y + 44
    for ok, t in checks:
        tick(d, 93, yy + 22, ok)
        yy = text_block(d, (140, yy + 2), t, SANS(29), INK2, W - 210) + 20
    by = max(yy + 24, H - 400)
    d.rounded_rectangle([70, by, W - 70, by + 230], radius=28, fill=BRAND)
    d.text((110, by + 42), 'Find your own neighbourhood', SERIF_B(48), '#ffffff')
    text_block(d, (110, by + 118), 'Live map, visual story, code and data: links in the first comment.',
               SANS(30), '#d9ead3', W - 220)
    return im


def main(maps, out):
    os.makedirs(out, exist_ok=True)
    slides = [f(maps) for f in (slide1, slide2, slide3, slide4, slide5, slide6, slide7)]
    for i, s in enumerate(slides, 1):
        s.save(os.path.join(out, 'slide_%d.png' % i), optimize=True)
    pdf = os.path.join(out, 'lahore_city_of_gardens_carousel.pdf')
    slides[0].save(pdf, save_all=True, append_images=slides[1:], resolution=144, quality=95)
    print(pdf, os.path.getsize(pdf) // 1024, 'KB', slides[0].size)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
