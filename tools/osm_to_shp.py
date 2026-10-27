"""Convert Overpass JSON (out geom) of green spaces into a zipped shapefile for Earth Engine.
Usage: python -I osm_to_shp.py <input.json> <output_dir>
"""
import collections
import json
import math
import os
import struct
import sys
import zipfile

src, out_dir = sys.argv[1], sys.argv[2]
data = json.load(open(src, encoding='utf-8'))


def category(t):
    lei, lu, nat = t.get('leisure', ''), t.get('landuse', ''), t.get('natural', '')
    if lu in ('forest', 'orchard') or nat == 'wood':
        return 'tree'
    if nat == 'scrub':
        return 'shrub'
    if lei == 'golf_course':
        return 'golf'
    if lei in ('park', 'garden', 'recreation_ground') or lu in ('recreation_ground', 'village_green'):
        return 'park'
    if lu in ('grass', 'meadow') or (lei == 'pitch' and t.get('surface') == 'grass'):
        return 'grass'
    return None


def key_tag(t):
    for k in ('leisure', 'landuse', 'natural'):
        if k in t:
            return k + '=' + t[k]
    return ''


def ring_area_m2(r):
    """Signed area in m2: positive = counter-clockwise."""
    lat0 = sum(p[1] for p in r) / len(r)
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110574
    s = 0.0
    for (x1, y1), (x2, y2) in zip(r, r[1:]):
        s += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return s / 2.0


def close(r):
    return r if r[0] == r[-1] else r + [r[0]]


def join_ways(ways):
    """Join open way segments into closed rings by matching end points."""
    ways = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while ways:
        cur = ways.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, w in enumerate(ways):
                if w[0] == cur[-1]:
                    cur += w[1:]
                elif w[-1] == cur[-1]:
                    cur += list(reversed(w))[1:]
                elif w[-1] == cur[0]:
                    cur = w[:-1] + cur
                elif w[0] == cur[0]:
                    cur = list(reversed(w))[:-1] + cur
                else:
                    continue
                ways.pop(i)
                changed = True
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


features, skipped = [], collections.Counter()
for el in data.get('elements', []):
    t = el.get('tags', {})
    cat = category(t)
    if not cat:
        skipped['no category'] += 1
        continue
    rings = []
    if el['type'] == 'way':
        g = [(p['lon'], p['lat']) for p in el.get('geometry', [])]
        if len(g) >= 4 and g[0] == g[-1]:
            rings = [g]
        else:
            skipped['open way'] += 1
            continue
    elif el['type'] == 'relation':
        outers = [[(p['lon'], p['lat']) for p in m.get('geometry', [])]
                  for m in el.get('members', []) if m.get('role') == 'outer' and m.get('geometry')]
        rings = join_ways(outers)
        if not rings:
            skipped['relation without closed outer ring'] += 1
            continue
    area = sum(abs(ring_area_m2(r)) for r in rings)
    if area < 400:
        skipped['smaller than 400 m2'] += 1
        continue
    # Shapefile outer rings must be clockwise (negative signed area).
    rings = [r if ring_area_m2(r) < 0 else list(reversed(r)) for r in (close(r) for r in rings)]
    features.append({'id': el['type'][0] + str(el['id']), 'cat': cat, 'tag': key_tag(t),
                     'name': t.get('name:en') or t.get('name') or '', 'area': area, 'rings': rings})

os.makedirs(out_dir, exist_ok=True)
base = os.path.join(out_dir, 'lahore_osm_green')

# --- .shp and .shx (polygon, shape type 5)
recs = []
for i, f in enumerate(features, 1):
    pts = [p for r in f['rings'] for p in r]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    parts, idx = [], 0
    for r in f['rings']:
        parts.append(idx)
        idx += len(r)
    content = struct.pack('<i4d2i', 5, min(xs), min(ys), max(xs), max(ys), len(parts), len(pts))
    content += struct.pack('<%di' % len(parts), *parts)
    content += b''.join(struct.pack('<2d', x, y) for x, y in pts)
    recs.append((i, content, (min(xs), min(ys), max(xs), max(ys))))
bbox = (min(r[2][0] for r in recs), min(r[2][1] for r in recs),
        max(r[2][2] for r in recs), max(r[2][3] for r in recs))


def header(length_words):
    return (struct.pack('>7i', 9994, 0, 0, 0, 0, 0, length_words) +
            struct.pack('<2i', 1000, 5) + struct.pack('<4d', *bbox) + struct.pack('<4d', 0, 0, 0, 0))


shp_body, shx_body, offset = b'', b'', 50
for i, content, _ in recs:
    shp_body += struct.pack('>2i', i, len(content) // 2) + content
    shx_body += struct.pack('>2i', offset, len(content) // 2)
    offset += 4 + len(content) // 2
open(base + '.shp', 'wb').write(header(50 + len(shp_body) // 2) + shp_body)
open(base + '.shx', 'wb').write(header(50 + len(shx_body) // 2) + shx_body)

# --- .dbf
fields = [('osm_id', 'C', 20, 0), ('category', 'C', 10, 0), ('tag', 'C', 30, 0),
          ('name', 'C', 80, 0), ('area_m2', 'N', 15, 0)]


def enc(s, n):
    b = s.encode('utf-8')[:n]
    while True:
        try:
            b.decode('utf-8')
            break
        except UnicodeDecodeError:
            b = b[:-1]
    return b.ljust(n, b' ')


rec_len = 1 + sum(f[2] for f in fields)
hdr_len = 32 + 32 * len(fields) + 1
dbf = struct.pack('<4BIHH20x', 3, 126, 10, 26, len(features), hdr_len, rec_len)
for name, typ, ln, dec in fields:
    dbf += name.encode('ascii').ljust(11, b'\0') + typ.encode('ascii') + b'\0' * 4 + bytes([ln, dec]) + b'\0' * 14
dbf += b'\r'
for f in features:
    dbf += (b' ' + enc(f['id'], 20) + enc(f['cat'], 10) + enc(f['tag'], 30) + enc(f['name'], 80) +
            str(int(round(f['area']))).rjust(15).encode('ascii'))
dbf += b'\x1a'
open(base + '.dbf', 'wb').write(dbf)
open(base + '.cpg', 'w').write('UTF-8')
open(base + '.prj', 'w').write('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
                               'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]')
with zipfile.ZipFile(base + '.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for ext in ('shp', 'shx', 'dbf', 'prj', 'cpg'):
        z.write(base + '.' + ext, 'lahore_osm_green.' + ext)

# --- report
by = collections.defaultdict(lambda: [0, 0.0])
for f in features:
    by[f['cat']][0] += 1
    by[f['cat']][1] += f['area']
print('elements in file:', len(data.get('elements', [])), '| polygons kept:', len(features))
for c, (n, a) in sorted(by.items()):
    print('  %-6s %5d polygons  %8.2f km2' % (c, n, a / 1e6))
print('skipped:', dict(skipped))
print('largest:')
for f in sorted(features, key=lambda f: -f['area'])[:12]:
    print('  %-6s %7.3f km2  %-28s %s' % (f['cat'], f['area'] / 1e6, f['tag'], f['name'][:40]))
print('bbox:', [round(b, 3) for b in bbox])
