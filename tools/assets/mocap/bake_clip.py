"""Bakes a CMU motion-capture clip (cgspeed BVH) into the games' format (render/mocap.ts).

    python -I tools/mocap/bake_clip.py <clip.bvh> <skeleton.json> <out.bin> --mode gait|loop|once
        [--start S] [--end S] [--cycles N]

The target is the skeleton every game shares (assets/mocap/skeleton.json: the T-pose of trial 07_01,
31 bones, metres). Every cgspeed file starts with its subject in that same T-pose (frame 0), so a clip
is moved onto the target by world rotations relative to its own T-pose: each bone's rotation away from
the T-pose at each frame is applied to the target's T-pose, and the hips' travel is scaled by the ratio
of the two subjects' leg lengths.

Modes:
  gait  one cycle of a walk or a run: the pair of frames, a cycle apart, whose poses match best, cut
        where the left foot is furthest forward; the clip turned so the subject walks along +Z (the
        capture's forward); its travel stripped (speed written to the header) and the hips centred, so
        what is left is the body's own sway; the seam cross-faded.
  loop  standing, talking, waiting: [start, end] turned to face +Z on average, the drift of the hips
        removed and centred, the seam cross-faded; written with speed -1 (a stationary loop).
  once  a one-shot (a fall): [start, end] turned to face +Z at its start, hips relative to the start;
        speed 0.

clip.bin: u32 'MOC1', u16 bones, u16 frames, f32 fps, f32 speed, f32 hips[3·frames], i16 quat[4·bones·frames]
(local rotations ×32767, in skeleton.json's bone order). Pure Python, no dependencies.
"""
import argparse
import json
import math
import struct

SCALE = 0.056444  # cgspeed units → metres (the target skeleton's offsets are frame 0 × this)
FPS = 30.0


# ------------------------------------------------------------------ quaternions (x, y, z, w)

def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qinv(a):
    return (-a[0], -a[1], -a[2], a[3])


def qaxis(axis, deg):
    h = math.radians(deg) / 2
    s = math.sin(h)
    return {'X': (s, 0, 0, math.cos(h)), 'Y': (0, s, 0, math.cos(h)), 'Z': (0, 0, s, math.cos(h))}[axis]


def qrot(q, v):
    x, y, z, _ = qmul(qmul(q, (v[0], v[1], v[2], 0)), qinv(q))
    return (x, y, z)


def qnorm(q):
    n = math.sqrt(sum(c * c for c in q)) or 1
    return tuple(c / n for c in q)


def qslerp(a, b, t):
    d = sum(x * y for x, y in zip(a, b))
    if d < 0:
        b = tuple(-c for c in b)
        d = -d
    if d > 0.9995:
        return qnorm(tuple(x + (y - x) * t for x, y in zip(a, b)))
    th = math.acos(min(1.0, d))
    s = math.sin(th)
    wa = math.sin((1 - t) * th) / s
    wb = math.sin(t * th) / s
    return tuple(wa * x + wb * y for x, y in zip(a, b))


def qangle(a, b):
    d = abs(sum(x * y for x, y in zip(a, b)))
    return 2 * math.acos(min(1.0, d))


# ------------------------------------------------------------------ BVH

def read_bvh(path):
    with open(path) as f:
        tokens = f.read().split()
    i = 0
    names, parents, offsets, channels = [], [], [], []
    stack = []
    while tokens[i] != 'MOTION':
        t = tokens[i]
        if t in ('ROOT', 'JOINT'):
            names.append(tokens[i + 1])
            parents.append(stack[-1] if stack else -1)
            offsets.append((0.0, 0.0, 0.0))
            channels.append([])
            i += 2
        elif t == 'End':
            names.append(None)
            parents.append(stack[-1])
            offsets.append((0.0, 0.0, 0.0))
            channels.append([])
            i += 2
        elif t == '{':
            stack.append(len(names) - 1)
            i += 1
        elif t == '}':
            stack.pop()
            i += 1
        elif t == 'OFFSET':
            offsets[-1] = tuple(float(x) for x in tokens[i + 1:i + 4])
            i += 4
        elif t == 'CHANNELS':
            n = int(tokens[i + 1])
            channels[-1] = tokens[i + 2:i + 2 + n]
            i += 2 + n
        else:
            i += 1
    frames = int(tokens[i + 2])
    frame_time = float(tokens[i + 5])
    i += 6
    width = sum(len(c) for c in channels)
    data = [[float(x) for x in tokens[i + f * width:i + (f + 1) * width]] for f in range(frames)]
    return names, parents, offsets, channels, frame_time, data


def frame_pose(names, channels, row):
    """Local rotations and the root position of one frame."""
    k = 0
    local, root = [], (0, 0, 0)
    for ch in channels:
        q = (0, 0, 0, 1)
        pos = [0.0, 0.0, 0.0]
        for c in ch:
            v = row[k]
            k += 1
            if c.endswith('position'):
                pos['XYZ'.index(c[0])] = v
            else:
                q = qmul(q, qaxis(c[0], v))
        local.append(q)
        if ch and ch[0].endswith('position'):
            root = tuple(pos)
    return local, root


def world_rotations(parents, local):
    w = []
    for i, p in enumerate(parents):
        w.append(local[i] if p < 0 else qmul(w[p], local[i]))
    return w


def tpose_positions(parents, offsets, world):
    pos = []
    for i, p in enumerate(parents):
        pos.append((0, 0, 0) if p < 0 else tuple(a + b for a, b in zip(pos[p], qrot(world[p], offsets[i]))))
    return pos


# ------------------------------------------------------------------ bake

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('bvh')
    ap.add_argument('skeleton')
    ap.add_argument('out')
    ap.add_argument('--mode', choices=('gait', 'loop', 'once'), required=True)
    ap.add_argument('--start', type=float, default=0.0, help='seconds')
    ap.add_argument('--end', type=float, default=0.0, help='seconds (0: the end)')
    ap.add_argument('--blend', type=float, default=0.4, help='seam cross-fade, seconds (loops)')
    a = ap.parse_args()

    sk = json.load(open(a.skeleton))['bones']
    tnames = [b['name'] for b in sk]
    tparent = [b['parent'] for b in sk]
    tlocal0 = [tuple(b['q']) for b in sk]
    tworld0 = world_rotations(tparent, tlocal0)
    toff = [tuple(b['offset']) for b in sk]

    names, parents, offsets, channels, frame_time, rows = read_bvh(a.bvh)
    joint_idx = [i for i, n in enumerate(names) if n is not None]
    by_name = {names[i]: i for i in joint_idx}
    missing = [n for n in tnames if n not in by_name]
    if missing:
        raise SystemExit(f'BVH lacks bones {missing}')

    # Source T-pose (frame 0) world rotations, and both subjects' leg lengths for the hips' travel.
    l0, _ = frame_pose(names, channels, rows[0])
    sworld0 = world_rotations(parents, l0)
    spos0 = tpose_positions(parents, offsets, sworld0)
    tpos0 = tpose_positions(tparent, [(0, 0, 0)] + toff[1:], tworld0)

    def leg(pos, nm, idx):
        return sum(math.dist(pos[idx(nm[k])], pos[idx(nm[k + 1])]) for k in range(2))
    sleg = leg(spos0, ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], lambda n: by_name[n]) * SCALE
    tleg = leg(tpos0, ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], tnames.index)
    hip_scale = tleg / sleg

    # Every frame at 30 fps: target local rotations and hips (metres, capture frame).
    step = max(1, round(1 / (FPS * frame_time)))
    first = max(1, int(a.start / frame_time))
    last = len(rows) - 1 if a.end <= 0 else min(len(rows) - 1, int(a.end / frame_time))
    frames = []
    for f in range(first, last + 1, step):
        loc, root = frame_pose(names, channels, rows[f])
        sw = world_rotations(parents, loc)
        tw = []
        for ti, n in enumerate(tnames):
            si = by_name[n]
            delta = qmul(sw[si], qinv(sworld0[si]))
            tw.append(qmul(delta, tworld0[ti]))
        tl = [tw[i] if p < 0 else qnorm(qmul(qinv(tw[p]), tw[i])) for i, p in enumerate(tparent)]
        hips = tuple(c * SCALE * hip_scale for c in root)
        frames.append({'local': tl, 'world': tw, 'hips': hips})

    hips_i = tnames.index('Hips')

    def heading(fr):
        """The yaw (rad, about +Y) of the subject's facing: the hips turned from the T-pose's +Z."""
        d = qmul(fr['world'][hips_i], qinv(tworld0[hips_i]))
        fx, _, fz = qrot(d, (0, 0, 1))
        return math.atan2(fx, fz)

    def turn(frs, yaw, centre):
        """Turns every frame by −yaw about +Y round `centre` (x, z): the root's rotation and the hips."""
        q = qaxis('Y', -math.degrees(yaw))
        cx, cz = centre
        for fr in frs:
            fr['local'][hips_i] = qnorm(qmul(q, fr['local'][hips_i]))
            x, y, z = fr['hips']
            rx, _, rz = qrot(q, (x - cx, 0, z - cz))
            fr['hips'] = (rx, y, rz)

    speed = 0.0
    if a.mode == 'gait':
        # The cycle: the pair (i, j) a 0.7–1.6 s cycle apart whose poses (all bones' rotations relative to the
        # hips) match best.
        def rel(fr):
            hw = fr['world'][hips_i]
            return [qmul(qinv(hw), w) for w in fr['world']]
        rels = [rel(fr) for fr in frames]

        def diff(i, j):
            return sum(qangle(x, y) for x, y in zip(rels[i], rels[j]))
        best = None
        for i in range(0, len(frames) - int(0.7 * FPS)):
            for n in range(int(0.7 * FPS), int(1.6 * FPS)):
                j = i + n
                if j >= len(frames):
                    break
                d = diff(i, j)
                if best is None or d < best[0]:
                    best = (d, i, j)
        _, i0, j0 = best
        cyc = frames[i0:j0 + 1]
        # Along the travel: turned so it runs along +Z, then the travel stripped and the hips centred.
        tx = cyc[-1]['hips'][0] - cyc[0]['hips'][0]
        tz = cyc[-1]['hips'][2] - cyc[0]['hips'][2]
        turn(cyc, math.atan2(tx, tz), (cyc[0]['hips'][0], cyc[0]['hips'][2]))
        dist = math.hypot(tx, tz)
        n = len(cyc) - 1
        speed = dist / (n / FPS)
        for k, fr in enumerate(cyc):
            x, y, z = fr['hips']
            fr['hips'] = (x, y, z - dist * k / n)
        cyc = cyc[:-1]  # the last frame is the first again
        # Start where the left foot is furthest forward (+Z) of the right: the phase convention (0 and ½
        # both planted).
        def foot_lead(fr):
            w = world_rotations(tparent, fr['local'])
            p = tpose_positions(tparent, [(0, 0, 0)] + toff[1:], w)
            return p[tnames.index('LeftFoot')][2] - p[tnames.index('RightFoot')][2]
        lead = max(range(len(cyc)), key=lambda k: foot_lead(cyc[k]))
        cyc = cyc[lead:] + cyc[:lead]
        frames = cyc
        mx = sum(f['hips'][0] for f in frames) / len(frames)
        mz = sum(f['hips'][2] for f in frames) / len(frames)
        frames = [{**f, 'hips': (f['hips'][0] - mx, f['hips'][1], f['hips'][2] - mz)} for f in frames]
    elif a.mode == 'loop':
        yaws = [heading(f) for f in frames]
        mean = math.atan2(sum(math.sin(y) for y in yaws), sum(math.cos(y) for y in yaws))
        turn(frames, mean, (frames[0]['hips'][0], frames[0]['hips'][2]))
        n = len(frames) - 1
        dx = frames[-1]['hips'][0] - frames[0]['hips'][0]
        dz = frames[-1]['hips'][2] - frames[0]['hips'][2]
        for k, fr in enumerate(frames):
            x, y, z = fr['hips']
            fr['hips'] = (x - dx * k / n, y, z - dz * k / n)
        mx = sum(f['hips'][0] for f in frames) / len(frames)
        mz = sum(f['hips'][2] for f in frames) / len(frames)
        frames = [{**f, 'hips': (f['hips'][0] - mx, f['hips'][1], f['hips'][2] - mz)} for f in frames]
        # Cross-fade the last `blend` seconds into the first frames, then drop them: the loop closes.
        b = max(1, int(a.blend * FPS))
        head, tail = frames[:b], frames[-b:]
        for k in range(b):
            t = (k + 1) / (b + 1)
            tail[k]['local'] = [qslerp(x, y, t) for x, y in zip(tail[k]['local'], head[k]['local'])]
            tail[k]['hips'] = tuple(x + (y - x) * t for x, y in zip(tail[k]['hips'], head[k]['hips']))
        frames = frames[b:-b] + tail if len(frames) > 3 * b else frames
        speed = -1.0
    else:
        turn(frames, heading(frames[0]), (frames[0]['hips'][0], frames[0]['hips'][2]))
        ox, oz = frames[0]['hips'][0], frames[0]['hips'][2]
        frames = [{**f, 'hips': (f['hips'][0] - ox, f['hips'][1], f['hips'][2] - oz)} for f in frames]

    nb = len(tnames)
    with open(a.out, 'wb') as f:
        f.write(struct.pack('<IHHff', 0x31434f4d, nb, len(frames), FPS, speed))
        for fr in frames:
            f.write(struct.pack('<3f', *fr['hips']))
        for fr in frames:
            for q in fr['local']:
                q = q if q[3] >= 0 else tuple(-c for c in q)
                f.write(struct.pack('<4h', *(max(-32767, min(32767, round(c * 32767))) for c in q)))
    print(f'{a.out}: {len(frames)} frames, {len(frames) / FPS:.2f} s, speed {speed:.3f} m/s, hips ×{hip_scale:.3f}')


if __name__ == '__main__':
    main()
