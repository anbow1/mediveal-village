"""Builds the Paris crowd's people in Blender from MakeHuman's CC0 data.

Run with Blender's Python module (bpy 4.2) or inside Blender:

    python -I build_people.py --mh-files <dir with base.obj, default.mhskel,
        default_weights.mhw> --mh-data <makehuman/data> --out <dir> [--preview]

For each character in CAST:
  1. the base mesh shaped by MakeHuman's macro targets (gender, age, ethnicity,
     muscle, weight, height), metres, turned to face -Z like the game's actors;
  2. clothes from MakeHuman's helper shells, which follow the body through the
     same targets and carry the same skin weights: the tights shell becomes the
     jacket or coat (torso, arms) and the trousers (legs), the skirt shell the
     skirts of a coat or a skirt, the hair shell the hair; each layer pushed
     out along its normals by its thickness, and the skin it covers removed;
  3. MakeHuman's 163 bones folded into the game's 15 (people.ts / body.ts),
     at most four per vertex, and the joints the game's posing needs;
  4. Blender: a Decimate (collapse) to the game's triangle budget, full and far
     versions, then ambient occlusion baked by Cycles into the vertices;
  5. written as <name>.bin + <name>.json (format in src/life/humanMesh.ts).
--preview renders each character with Cycles into <out>/preview/<name>.png.
"""
import argparse
import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mhdata import BaseMesh, Skeleton, apply_targets, read_target  # noqa: E402

# Parts (the game's material reads them): skin, hair, top, bottom, shoes, accent, legs, eye.
PART = {'skin': 0, 'hair': 1, 'top': 2, 'bottom': 3, 'shoes': 4, 'accent': 5, 'legs': 6, 'eye': 7}

# The game's bones (body.ts BONES), and which MakeHuman bones fold into each. Paired: L = the actor's left.
GAME_BONES = ['pelvis', 'torso', 'head', 'upperArm.L', 'forearm.L', 'hand.L', 'upperArm.R', 'forearm.R', 'hand.R',
              'thigh.L', 'shin.L', 'shoe.L', 'thigh.R', 'shin.R', 'shoe.R']


def game_bone(mh):
    side = 'L' if mh.endswith('.L') else 'R' if mh.endswith('.R') else ''
    base = mh.split('.')[0]
    if base in ('root', 'pelvis', 'spine05', 'special06'):
        return 'pelvis'
    if base.startswith('spine') or base in ('breast', 'clavicle', 'special01') or base.startswith('levator'):
        return 'torso' if base != 'clavicle' else 'torso'
    if base.startswith('neck') or base in ('head', 'jaw', 'eye') or base.startswith(('oculi', 'orbicularis', 'oris', 'risorius', 'temporalis', 'tongue', 'special03', 'special04', 'special05')):
        return 'head'
    if base in ('shoulder01', 'upperarm01', 'upperarm02'):
        return 'upperArm.' + side
    if base in ('lowerarm01', 'lowerarm02'):
        return 'forearm.' + side
    if base in ('wrist',) or base.startswith(('metacarpal', 'finger')):
        return 'hand.' + side
    if base in ('upperleg01', 'upperleg02'):
        return 'thigh.' + side
    if base in ('lowerleg01', 'lowerleg02'):
        return 'shin.' + side
    if base in ('foot',) or base.startswith('toe'):
        return 'shoe.' + side
    raise ValueError(f'MakeHuman bone {mh!r} has no game bone')


# The cast: who walks the boulevard. gender 1 = male; age in years; ethnic mix (african, asian, caucasian).
CAST = [
    {'name': 'man_coat', 'gender': 1.0, 'age': 38, 'eth': (0, 0, 1), 'muscle': 0.55, 'weight': 0.5, 'height': 0.6, 'top': 'coat', 'bottom': 'trousers', 'hair': 'short'},
    {'name': 'woman_coat', 'gender': 0.0, 'age': 31, 'eth': (0, 0.2, 0.8), 'muscle': 0.45, 'weight': 0.45, 'height': 0.5, 'top': 'coat', 'bottom': 'trousers', 'hair': 'long'},
    {'name': 'man_jacket', 'gender': 1.0, 'age': 27, 'eth': (0.9, 0, 0.1), 'muscle': 0.65, 'weight': 0.45, 'height': 0.65, 'top': 'jacket', 'bottom': 'jeans', 'hair': 'short'},
    {'name': 'woman_skirt', 'gender': 0.0, 'age': 26, 'eth': (0, 0.9, 0.1), 'muscle': 0.4, 'weight': 0.4, 'height': 0.35, 'top': 'jacket', 'bottom': 'skirt', 'hair': 'long'},
    {'name': 'man_old', 'gender': 1.0, 'age': 64, 'eth': (0, 0, 1), 'muscle': 0.4, 'weight': 0.65, 'height': 0.45, 'top': 'coat', 'bottom': 'trousers', 'hair': 'short'},
    {'name': 'woman_trench', 'gender': 0.0, 'age': 46, 'eth': (0.1, 0, 0.9), 'muscle': 0.5, 'weight': 0.55, 'height': 0.55, 'top': 'coat', 'bottom': 'legs', 'hair': 'short'},
    {'name': 'man_young', 'gender': 1.0, 'age': 22, 'eth': (0.2, 0.3, 0.5), 'muscle': 0.5, 'weight': 0.3, 'height': 0.55, 'top': 'jacket', 'bottom': 'jeans', 'hair': 'short'},
    {'name': 'woman_african', 'gender': 0.0, 'age': 34, 'eth': (1, 0, 0), 'muscle': 0.55, 'weight': 0.5, 'height': 0.6, 'top': 'jacket', 'bottom': 'trousers', 'hair': 'short'},
]

# Clothing thickness over the tights shell (m): what makes a coat stand off a body and a jacket off a shirt.
THICK = {'coat': 0.016, 'jacket': 0.011, 'trousers': 0.006, 'jeans': 0.004, 'skirt': 0.008, 'hair_short': 0.006, 'hair_long': 0.008, 'shoes': 0.009}
# Triangle budgets: the full body near the camera, the far one (people.ts LOD).
BUDGET = {'full': 6000, 'far': 1400}


# ------------------------------------------------------------------ shaping

def lerp3(v):
    """MakeHuman's three-point macro interpolation (min / average / max) for a value 0…1."""
    if v < 0.5:
        return {'min': (0.5 - v) * 2, 'average': 1 - (0.5 - v) * 2, 'max': 0.0}
    return {'min': 0.0, 'average': 1 - (v - 0.5) * 2, 'max': (v - 0.5) * 2}


def shaped(mesh, macro_dir, c):
    """The base mesh with the character's macro targets applied."""
    g = {'male': c['gender'], 'female': 1 - c['gender']}
    old = min(1.0, max(0.0, (c['age'] - 25) / 65))
    a = {'young': 1 - old, 'old': old}
    eth = dict(zip(('african', 'asian', 'caucasian'), c['eth']))
    weighted = []
    cache = {}

    def t(name):
        if name not in cache:
            p = os.path.join(macro_dir, name)
            cache[name] = read_target(p) if os.path.exists(p) else {}
        return cache[name]

    for e, we in eth.items():
        for gn, wg in g.items():
            for an, wa in a.items():
                w = we * wg * wa
                if w > 0:
                    weighted.append((t(f'{e}-{gn}-{an}.target'), w))
    mu = lerp3(c['muscle'])
    wt = lerp3(c['weight'])
    for gn, wg in g.items():
        for an, wa in a.items():
            for mn, wm in mu.items():
                for wn, ww in wt.items():
                    w = wg * wa * wm * ww
                    if w > 0:
                        weighted.append((t(f'universal-{gn}-{an}-{mn}muscle-{wn}weight.target'), w))
                    hv = c['height']
                    hw = (hv - 0.5) * 2
                    if w > 0 and hw != 0:
                        weighted.append((t(f'height/{gn}-{an}-{mn}muscle-{wn}weight-{"max" if hw > 0 else "min"}height.target'), w * abs(hw)))
    return apply_targets(mesh.verts, weighted)


# ------------------------------------------------------------------ geometry

def face_normal(verts, face):
    p = [verts[v] for v, _ in face]
    nx = ny = nz = 0.0
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    n = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
    return (nx / n, ny / n, nz / n)


def vertex_normals(verts, faces):
    acc = {}
    for f in faces:
        n = face_normal(verts, f)
        for v, _ in f:
            a = acc.setdefault(v, [0.0, 0.0, 0.0])
            a[0] += n[0]
            a[1] += n[1]
            a[2] += n[2]
    out = {}
    for v, a in acc.items():
        l = math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2) or 1
        out[v] = (a[0] / l, a[1] / l, a[2] / l)
    return out


def closest_on_segment(p, a, b):
    ab = [b[i] - a[i] for i in range(3)]
    t = sum((p[i] - a[i]) * ab[i] for i in range(3)) / (sum(x * x for x in ab) or 1)
    t = min(1.0, max(0.0, t))
    return [a[i] + ab[i] * t for i in range(3)]


def bone_axes(skel, verts):
    """Each game bone's axis (two points, MakeHuman frame): the direction away from it is a vertex's outside."""
    h = lambda b: skel.head(verts, b)  # noqa: E731
    t = lambda b: skel.tail(verts, b)  # noqa: E731
    ax = {'pelvis': (h('root'), h('spine03')), 'torso': (h('spine03'), h('neck01')), 'head': (h('head'), t('head'))}
    for s_ in ('L', 'R'):
        ax['upperArm.' + s_] = (h('upperarm01.' + s_), h('lowerarm01.' + s_))
        ax['forearm.' + s_] = (h('lowerarm01.' + s_), h('wrist.' + s_))
        ax['hand.' + s_] = (h('wrist.' + s_), h('finger3-1.' + s_))
        ax['thigh.' + s_] = (h('upperleg01.' + s_), h('lowerleg01.' + s_))
        ax['shin.' + s_] = (h('lowerleg01.' + s_), h('foot.' + s_))
        ax['shoe.' + s_] = (h('foot.' + s_), t('foot.' + s_))
    return ax


def dominant(weights_by_vertex, v):
    w = weights_by_vertex.get(v, {})
    return max(w, key=w.get) if w else 'torso'


def assemble(mesh, verts, skel, c):
    """The character's layers: [(part, faces, offset m)], faces as lists of (vertex, uv)."""
    gw = {}  # vertex -> {game bone: weight}
    for bone, pairs in skel.weights.items():
        gb = game_bone(bone)
        for v, w in pairs:
            d = gw.setdefault(v, {})
            d[gb] = d.get(gb, 0.0) + w
    knee_y = skel.head(verts, 'lowerleg01.L')[1]
    hip_y = skel.head(verts, 'upperleg01.L')[1]
    neck_y = skel.head(verts, 'neck01')[1]

    def region(face):
        bones = [dominant(gw, v) for v, _ in face]
        return max(set(bones), key=bones.count)

    layers = []
    top_bones = {'torso', 'upperArm.L', 'forearm.L', 'upperArm.R', 'forearm.R'}
    leg_bones = {'pelvis', 'thigh.L', 'shin.L', 'thigh.R', 'shin.R'}
    tights = mesh.groups['helper-tights']
    top_faces, leg_faces = [], []
    for f in tights:
        r = region(f)
        ymax = max(verts[v][1] for v, _ in f)
        if r in top_bones and ymax < neck_y + 0.02:
            top_faces.append(f)
        elif r in leg_bones:
            # The jacket covers the waist; the trousers start under it.
            if c['top'] in ('coat', 'jacket') and min(verts[v][1] for v, _ in f) > hip_y + 0.06:
                top_faces.append(f)
            else:
                leg_faces.append(f)
    layers.append(('top', top_faces, THICK[c['top']]))
    if c['bottom'] in ('trousers', 'jeans'):
        layers.append(('bottom', leg_faces, THICK[c['bottom']]))
    if c['top'] == 'coat' or c['bottom'] == 'skirt':
        # The skirt shell: a coat's skirts to below the knee, a skirt to just above it.
        hem = knee_y - 0.12 if c['top'] == 'coat' else knee_y + 0.04
        skirt = [f for f in mesh.groups['helper-skirt'] if min(verts[v][1] for v, _ in f) > hem]
        part = 'top' if c['top'] == 'coat' else 'bottom'
        layers.append((part + '@hips', skirt, THICK['coat'] + 0.006 if part == 'top' else THICK['skirt']))
    hair = mesh.groups['helper-hair']
    head = skel.head(verts, 'head')
    top = skel.tail(verts, 'head')
    # No fringe over the face: in front of the head's axis, hair stops at the hairline (~60 % up the head).
    hairline = head[1] + (top[1] - head[1]) * 0.62
    hair = [f for f in hair if not (min(verts[v][2] for v, _ in f) > head[2] + 0.02 and min(verts[v][1] for v, _ in f) < hairline)]
    if c['hair'] == 'short':
        ear_y = head[1] - 0.01
        hair = [f for f in hair if min(verts[v][1] for v, _ in f) > ear_y]
    else:
        # The helper's lower part is a cage round the shoulders and chest, not hair: long hair stops at the
        # neck's base, and below the ears only behind the head.
        hair = [f for f in hair if min(verts[v][1] for v, _ in f) > neck_y + 0.01 and (min(verts[v][1] for v, _ in f) > head[1] - 0.01 or max(verts[v][2] for v, _ in f) < head[2])]
    layers.append(('hair', hair, THICK['hair_' + c['hair']]))
    for side in ('l', 'r'):
        layers.append(('eye', mesh.groups[f'helper-{side}-eye'], 0.0))
    # Skin: what the clothes leave bare — head, neck, hands; the feet become shoes; legs under a skirt, tights.
    body = []
    shoes = []
    for f in mesh.groups['body']:
        r = region(f)
        ys = [verts[v][1] for v, _ in f]
        if r in ('shoe.L', 'shoe.R'):
            shoes.append(f)
        elif r in ('head', 'hand.L', 'hand.R') or (r == 'torso' and min(ys) > neck_y - 0.03):
            body.append(f)
        elif r in leg_bones and c['bottom'] in ('skirt', 'legs'):
            body.append(f)
    layers.append(('skin', body, 0.0))
    legs_part = 'legs' if c['bottom'] in ('skirt', 'legs') else None
    return layers, gw, legs_part, leg_bones, region


def outward(verts, gw, axes, v):
    """Unit vector from the vertex's own bone axis out through it."""
    a, b = axes[dominant(gw, v)]
    p = verts[v]
    c = closest_on_segment(p, a, b)
    d = [p[i] - c[i] for i in range(3)]
    l = math.sqrt(sum(x * x for x in d)) or 1
    return [x / l for x in d]


def outward_vertical(verts, axes, v):
    """Unit vector out from the vertical line through the hips."""
    hip = axes['pelvis'][0]
    p = verts[v]
    d = [p[0] - hip[0], 0.0, p[2] - hip[2]]
    l = math.sqrt(d[0] ** 2 + d[2] ** 2) or 1
    return [d[0] / l, 0.0, d[2] / l]


def flatten(mesh, verts, layers, gw, legs_part, leg_bones, region, axes):
    """One vertex list for all layers (a vertex per layer it appears in), pushed out by the layer's thickness, faces
    wound to face outward (helper shells do not all agree), game weights."""
    out_pos, out_part, out_w, faces = [], [], [], []
    for tag, lf, off in layers:
        part, _, axis = tag.partition('@')
        # Skirts hang round the hips: their outside is away from the body's vertical axis, whatever thigh
        # weights their vertices carry.
        out_of = (lambda v: outward_vertical(verts, axes, v)) if axis == 'hips' else (lambda v: outward(verts, gw, axes, v))
        normals = vertex_normals(verts, lf)
        # Normals that point into the body are flipped, per vertex, against the bone axis.
        for v, n in list(normals.items()):
            o = out_of(v)
            if sum(n[i] * o[i] for i in range(3)) < 0:
                normals[v] = (-n[0], -n[1], -n[2])
        local = {}
        for f in lf:
            fn = face_normal(verts, f)
            o = out_of(f[0][0])
            if sum(fn[i] * o[i] for i in range(3)) < 0:
                f = list(reversed(f))
            fp = part
            if part == 'skin' and legs_part and region(f) in leg_bones:
                fp = legs_part
            idx = []
            for v, _ in f:
                key = (v, fp)
                if key not in local:
                    n = normals[v]
                    p = verts[v]
                    local[key] = len(out_pos)
                    out_pos.append((p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off))
                    out_part.append(PART[fp])
                    w = sorted(gw.get(v, {'torso': 1.0}).items(), key=lambda kv: -kv[1])[:4]
                    s = sum(x for _, x in w) or 1
                    out_w.append([(GAME_BONES.index(b), x / s) for b, x in w])
                idx.append(local[key])
            faces.append(idx)
    return out_pos, out_part, out_w, faces


def add_shoes(pos, part, weights, faces, skel, verts, c):
    """A shoe on each foot in place of the bare foot: a rounded last from the heel to past the toes, on a sole,
    built along the foot (ankle → toe joint) and weighted to the foot's bone. Women's a little narrower."""
    for s_ in ('L', 'R'):
        ankle = skel.head(verts, 'foot.' + s_)
        toe = skel.tail(verts, 'foot.' + s_)
        fwd = [toe[0] - ankle[0], 0.0, toe[2] - ankle[2]]
        lf = math.sqrt(fwd[0] ** 2 + fwd[2] ** 2) or 1
        fwd = [fwd[0] / lf, 0.0, fwd[2] / lf]
        side = [fwd[2], 0.0, -fwd[0]]
        length = lf + 0.11
        half_w = 0.047 if c['gender'] > 0.5 else 0.042
        bone = GAME_BONES.index('shoe.' + s_)
        base = len(pos)
        rings, seg = 12, 12
        heel = [ankle[0] - fwd[0] * 0.075, 0.0, ankle[2] - fwd[2] * 0.075]
        for i in range(rings + 1):
            t = i / rings
            # Height and width along the shoe: the heel counter, the instep up to the ankle, the toe box.
            h = 0.035 + 0.075 * math.sin(math.pi * min(1.0, t * 1.6)) ** 0.7 * (1 - t) + 0.01
            w = half_w * (0.75 + 0.35 * math.sin(math.pi * min(1.0, t * 1.15)))
            cx = heel[0] + fwd[0] * length * t
            cz = heel[2] + fwd[2] * length * t
            for j in range(seg):
                a = 2 * math.pi * j / seg
                x, y = math.cos(a) * w, max(0.0, math.sin(a)) * h + 0.004 * (1 - abs(math.sin(a)))
                pos.append((cx + side[0] * x, y, cz + side[2] * x))
                part.append(PART['shoes'])
                weights.append([(bone, 1.0)])
        for i in range(rings):
            for j in range(seg):
                a = base + i * seg + j
                b = base + i * seg + (j + 1) % seg
                faces.append([a, b, b + seg, a + seg])
        # Caps at heel and toe.
        faces.append([base + j for j in range(seg)])
        last = base + rings * seg
        faces.append([last + j for j in range(seg)][::-1])


# ------------------------------------------------------------------ Blender

def to_blender(name, pos, part, weights, faces):
    import bpy
    me = bpy.data.meshes.new(name)
    # MakeHuman faces +Z with its left at +X; the game's actors face -Z with their right at +X: a half turn about Y.
    me.from_pydata([(-x, y, -z) for x, y, z in pos], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    groups = [ob.vertex_groups.new(name=b) for b in GAME_BONES]
    pg = ob.vertex_groups.new(name='part')
    for i, ws in enumerate(weights):
        for b, w in ws:
            groups[b].add([i], w, 'REPLACE')
        pg.add([i], part[i] / 10.0, 'REPLACE')
    return ob


def decimate(ob, triangles):
    import bpy
    current = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    mod = ob.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, triangles / max(1, current))
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def bake_ao(ob):
    """Ambient occlusion by Cycles into a vertex colour layer (armpits, under the collar, between the legs)."""
    import bpy
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 64
    me = ob.data
    if 'ao' not in me.color_attributes:
        me.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = me.color_attributes['ao']
    mat = bpy.data.materials.new('bake')
    mat.use_nodes = True
    me.materials.clear()
    me.materials.append(mat)
    for o in scene.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    scene.render.bake.target = 'VERTEX_COLORS'
    scene.world = scene.world or bpy.data.worlds.new('w')
    scene.world.light_settings.distance = 0.25
    bpy.ops.object.bake(type='AO')


def export(ob, path_base, joints, cast):
    """<name>.bin: u32 counts (vertices, indices), f32 pos[3n], f32 nor[3n], u8 part[n], u8 bones[4n], u8 weights[4n],
    u8 ao[n], u32 index[m]; <name>.json: joints and the character's description."""
    me = ob.data
    me.calc_loop_triangles()
    n = len(me.vertices)
    pg = ob.vertex_groups['part'].index
    bone_names = GAME_BONES
    pos, nor, part, bones, wts = [], [], [], [], []
    ao_layer = me.color_attributes.get('ao')
    ao = []
    for v in me.vertices:
        pos += [v.co.x, v.co.y, v.co.z]
        nor += [v.normal.x, v.normal.y, v.normal.z]
        gs = {ob.vertex_groups[g.group].name: g.weight for g in v.groups}
        part.append(int(round(gs.pop('part', 0) * 10)))
        top = sorted(((bone_names.index(k), w) for k, w in gs.items() if k in bone_names), key=lambda kw: -kw[1])[:4]
        s = sum(w for _, w in top) or 1
        top = [(b, w / s) for b, w in top] + [(0, 0.0)] * (4 - len(top))
        bones += [b for b, _ in top]
        wts += [round(w * 255) for _, w in top]
        ao.append(round(255 * (ao_layer.data[v.index].color[0] if ao_layer else 1.0)))
    tris = [i for t in me.loop_triangles for i in t.vertices]
    with open(path_base + '.bin', 'wb') as f:
        f.write(struct.pack('<II', n, len(tris)))
        f.write(struct.pack(f'<{3 * n}f', *pos))
        f.write(struct.pack(f'<{3 * n}f', *nor))
        f.write(bytes(part))
        f.write(bytes(bones))
        f.write(bytes(min(255, w) for w in wts))
        f.write(bytes(min(255, a) for a in ao))
        f.write(struct.pack(f'<{len(tris)}I', *tris))
    with open(path_base + '.json', 'w') as f:
        json.dump({'joints': joints, 'cast': cast, 'vertices': n, 'triangles': len(tris) // 3}, f, indent=1)


def joints_of(skel, verts):
    """The joints the game's posing needs, in the game's frame (facing -Z), metres."""
    def j(bone, tail=False):
        x, y, z = (skel.tail if tail else skel.head)(verts, bone)
        return [round(-x, 5), round(y, 5), round(-z, 5)]
    out = {'hip': j('root'), 'neck': j('neck01'), 'head': j('head'), 'headTop': j('head', True)}
    for mh, game in (('L', 'L'), ('R', 'R')):
        out[f'hip.{game}'] = j(f'upperleg01.{mh}')
        out[f'knee.{game}'] = j(f'lowerleg01.{mh}')
        out[f'ankle.{game}'] = j(f'foot.{mh}')
        out[f'toe.{game}'] = j(f'foot.{mh}', True)
        out[f'shoulder.{game}'] = j(f'upperarm01.{mh}')
        out[f'elbow.{game}'] = j(f'lowerarm01.{mh}')
        out[f'wrist.{game}'] = j(f'wrist.{mh}')
        out[f'fingers.{game}'] = j(f'finger3-1.{mh}')
    # Stand the character on y = 0 (the soles).
    return out


def preview(ob, path):
    import bpy
    scene = bpy.context.scene
    for o in list(scene.objects):
        o.hide_render = o != ob
    mat = bpy.data.materials.new('preview')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'ao'
    bsdf.inputs['Roughness'].default_value = 0.7
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    # The mesh is in the game's frame (Y up); Blender's is Z up: stand it up for the picture only.
    ob.rotation_euler = (math.radians(90), 0, 0)
    # Three-quarter front (the actor faces game -Z, Blender +Y after the turn), aimed at the chest.
    cam.location = (1.7, 3.9, 1.25)
    aim = bpy.data.objects.new('aim', None)
    aim.location = (0, 0, 0.88)
    scene.collection.objects.link(aim)
    track = cam.constraints.new('TRACK_TO')
    track.target = aim
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    cam_data.lens = 60
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(140))
    scene.collection.objects.link(sun)
    scene.world.color = (0.4, 0.45, 0.5)
    scene.render.resolution_x = 420
    scene.render.resolution_y = 640
    scene.cycles.samples = 48
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in (cam, sun, aim):
        bpy.data.objects.remove(o)
    ob.rotation_euler = (0, 0, 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mh-files', required=True)
    ap.add_argument('--mh-data', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--preview', action='store_true')
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else None)
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(args.out, exist_ok=True)
    mesh = BaseMesh(os.path.join(args.mh_files, 'base.obj'))
    skel = Skeleton(os.path.join(args.mh_files, 'default.mhskel'), os.path.join(args.mh_files, 'default_weights.mhw'))
    for c in CAST:
        if args.only and c['name'] not in args.only.split(','):
            continue
        verts = shaped(mesh, os.path.join(args.mh_data, 'targets', 'macrodetails'), c)
        sole = min(v[1] for v in (verts[i] for i in mesh.group_vertices('body')))
        verts = [(x, y - sole + 0.012, z) for x, y, z in verts]
        layers, gw, legs_part, leg_bones, region = assemble(mesh, verts, skel, c)
        axes = bone_axes(skel, verts)
        pos, part, weights, faces = flatten(mesh, verts, layers, gw, legs_part, leg_bones, region, axes)
        add_shoes(pos, part, weights, faces, skel, verts, c)
        joints = joints_of(skel, verts)
        for lod, budget in BUDGET.items():
            ob = to_blender(f"{c['name']}_{lod}", pos, part, weights, faces)
            decimate(ob, budget)
            bake_ao(ob)
            export(ob, os.path.join(args.out, f"{c['name']}_{lod}"), joints, c)
            if args.preview and lod == 'full':
                os.makedirs(os.path.join(args.out, 'preview'), exist_ok=True)
                preview(ob, os.path.join(args.out, 'preview', c['name'] + '.png'))
            print(c['name'], lod, len(ob.data.vertices), 'vertices', flush=True)
            # Gone before the next one: anything left in the scene would occlude the next bake.
            bpy.data.objects.remove(ob)


if __name__ == '__main__':
    main()
