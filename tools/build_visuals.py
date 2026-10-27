"""Build polished LinkedIn graphics from the app's TIMELAPSE_DATA block.

Usage:
  python -I -X utf8 build_visuals.py <timelapse_data.txt> <work_dir> <out_dir> [--demo]

Outputs (1080 x 1350, LinkedIn 4:5):
  lahore_green_timelapse.gif   yearly maps with year badge, legend, progress bar, chart
  lahore_green_hotspots.png    where green was gained / lost, with top areas
  lahore_green_cover.png       latest-year map with key-number cards
"""
import io
import json
import os
import re
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFont

FONT_DIR = r'C:\Windows\Fonts'


def font(name, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)


W, H = 1080, 1350
INK, MUTED, BG, LINE = (33, 37, 41), (110, 117, 125), (250, 250, 247), (225, 225, 220)
GREEN, RED = (27, 120, 55), (178, 24, 43)
F_TITLE, F_SUB = font('segoeuib.ttf', 46), font('segoeui.ttf', 26)
F_YEAR, F_LEG = font('segoeuib.ttf', 92), font('segoeui.ttf', 24)
F_SMALL, F_NUM = font('segoeui.ttf', 20), font('seguisb.ttf', 30)
F_CARD_N, F_CARD_L = font('segoeuib.ttf', 48), font('segoeui.ttf', 22)
F_H2 = font('seguisb.ttf', 26)
SOURCES = 'Data: ESA Sentinel-2 (10 m), Meta/WRI 1 m canopy height, OpenStreetMap, NASA GEDI, Google Open Buildings'


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def load_payload(path):
    """Reads a TIMELAPSE_DATA or GRAPHICS_DATA block pasted from the app's Console."""
    txt = open(path, encoding='utf-8').read()
    key = 'GRAPHICS_DATA' if 'GRAPHICS_DATA' in txt else 'TIMELAPSE_DATA'
    body = txt[txt.index(key) + len(key):].strip()
    payload = json.JSONDecoder().raw_decode(body)[0]
    payload['kind'] = key
    return payload


def fetch(url, path):
    if os.path.exists(path):
        return path
    req = urllib.request.Request(url, headers={'User-Agent': 'lahore-green-graphics/1.0'})
    data = urllib.request.urlopen(req, timeout=180).read()
    Image.open(io.BytesIO(data)).verify()          # make sure it is a real image
    open(path, 'wb').write(data)
    return path


def fetch_all(payload, work_dir):
    os.makedirs(work_dir, exist_ok=True)
    out = {}
    for key, url in payload['frames'].items():
        if not url or url.startswith('ERROR'):
            print('skip', key, (url or '')[:120])
            continue
        out[key] = fetch(url, os.path.join(work_dir, '%s.png' % key))
    return out


# ---------------------------------------------------------------- helpers
def header(d, title, sub):
    d.text((60, 52), title, fill=INK, font=F_TITLE)
    d.text((60, 112), sub, fill=MUTED, font=F_SUB)


def footer(d, extra=None):
    if extra:
        d.text((W / 2, H - 62), extra, fill=MUTED, font=F_SMALL, anchor='mm')
    d.text((W / 2, H - 32), SOURCES, fill=MUTED, font=F_SMALL, anchor='mm')


MAP_BG, FARMLAND = (244, 244, 244), (228, 228, 224)


def clean_map(m):
    """Earth Engine maps drawn on a flat #f4f4f4 background: crop to the district, blend the
    outside into the page and shade the background left inside the district (farmland)."""
    from PIL import ImageChops
    diff = ImageChops.difference(m, Image.new('RGB', m.size, MAP_BG)).convert('L').point(lambda v: 255 if v > 8 else 0)
    box = diff.getbbox()
    if box:
        m = m.crop((max(0, box[0] - 6), max(0, box[1] - 6), min(m.width, box[2] + 6), min(m.height, box[3] + 6)))
    for corner in ((0, 0), (m.width - 1, 0), (0, m.height - 1), (m.width - 1, m.height - 1)):
        if m.getpixel(corner) == MAP_BG:
            ImageDraw.floodfill(m, corner, BG, thresh=4)
    px = m.load()
    for y in range(m.height):
        for x in range(m.width):
            if px[x, y] == MAP_BG:
                px[x, y] = FARMLAND
    return m


def paste_map(canvas, path, top=170, max_h=760, clean=False):
    m = Image.open(path).convert('RGB')
    if clean:
        m = clean_map(m)
    m.thumbnail((W - 80, max_h))
    mx = (W - m.width) // 2
    canvas.paste(m, (mx, top))
    return mx, top, m.width, m.height


def legend_row(d, x, y, items, font_=F_LEG, wrap_at=None):
    x0 = x
    for i, (c, t) in enumerate(items):
        if wrap_at and i == wrap_at:
            x, y = x0, y + 40
        d.rounded_rectangle([x, y, x + 28, y + 28], radius=6, fill=hex2rgb(c), outline=(150, 150, 150))
        d.text((x + 38, y + 14), t, fill=INK, font=font_, anchor='lm')
        x += 60 + d.textlength(t, font=font_)
    return y


def map_legend(col):
    # dense-tree swatch uses the mid-dark green that actually appears on the map
    return [('#1b7837', 'Dense trees'), (col['treesLight'], 'Sparse trees'),
            (col['grass'], 'Grass, lawns, parks'), (col['crops'], 'Crops (not counted)'),
            (col['built'], 'Built-up'), (col['water'], 'Water')]


def corrected_areas(payload):
    areas = payload.get('areas')
    if areas and payload.get('treeBiasFactor'):
        k = payload['treeBiasFactor']
        areas = [dict(a, total=a['trees'] * k + a['grass']) for a in areas]
    return areas


def draw_chart(d, box, areas, current, provisional):
    x0, y0, x1, y1 = box
    years = [a['year'] for a in areas]
    vals = [a['total'] for a in areas]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.25 or 1
    lo, hi = lo - pad, hi + pad

    def pt(i):
        return (x0 + (x1 - x0) * i / max(1, len(years) - 1), y1 - (y1 - y0) * (vals[i] - lo) / (hi - lo))
    d.line([(x0, y1), (x1, y1)], fill=(210, 210, 205), width=2)
    upto = [i for i, y in enumerate(years) if y <= current]
    if len(upto) > 1:
        d.line([pt(i) for i in upto], fill=GREEN, width=5, joint='curve')
    for i in range(len(years)):
        cx, cy = pt(i)
        done = years[i] <= current
        r = 9 if years[i] == current else 6
        c = GREEN if done else (200, 200, 195)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255) if years[i] in provisional else c,
                  outline=c, width=3)
        d.text((cx, y1 + 12), str(years[i])[2:], fill=MUTED, font=F_SMALL, anchor='ma')
    if current in years:
        cx, cy = pt(years.index(current))
        d.text((cx, cy - 18), '%.0f km\u00b2' % vals[years.index(current)], fill=INK, font=F_NUM, anchor='md')


# ---------------------------------------------------------------- 1. timelapse
def build_gif(payload, frames, out_path, seconds_per_year=1.6, hold_last=3.0):
    years = [y for y in payload['years'] if str(y) in frames]
    prov = set(payload.get('provisional') or [])
    areas = corrected_areas(payload)
    pages = []
    for idx, y in enumerate(years):
        canvas = Image.new('RGB', (W, H), BG)
        d = ImageDraw.Draw(canvas)
        header(d, 'Lahore\u2019s Green Cover','Trees, parks and lawns (crops excluded) \u00b7 Sentinel-2, 10 m')
        mx, my, mw, mh = paste_map(canvas, frames[str(y)])
        label = str(y) + ('*' if y in prov else '')
        bw = d.textlength(label, font=F_YEAR) + 48
        d.rounded_rectangle([mx + 18, my + 18, mx + 18 + bw, my + 136], radius=18, fill=(255, 255, 255), outline=LINE)
        d.text((mx + 18 + bw / 2, my + 77), label, fill=INK, font=F_YEAR, anchor='mm')
        py = my + mh + 20
        d.rounded_rectangle([60, py, W - 60, py + 10], radius=5, fill=LINE)
        d.rounded_rectangle([60, py, 60 + (W - 120) * (idx + 1) / len(years), py + 10], radius=5, fill=GREEN)
        ly = legend_row(d, 60, py + 34, map_legend(payload['colours']), wrap_at=3)
        if areas:
            cy0 = ly + 70
            k = payload.get('treeBiasFactor')
            d.text((60, cy0), 'Non-crop green area (km\u00b2)' + (
                ' \u00b7 tree cover corrected \u00d7%.2f for the under-count found against 1 m canopy data' % k
                if k else ''), fill=MUTED, font=F_SMALL)
            draw_chart(d, (90, cy0 + 70, W - 90, H - 120), areas, y, prov)
        footer(d, '* provisional: year not yet complete' if prov else None)
        pages.append(canvas)
    durations = [int(seconds_per_year * 1000)] * len(pages)
    durations[-1] = int(hold_last * 1000)
    pal = [p.convert('P', palette=Image.ADAPTIVE, colors=255) for p in pages]
    pal[0].save(out_path, save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True)
    return out_path


# ---------------------------------------------------------------- 2. hotspot map
def build_hotspots(payload, frames, out_path):
    if 'hotspot' not in frames:
        return None
    y0, y1 = payload['hotspotYears']
    story = payload.get('story') or payload   # GRAPHICS_DATA keeps gains / losses at the top level
    scale = payload.get('hotspotScale', 0.12)
    canvas = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(canvas)
    header(d, 'Where Lahore Gained and Lost Green', 'Change in green share of the land, %d \u2192 %d \u00b7 trees, parks and lawns' % (y0, y1))
    mx, my, mw, mh = paste_map(canvas, frames['hotspot'], max_h=720, clean=payload.get('kind') == 'GRAPHICS_DATA')
    # colour bar
    cols = [hex2rgb(c) for c in payload['hotColours']]
    bx0, bx1, by = 160, W - 160, my + mh + 36
    n = len(cols) - 1
    for x in range(bx0, bx1):
        t = (x - bx0) / (bx1 - bx0) * n
        i = min(int(t), n - 1)
        f = t - i
        c = tuple(int(cols[i][k] + (cols[i + 1][k] - cols[i][k]) * f) for k in range(3))
        d.line([(x, by), (x, by + 22)], fill=c)
    d.rectangle([bx0, by, bx1, by + 22], outline=(170, 170, 170))
    d.text((bx0, by + 32), 'Green lost (\u2212%d pts)' % round(100 * scale), fill=RED, font=F_LEG, anchor='la')
    d.text(((bx0 + bx1) / 2, by + 32), 'No change', fill=MUTED, font=F_LEG, anchor='ma')
    d.text((bx1, by + 32), 'Green gained (+%d pts)' % round(100 * scale), fill=GREEN, font=F_LEG, anchor='ra')
    # top areas
    ty = by + 90
    if story.get('gains') or story.get('losses'):
        for col_x, title, items, colr in ((60, 'Gained Most', story.get('gains', []), GREEN),
                                          (W / 2 + 20, 'Lost Most', story.get('losses', []), RED)):
            d.text((col_x, ty), title, fill=colr, font=F_H2)
            for k, it in enumerate(items[:4]):
                d.text((col_x, ty + 42 + k * 34), 'near %s' % it['name'], fill=INK, font=F_LEG)
                d.text((col_x + 400, ty + 42 + k * 34), '%+.0f pts' % (100 * it['km2']), fill=colr, font=F_LEG, anchor='ra')
    footer(d, 'pts = percentage points of each 1 km\u00b2 area \u00b7 area names are approximate (nearest reference place)')
    canvas.save(out_path)
    return out_path


# ---------------------------------------------------------------- 3. Lahore vs benchmarks
BENCH_LABELS = ['Under 5%', '5–10%', '10–20%', '20–30%', '30%+ (target)']


def build_bench(payload, frames, out_path):
    b = payload.get('bench')
    if not b or 'bench' not in frames:
        return None
    canvas = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(canvas)
    header(d, 'Lahore vs Green-Space Benchmarks',
           'Tree canopy by neighbourhood, %d · against the 3-30-300 rule and WHO/Europe' % b['year'])
    mx, my, mw, mh = paste_map(canvas, frames['bench'], max_h=640, clean=True)
    items = [(c, '%s (%d)' % (t, n)) for c, t, n in zip(b['palette'], BENCH_LABELS, b['classes'])]
    ly = legend_row(d, 60, my + mh + 18, items[:3], font_=F_SMALL)
    ly = legend_row(d, 60, ly + 40, items[3:] + [('#e4e4e0', 'Farmland or open land')], font_=F_SMALL)
    d.text((60, ly + 44), 'Bracketed numbers: neighbourhoods in each band', fill=MUTED, font=F_SMALL)
    cy, cw, ch, gap = ly + 86, (W - 120 - 20) // 2, 132, 20
    card(d, 60, cy, cw, ch, '%.1f%%' % b['canopy'], 'Tree canopy of the district (target 30%)', RED)
    card(d, 60 + cw + gap, cy, cw, ch, '%.0f m²' % b['perRes'], 'Green per resident (minimum 9 m²)',
         GREEN if b['perRes'] >= 9 else RED)
    card(d, 60, cy + ch + gap, cw, ch, '%.0f%%' % b['parkAccess'], 'Within 300 m of a park (target 100%)', RED)
    card(d, 60 + cw + gap, cy + ch + gap, cw, ch, '%d of %d' % (b['meet'], b['hoods']),
         'Neighbourhoods at 30% canopy', GREEN if b['meet'] else RED)
    footer(d, 'Zones: built-up land around OpenStreetMap places (approximate) · canopy is the model’s estimate')
    canvas.save(out_path)
    return out_path


# ---------------------------------------------------------------- 4. cover image
def card(d, x, y, w, h, number, label, colr=INK):
    d.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
    d.text((x + 24, y + 22), number, fill=colr, font=F_CARD_N)
    d.text((x + 24, y + 86), label, fill=MUTED, font=F_CARD_L)


def build_cover(payload, frames, out_path):
    years = [y for y in payload['years'] if str(y) in frames and y not in (payload.get('provisional') or [])]
    if not years:
        return None
    y1 = years[-1]
    s = payload.get('story') or {}
    canvas = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(canvas)
    header(d, 'Is Lahore Getting Greener?', 'Non-crop green cover mapped from space, %s' % (
        '%d \u2192 %d' % (s['y0'], s['y1']) if s else str(y1)))
    mx, my, mw, mh = paste_map(canvas, frames[str(y1)], max_h=640)
    d.rounded_rectangle([mx + 18, my + 18, mx + 200, my + 100], radius=16, fill=(255, 255, 255), outline=LINE)
    d.text((mx + 109, my + 59), str(y1), fill=INK, font=font('segoeuib.ttf', 58), anchor='mm')
    ly = legend_row(d, 60, my + mh + 22, map_legend(payload['colours']), font_=F_SMALL, wrap_at=3)
    cy, cw, ch, gap = ly + 64, (W - 120 - 20) // 2, 132, 20
    lost = None
    if payload.get('lostToBuildings'):
        m = re.search(r'\(([\d.]+) km', payload['lostToBuildings'])
        lost = m.group(1) if m else None
    if s:
        pct = 100 * (s['total1'] - s['total0']) / s['total0'] if s['total0'] else 0
        card(d, 60, cy, cw, ch, '%.0f km\u00b2' % s['total1'],
             'Total non-crop green (%+.0f%% since %d)' % (pct, s['y0']), GREEN)
        card(d, 60 + cw + gap, cy, cw, ch, '%.0f km\u00b2' % s['trees1'], 'Tree cover in %d' % s['y1'], GREEN)
        card(d, 60, cy + ch + gap, cw, ch, '%.0f m\u00b2' % s['perPerson1'],
             'Green space per resident (%.1f M people)' % (s['population'] / 1e6))
        card(d, 60 + cw + gap, cy + ch + gap, cw, ch, ('%s km\u00b2' % lost) if lost else 'n/a',
             'Green lost under new buildings (2019\u20132023)', RED)
    tr = payload.get('trend')
    k = payload.get('treeBiasFactor')
    if s and s.get('treesBiasCorrected') and k:
        d.text((W / 2, H - 92), 'Tree cover corrected \u00d7%.2f for the under-count found against 1 m canopy data' % k,
               fill=MUTED, font=F_SMALL, anchor='mm')
    note = 'Model estimate. ' + ('Trend %+.1f km\u00b2/yr (95%% CI %+.1f to %+.1f): not yet statistically significant.' %
                                 (tr['total'], tr['totalLo'], tr['totalHi']) if tr else '')
    footer(d, note)
    canvas.save(out_path)
    return out_path


# ---------------------------------------------------------------- demo data
def demo(work_dir):
    import random
    os.makedirs(work_dir, exist_ok=True)
    years = list(range(2019, 2027))
    frames = {}
    for k, y in enumerate(years + ['hotspot']):
        im = Image.new('RGB', (1080, 820), 'white')
        dd = ImageDraw.Draw(im)
        poly = [(150, 80), (900, 40), (1000, 600), (520, 790), (90, 560)]
        dd.polygon(poly, fill=(239, 230, 207) if y != 'hotspot' else (247, 247, 247), outline='black')
        rnd = random.Random(str(y))
        for _ in range(300 + 30 * (k % 8)):
            x, yy = rnd.randint(200, 900), rnd.randint(120, 700)
            if y == 'hotspot':
                c = (27, 120, 55) if rnd.random() > 0.3 else (214, 96, 77)
            else:
                c = (27, 120, 55) if rnd.random() > 0.5 else (181, 217, 80)
            dd.ellipse([x, yy, x + 10, yy + 10], fill=c)
        path = os.path.join(work_dir, '%s.png' % y)
        im.save(path)
        frames[str(y)] = path
    payload = {
        'years': years, 'provisional': [2026], 'hotspotYears': [2019, 2025], 'hotspotScale': 0.12,
        'areas': [{'year': y, 'trees': 70 + 1.0 * i, 'grass': 300 + (i % 3) * 6, 'total': 0} for i, y in enumerate(years)],
        'treeBiasFactor': 1.1,
        'story': {'y0': 2019, 'y1': 2025, 'trees0': 77.0, 'trees1': 84.0, 'grass0': 300.0, 'grass1': 328.0,
                  'total0': 377.0, 'total1': 412.0, 'perPerson0': 29.0, 'perPerson1': 30.5, 'population': 13500000,
                  'gains': [{'name': 'Bahria Town', 'km2': 0.11}, {'name': 'DHA', 'km2': 0.09},
                            {'name': 'Kahna', 'km2': 0.08}, {'name': 'Raiwind', 'km2': 0.07}],
                  'losses': [{'name': 'Johar Town', 'km2': -0.06}, {'name': 'Wapda Town', 'km2': -0.05},
                             {'name': 'Shahdara', 'km2': -0.04}, {'name': 'Harbanspura', 'km2': -0.03}]},
        'lostToBuildings': '21.4 km\u00b2 newly built 2019\u21922023; model shows green falling on 77% of it (1.7 km\u00b2 of green lost)',
        'trend': {'total': 5.0, 'totalLo': -1.7, 'totalHi': 11.0},
        'colours': {'treesLight': '#5bb36a', 'treesDark': '#00441b', 'grass': '#b5d950', 'crops': '#efe6cf',
                    'built': '#bdbdbd', 'water': '#2b8cbe', 'bare': '#e3cfae'},
        'hotColours': ['#b2182b', '#d6604d', '#f4a582', '#f7f7f7', '#a6dba0', '#5aae61', '#1b7837']}
    return payload, frames


if __name__ == '__main__':
    data_path, work_dir, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    if '--demo' in sys.argv:
        payload, frames = demo(work_dir)
    else:
        payload = load_payload(data_path)
        frames = fetch_all(payload, work_dir)
    os.makedirs(out_dir, exist_ok=True)
    if payload.get('kind') == 'GRAPHICS_DATA':
        print('Hotspots:', build_hotspots(payload, frames, os.path.join(out_dir, 'lahore_green_hotspots.png')))
        print('Bench   :', build_bench(payload, frames, os.path.join(out_dir, 'lahore_vs_benchmarks.png')))
        sys.exit(0)
    print('GIF     :', build_gif(payload, frames, os.path.join(out_dir, 'lahore_green_timelapse.gif')))
    print('Hotspots:', build_hotspots(payload, frames, os.path.join(out_dir, 'lahore_green_hotspots.png')))
    print('Cover   :', build_cover(payload, frames, os.path.join(out_dir, 'lahore_green_cover.png')))
