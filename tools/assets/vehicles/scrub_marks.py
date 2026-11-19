"""Paints real insignia and maker's plates out of a downloaded model's texture (the games wear invented
markings only).

    python -I scrub_marks.py in.png out.png --circle 1824,1359,78 --rect 950,1572,1042,1618 ...

(needs numpy and Pillow). Each region, in the texture's pixels, is filled from the paint around it: the
paint's slow variation is the region's surroundings blurred with the region left out (a normalised
convolution), its grain the high frequencies of the same-sized patch just beside it (`--grain-from`
dx,dy; default the patch to its left), so the patch keeps the weathering's texture instead of a smooth
spot. Only the marking's own texels are replaced when --bright is given: those brighter than the paint
around them by that much (stencils on a painted panel); otherwise the whole region.
"""
import argparse

import numpy as np
from PIL import Image, ImageFilter


def box1(a, r, axis):
    """Box mean of half-width r along one axis, the edges clamped (a cumulative sum)."""
    n = a.shape[axis]
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis, dtype=np.float64)
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a, sigma):
    """A Gaussian of about `sigma` texels: three box passes each way (Pillow blurs no float images)."""
    r = max(1, int(round(sigma * 0.87)))
    for _ in range(3):
        a = box1(box1(a, r, 0), r, 1)
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--circle', action='append', default=[], help='x,y,r')
    ap.add_argument('--rect', action='append', default=[], help='x0,y0,x1,y1')
    ap.add_argument('--bright', type=float, default=None, help='replace only texels this much brighter (0-1)')
    ap.add_argument('--grain-from', default=None, help='dx,dy of the patch lending its grain')
    ap.add_argument('--grain-patch', default=None, help='x0,y0,x1,y1 of a clean patch of paint, tiled for the grain')
    ap.add_argument('--interp', choices=['x', 'y'], default=None, help='fill each rectangle row by row (x) or column '
                    'by column (y), straight between the texels just outside it: keeps a curved surface\'s gradient '
                    'in a normal map, which a blur flattens into a visible patch')
    ap.add_argument('--no-grain', action='store_true', help='the smooth fill alone (normal maps: a stamped mark '
                    'out of a flat panel leaves it flat, and borrowed grain brings the borrowed relief)')
    a = ap.parse_args()
    im = Image.open(a.src)
    mode = im.mode
    px = np.asarray(im.convert('RGBA')).astype(np.float32) / 255
    h, w = px.shape[:2]
    shapes = [('circle', tuple(float(v) for v in c.split(','))) for c in a.circle]
    shapes += [('rect', tuple(float(v) for v in c.split(','))) for c in a.rect]
    lw = np.array([0.2126, 0.7152, 0.0722], np.float32)

    def bounds(kind, v):
        if kind == 'circle':
            x, y, r = v
            return x - r, y - r, x + r, y + r
        return v

    def inside(kind, v, ys, xs):
        if kind == 'circle':
            x, y, r = v
            return (xs - x) ** 2 + (ys - y) ** 2 <= r * r
        x0, y0, x1, y1 = v
        return (xs >= x0) & (xs <= x1) & (ys >= y0) & (ys <= y1)

    def window(x0, y0, x1, y1, m):
        return (slice(max(0, int(y0 - m)), min(h, int(y1 + m) + 1)), slice(max(0, int(x0 - m)), min(w, int(x1 + m) + 1)))

    def fine_of(sl):
        """High frequencies (the paint's grain) of a window, blurred with a margin round it."""
        big = window(sl[1].start, sl[0].start, sl[1].stop - 1, sl[0].stop - 1, 16)
        c = px[big][..., :3]
        f = c - blur(c, 4)
        return f[sl[0].start - big[0].start:sl[0].stop - big[0].start, sl[1].start - big[1].start:sl[1].stop - big[1].start]

    if a.interp:
        # Rectangles only: each line across the mark runs straight from one side's texel to the other's.
        for kind, (x0, y0, x1, y1) in shapes:
            x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
            if a.interp == 'x':
                left, right = px[y0:y1 + 1, max(0, x0 - 1)], px[y0:y1 + 1, min(w - 1, x1 + 1)]
                t = np.linspace(0, 1, x1 - x0 + 1, dtype=np.float32)[None, :, None]
                px[y0:y1 + 1, x0:x1 + 1] = left[:, None, :] * (1 - t) + right[:, None, :] * t
            else:
                top, bottom = px[max(0, y0 - 1), x0:x1 + 1], px[min(h - 1, y1 + 1), x0:x1 + 1]
                t = np.linspace(0, 1, y1 - y0 + 1, dtype=np.float32)[:, None, None]
                px[y0:y1 + 1, x0:x1 + 1] = top[None, :, :] * (1 - t) + bottom[None, :, :] * t
        Image.fromarray((px * 255 + 0.5).astype(np.uint8), 'RGBA').convert(mode).save(a.dst)
        print(f'{a.dst}: {len(shapes)} rectangles interpolated')
        return
    boxes = [bounds(k, v) for k, v in shapes]
    radius = max(max(b[2] - b[0], b[3] - b[1]) for b in boxes) * 0.35
    total = 0
    # Each marking in a window round it (a 4096 texture blurred whole takes gigabytes).
    for (kind, v), (x0, y0, x1, y1) in zip(shapes, boxes):
        win = window(x0, y0, x1, y1, 3 * radius + 8)
        rgb = px[win][..., :3]
        ys, xs = np.mgrid[win[0], win[1]]
        # Every marking's own texels are left out of every window's paint.
        region = np.zeros(ys.shape, bool)
        for k2, v2 in shapes:
            region |= inside(k2, v2, ys, xs)
        own = inside(kind, v, ys, xs)
        luma = rgb @ lw
        # Seams, rust streaks and window texels around a marking are not its paint: the slow variation is
        # taken from the texels within a quarter of the surroundings' median luminance only.
        g = max(x1 - x0, y1 - y0) * 0.4
        # Nor is the atlas's black gutter beside a panel's edge (it pulled a marking's fill toward black).
        paint = luma > 0.02
        ring = (xs >= x0 - g) & (xs <= x1 + g) & (ys >= y0 - g) & (ys <= y1 + g) & ~region & paint
        med = float(np.median(luma[ring])) if ring.any() else float(np.median(luma[paint] if paint.any() else luma))
        keep = (~region & paint & (np.abs(luma - med) < 0.25 * med)).astype(np.float32)
        low = blur(rgb * keep[..., None], radius) / np.maximum(blur(keep[..., None], radius), 1e-4)
        mask = own
        if a.bright is not None:
            mask = own & (luma > low @ lw + a.bright)
            # Grow by a few texels to take the stencil's soft edge too.
            mask = (np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(7))) > 0) & own
        sl = window(x0, y0, x1, y1, 0)
        oy, ox = sl[0].start - win[0].start, sl[1].start - win[1].start
        ph, pw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if a.no_grain:
            grain = np.zeros((ph, pw, 3), np.float32)
        elif a.grain_patch:
            # A clean patch, mirrored and tiled over the region (no seam where the tiles meet).
            gx0, gy0, gx1, gy1 = (int(t) for t in a.grain_patch.split(','))
            tile = fine_of((slice(gy0, gy1), slice(gx0, gx1)))
            tile = np.concatenate([tile, tile[::-1]], 0)
            tile = np.concatenate([tile, tile[:, ::-1]], 1)
            grain = np.tile(tile, (ph // tile.shape[0] + 1, pw // tile.shape[1] + 1, 1))[:ph, :pw]
        else:
            dx, dy = (int(t) for t in a.grain_from.split(',')) if a.grain_from else (-int((x1 - x0) * 1.1), 0)
            # A region at the texture's edge borrows from the other side instead.
            if not a.grain_from and sl[1].start + dx < 0:
                dx = int((x1 - x0) * 1.1)
            grain = fine_of((slice(sl[0].start + dy, sl[0].stop + dy), slice(sl[1].start + dx, sl[1].stop + dx)))
        m = mask[oy:oy + ph, ox:ox + pw]
        patch = px[sl]
        patch[..., :3][m] = np.clip(low[oy:oy + ph, ox:ox + pw][m] + grain[m], 0, 1)
        total += int(m.sum())
    Image.fromarray((px * 255 + 0.5).astype(np.uint8), 'RGBA').convert(mode).save(a.dst)
    print(f'{a.dst}: {total} texels repainted')


if __name__ == '__main__':
    main()
