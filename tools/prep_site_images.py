"""Prepare map images for the story site (docs/img) from Earth Engine frames downloaded by build_visuals.py.

Usage:
  python -I prep_site_images.py <timelapse_work_dir> <graphics_work_dir> <docs_img_dir>

The outside of the district becomes transparent and every image is cropped to the district, so the maps
sit directly on the page. The 2019 and 2025 maps share one crop box so the before/after slider lines up.
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw

WIDTH = 900
KEY = (255, 0, 255)


def transparent_outside(im, bg, box=None):
    im = im.convert('RGB')
    if box is None:
        diff = ImageChops.difference(im, Image.new('RGB', im.size, bg)).convert('L').point(lambda v: 255 if v > 8 else 0)
        b = diff.getbbox()
        box = (max(0, b[0] - 4), max(0, b[1] - 4), min(im.width, b[2] + 4), min(im.height, b[3] + 4))
    im = im.crop(box)
    for corner in ((0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)):
        if im.getpixel(corner) == bg:
            ImageDraw.floodfill(im, corner, KEY, thresh=6)
    rgba = im.convert('RGBA')
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _ = px[x, y]
            if (r, g, b) == KEY:
                px[x, y] = (0, 0, 0, 0)
    return rgba, box


def recolour(im, src, dst):
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][:3] == src and px[x, y][3]:
                px[x, y] = dst + (255,)
    return im


def save(im, path):
    im = im.copy()
    im.thumbnail((WIDTH, WIDTH))
    im.save(path, optimize=True)
    print(path, im.size, os.path.getsize(path) // 1024, 'KB')


def main(tdir, gdir, out):
    os.makedirs(out, exist_ok=True)
    m19, box = transparent_outside(Image.open(os.path.join(tdir, '2019.png')), (255, 255, 255))
    m25, _ = transparent_outside(Image.open(os.path.join(tdir, '2025.png')), (255, 255, 255), box)
    save(m19, os.path.join(out, 'map_2019.png'))
    save(m25, os.path.join(out, 'map_2025.png'))
    hot, _ = transparent_outside(Image.open(os.path.join(tdir, 'hotspot.png')), (255, 255, 255))
    save(hot, os.path.join(out, 'map_change.png'))
    bench, _ = transparent_outside(Image.open(os.path.join(gdir, 'bench.png')), (244, 244, 244))
    save(recolour(bench, (244, 244, 244), (228, 226, 218)), os.path.join(out, 'map_canopy.png'))


if __name__ == '__main__':
    main(*sys.argv[1:4])
