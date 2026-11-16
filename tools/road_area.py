"""Estimate road surface area in Lahore district from OpenStreetMap: length x typical width.

Usage:
  python -I road_area.py roads.tsv

roads.tsv comes from this Overpass query (one row per OSM way, length in metres):
  [out:csv(hw,len,lanes,width,oneway;true;"\\t")][timeout:300];
  area(3616117666)->.a;            // Lahore District (OSM relation 16117666)
  way(area.a)[highway];
  convert row hw=t["highway"],len=length(),lanes=t["lanes"],width=t["width"],oneway=t["oneway"];
  out;

Width rules, in order: a numeric 'width' tag; else lanes x 3.5 m; else the typical carriageway width
for the road type below. Divided roads are mapped as two one-way ways, so one-way ways get the width
of one carriageway. Footpaths, cycle paths and roads under construction are left out. The result is
reported with a range: all widths -25 % and +25 %.
"""
import csv
import re
import sys

# typical carriageway width in metres: (two-way, one-way)
WIDTH = {
    'motorway': (28, 14), 'trunk': (15, 11), 'primary': (14, 9), 'secondary': (10, 7.5),
    'tertiary': (7.5, 6), 'unclassified': (6, 5), 'residential': (6, 5), 'living_street': (4, 4),
    'service': (4, 3.5), 'road': (6, 5), 'track': (3, 3), 'busway': (7, 7), 'pedestrian': (5, 5),
    'motorway_link': (7, 7), 'trunk_link': (7, 7), 'primary_link': (7, 7), 'secondary_link': (6, 6),
    'tertiary_link': (6, 6),
}
GROUPS = [('Motorways and trunk roads', ('motorway', 'trunk', 'motorway_link', 'trunk_link')),
          ('Primary and secondary roads', ('primary', 'secondary', 'primary_link', 'secondary_link', 'busway')),
          ('Tertiary and local roads', ('tertiary', 'tertiary_link', 'unclassified', 'road')),
          ('Residential streets', ('residential', 'living_street', 'pedestrian')),
          ('Service roads and tracks', ('service', 'track'))]


def number(x):
    m = re.match(r'\s*([\d.]+)', x or '')
    return float(m.group(1)) if m else None


def main(path):
    km, area, skipped = {}, {}, {}
    with open(path, encoding='utf-8') as f:
        for row in csv.DictReader(f, delimiter='\t'):
            hw, length = row['hw'], float(row['len'] or 0)
            if hw not in WIDTH:
                skipped[hw] = skipped.get(hw, 0) + length
                continue
            one = row.get('oneway') in ('yes', '1', 'true', '-1')
            w = number(row.get('width'))
            if not w or w > 60:
                lanes = number(row.get('lanes'))
                w = lanes * 3.5 if lanes and lanes <= 10 else WIDTH[hw][1 if one else 0]
            km[hw] = km.get(hw, 0) + length / 1000
            area[hw] = area.get(hw, 0) + length * w / 1e6
    total_km, total = sum(km.values()), sum(area.values())
    print('ROAD AREA IN LAHORE DISTRICT (OpenStreetMap, length x width)')
    for name, types in GROUPS:
        k = sum(km.get(t, 0) for t in types)
        a = sum(area.get(t, 0) for t in types)
        print('  %-30s %7.0f km   %6.1f km²' % (name, k, a))
    print('  %-30s %7.0f km   %6.1f km²  (range %.1f to %.1f with widths ±25%%)' %
          ('Total', total_km, total, total * 0.75, total * 1.25))
    top = sorted(skipped.items(), key=lambda x: -x[1])[:6]
    print('Left out (not vehicle roads): ' + ', '.join('%s %.0f km' % (k, v / 1000) for k, v in top))


if __name__ == '__main__':
    main(sys.argv[1])
