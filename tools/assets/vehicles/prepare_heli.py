"""Turns a downloaded attack-helicopter model into Ridgeline's moving parts.

    python -I prepare_heli.py -- scene.gltf --out out/heli_warden --rotor-radius 7.3 --forward x --preview

(or blender -b --python prepare_heli.py -- ...). The model is oriented (metres, Y up, nose toward -Z),
split into its loose pieces, and those sorted geometrically:

  rotor_*     the main rotor's blades (long, flat, high, radiating from one axis) and the hub between
              them, apart; the model is scaled so the blades reach --rotor-radius, as the flight model's do;
  tail_*      the tail rotor's blades (thin, standing in a vertical plane beside the fin) and its hub;
  gun         the chin cannon: the longest piece along the body low under the nose, and the pieces on
              its axis behind it (the receiver), pivoting at its breech;
  missile_N   each anti-armour missile (the pieces of the material named like 'missile'), in firing
              order: outboard before inboard, lower before upper, left before right;
  glass       the canopy (material named like 'glass'), for the game's own glass;
  body        everything else; decal and alpha-card materials without a texture are dropped.

The mast's axis is put at x = z = 0 with the wheels on y = 0. Writes <out>.glb (rotor and tail about their
hubs, gun about its breech, the rest in the body frame), and <out>.json with the hub, tail hub and axis,
gun pivot, missiles, the size and the colour textures' mean albedo.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prepare_vehicle as pv  # noqa: E402
import prepare_tank as pt  # noqa: E402


def args_of():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--out', required=True)
    ap.add_argument('--rotor-radius', type=float, required=True, help='main rotor radius, m (the flight model\'s)')
    ap.add_argument('--forward', default='x')
    ap.add_argument('--up', default='z')
    ap.add_argument('--triangles', type=int, default=60000)
    ap.add_argument('--tex', type=int, default=2048)
    ap.add_argument('--glass', default='glass', help="words in the canopy's material names")
    ap.add_argument('--gun-object', default='',
                    help="the source object holding the whole gun mount, when its barrel is modelled turned aside")
    ap.add_argument('--eyes', default='',
                    help='gunner z,y,pilot z,y (m, the output frame) where the canopy does not split into two sections')
    ap.add_argument('--stores', default='',
                    help='stores modelled into the body, mirrored to both sides: "pod x,y,z,front;launcher x,y,z,length" '
                         '(m, the output frame)')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--cpu', action='store_true')
    return ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def box(p):
    lo, hi = pv.bounds([p])
    return lo, hi, (lo + hi) / 2, hi - lo


def mat_name(p):
    return (p.data.materials[0].name if p.data.materials else '').lower()


def black_or_missing(mat):
    img = pt.base_image(mat) if mat else None
    if img is None:
        return True
    import numpy as np
    px = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(px)
    return float(px.reshape(-1, 4)[:, :3].max()) < 0.03


def eyes_of(glass):
    """Where the crew's eyes are: the canopy's glass near the centre line falls into two sections along the
    body (gunner ahead, pilot behind), split at the widest gap; each eye in the middle of its section, a
    head's height under its roof."""
    near = sorted((p for p in glass if abs(box(p)[2].x) < 0.7), key=lambda p: box(p)[2].z)
    if len(near) < 2:
        return None
    zs = [box(p)[2].z for p in near]
    gaps = [(zs[i + 1] - zs[i], i) for i in range(len(zs) - 1)]
    _, cut = max(gaps)
    out = []
    for sec in (near[:cut + 1], near[cut + 1:]):
        lo, hi = pv.bounds(sec)
        out.append([0.0, round(hi.y - 0.27, 3), round((lo.z + hi.z) / 2, 3)])
    return {'gunner': out[0], 'pilot': out[1]}


def missiles_of(parts):
    """The anti-armour missiles: slender bodies 1.4-2 m long of the missile material (the rocket pods' tubes
    share it)."""
    return [p for p in parts if 'missile' in mat_name(p) and 1.4 < box(p)[3].z < 2.0 and max(box(p)[3].x, box(p)[3].y) < 0.3]


def straightened_gun(pieces):
    """A gun mount posed turned aside (a rigged model's animation frame): its long axis is the principal
    axis of its vertices; it is turned about the mount's middle until that axis points straight ahead (-Z),
    level, so the game's traverse and elevation start from the centre line. Returns the pieces and the
    breech (the pivot)."""
    import numpy as np
    if not pieces:
        raise SystemExit('--gun-object: no pieces of that object')
    pts = np.array([tuple(p.matrix_world @ v.co) for p in pieces for v in p.data.vertices])
    mid = pts.mean(0)
    axis = np.linalg.svd(pts - mid, full_matrices=False)[2][0]
    if axis[2] > 0:
        axis = -axis
    # The mount turns about its own middle (the turret ring under the nose): the median vertex lies in its
    # bulk, not out along the barrel.
    pivot = Vector(np.median(pts, 0))
    a = Vector(axis).normalized()
    turn = a.rotation_difference(Vector((0, 0, -1))).to_matrix().to_4x4()
    m = Matrix.Translation(pivot) @ turn @ Matrix.Translation(-pivot)
    for p in pieces:
        p.data.transform(p.matrix_world.inverted() @ m @ p.matrix_world)
    yaw = math.degrees(math.atan2(-axis[0], -axis[2]))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, axis[1]))))
    print(f'gun: {len(pieces)} pieces, turned {yaw:.1f}° and pitched {pitch:.1f}° off the centre line; straightened')
    return pieces, pivot


def main():
    a = args_of()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    print('Cycles device:', pv.use_gpu(a.cpu))
    pv.import_model(a.model)
    pv.flatten_hierarchy()
    # Meshes with no material at all are an exporter's helpers (a bounding sphere, a collision hull): they
    # would set the ground and the size.
    helpers = [o for o in pv.meshes() if not any(o.data.materials)]
    for o in helpers:
        bpy.data.objects.remove(o)
    if helpers:
        print(f'{len(helpers)} helper meshes without a material dropped')
    # Any length first: the blades set the scale below.
    pv.orient_and_scale(a.forward, a.up, 17.0)
    parts = []
    for o in list(pv.meshes()):
        parts += pv.split_loose(o)
    # Decal planes and alpha cards whose texture is missing or black (their picture was in an alpha
    # channel a JPEG cannot carry) render as black sheets on the fuselage.
    dropped = [p for p in parts if ('decal' in mat_name(p) or 'alpha' in mat_name(p)) and black_or_missing(p.data.materials[0])]
    for p in dropped:
        parts.remove(p)
        bpy.data.objects.remove(p)
    print(f'{len(parts)} pieces ({len(dropped)} untextured decal or alpha cards dropped); '
          f'{pv.outward_normals(parts)} faced inward, turned')
    lo, hi = pv.bounds(parts)
    size = hi - lo

    # Main rotor blades: long, flat, high up, radiating from one axis.
    blades = []
    for p in parts:
        l, h, c, d = box(p)
        if max(d.x, d.z) > 0.25 * size.z and d.y < 0.08 * size.z and c.y > 0.55 * size.y:
            blades.append(p)
    if len(blades) < 2:
        raise SystemExit('no main rotor blades found')
    axis = sum((box(p)[2] for p in blades), Vector()) / len(blades)
    tip = max(max(math.hypot(v.x - axis.x, v.z - axis.z) for v in (box(p)[0], box(p)[1])) for p in blades)
    s = a.rotor_radius / tip
    centre = Matrix.Translation(Vector((-axis.x, 0, -axis.z)))
    for p in parts:
        p.data.transform(Matrix.Scale(s, 4) @ centre)
    lo, hi = pv.bounds(parts)
    size = hi - lo
    print(f'scaled ×{s:.4f} to a {a.rotor_radius} m rotor; size {size.x:.2f} × {size.y:.2f} × {size.z:.2f} m')
    blade_y = sum(box(p)[2].y for p in blades) / len(blades)
    blade_lo = min(box(p)[0].y for p in blades)
    blade_hi = max(box(p)[1].y for p in blades)
    # The hub: what sits on the mast between the blades' heights (the mast-top sight above is fixed).
    rotor = blades + [p for p in parts if p not in blades and (lambda l, h, c, d: math.hypot(c.x, c.z) < 0.9 and l.y > blade_lo - 0.35 and h.y < blade_hi + 0.3)(*box(p))]
    hub = Vector((0, blade_y, 0))
    # Blades by direction from the hub (a blade may come as several pieces: skin, spar, tip cap).
    blade_count = len({round(math.degrees(math.atan2(box(p)[2].z, box(p)[2].x)) / 15) % 24 for p in blades})

    rest = [p for p in parts if p not in rotor]
    # Tail rotor: thin pieces in a vertical plane (thin across the body) at the tail, off to one side of the fin.
    rear = max(box(p)[1].z for p in rest)
    tail_blades = []
    for p in rest:
        l, h, c, d = box(p)
        if c.z > rear - 0.15 * size.z and c.y > 0.35 * size.y and abs(c.x) > 0.3 and d.x < 0.06 and max(d.y, d.z) > 0.04 * size.z:
            tail_blades.append(p)
    if len(tail_blades) < 2:
        raise SystemExit('no tail rotor blades found')
    tail_c = sum((box(p)[2] for p in tail_blades), Vector()) / len(tail_blades)
    tail_r = max(max((Vector((0, v.y, v.z)) - Vector((0, tail_c.y, tail_c.z))).length for v in (box(p)[0], box(p)[1])) for p in tail_blades)
    tail_side = 1 if tail_c.x > 0 else -1
    tail = tail_blades + [p for p in rest if p not in tail_blades and (lambda l, h, c, d: (Vector((0, c.y, c.z)) - Vector((0, tail_c.y, tail_c.z))).length < 0.3 * tail_r and abs(c.x - tail_c.x) < 0.35 and max(d.y, d.z) < 0.6 * tail_r)(*box(p))]
    # The hub across the blades (a scissor rotor's two pairs sit a little apart along the axis).
    tail_hub = Vector((sum(box(p)[2].x for p in tail) / len(tail), tail_c.y, tail_c.z))
    rest = [p for p in rest if p not in tail]

    if a.gun_object:
        gun, breech = straightened_gun([p for p in rest if p.get('src', '') == a.gun_object])
        gun_length = breech.z - min(box(p)[0].z for p in gun)
    else:
        # Gun: the longest piece along the body, low, ahead of the mast; with what lies on its axis behind it.
        barrel, best = None, 0.0
        for p in rest:
            l, h, c, d = box(p)
            if d.z > 6 * max(d.x, d.y) and c.y < 0.2 * size.y and c.z < -0.1 * size.z and abs(c.x) < 0.4 and d.z > best:
                barrel, best = p, d.z
        if barrel is None:
            raise SystemExit('no chin gun found (if its barrel is modelled turned aside, pass --gun-object)')
        bl, bh, bc, bd = box(barrel)
        breech = Vector((bc.x, bc.y, bh.z))
        gun_length = bd.z
        gun = [barrel] + [p for p in rest if p is not barrel and (lambda l, h, c, d: abs(c.x - bc.x) < 0.25 and abs(c.y - bc.y) < 0.22 and bl.z - 0.1 < c.z < bh.z + 0.6 and max(d.x, d.y) < 0.45)(*box(p))]
    rest = [p for p in rest if p not in gun]

    # Rocket pods: the rest of the missile material (the tubes and their rockets), a pod per side.
    tubes = [p for p in rest if 'missile' in mat_name(p) and p not in missiles_of(rest)]
    pods = []
    for side in (-1, 1):
        mine = [p for p in tubes if box(p)[2].x * side > 0.5]
        if mine:
            plo, phi = pv.bounds(mine)
            pods.append({'centre': [round(v, 3) for v in (plo + phi) / 2], 'front': round(plo.z, 3)})
    # Missiles, one loose piece each, in firing order.
    # (the rocket pods' tubes share the material: a missile is a slender body 1.4-2 m long)
    missiles = missiles_of(rest)
    missiles.sort(key=lambda p: (-abs(box(p)[2].x), box(p)[2].y, box(p)[2].x))
    rest = [p for p in rest if p not in missiles]
    # A model with its stores in the body's material (closed launch tubes, as on the eastern helicopters):
    # the rocket pods and the anti-armour launchers (the missiles fly from inside them, nothing to hide).
    # They are many small pieces each, so they are given (--stores), measured off a first run's file.
    sealed = []
    for spec in filter(None, (t.strip() for t in a.stores.split(';'))):
        kind, nums = spec.split(None, 1)
        x, y, z, w = (float(v) for v in nums.split(','))
        for side in (-1, 1):
            if kind == 'pod':
                pods.append({'centre': [side * abs(x), y, z], 'front': w})
            elif kind == 'launcher':
                sealed.append({'centre': [side * abs(x), y, z], 'length': w})
            else:
                raise SystemExit(f'--stores: unknown store {kind!r}')
    glass_words = [w.strip().lower() for w in a.glass.split(',') if w.strip()]
    glass = [p for p in rest if any(w in mat_name(p) for w in glass_words)]
    eyes = eyes_of(glass)
    if a.eyes:
        gz, gy, pz, py = (float(v) for v in a.eyes.split(','))
        eyes = {'gunner': [0.0, gy, gz], 'pilot': [0.0, py, pz]}
    body = [p for p in rest if p not in glass]
    print(f'rotor {len(rotor)} ({len(blades)} blades), tail {len(tail)} ({len(tail_blades)} blades, r {tail_r:.2f} m, '
          f'side {tail_side}), gun {len(gun)}, missiles {len(missiles)}, glass {len(glass)}, body {len(body)}')

    obs = []
    # Blades and hubs apart: the game fades the blades into its smear disc as the rotor spins up, the hubs stay.
    rotor_ob = pv.join(blades, 'rotor_blades')
    rotor_hub_ob = pv.join([p for p in rotor if p not in blades], 'rotor_hub')
    tail_ob = pv.join(tail_blades, 'tail_blades')
    tail_hub_ob = pv.join([p for p in tail if p not in tail_blades], 'tail_hub')
    gun_ob = pv.join(gun, 'gun')
    glass_ob = pv.join(glass, 'glass') if glass else None
    body_ob = pv.join(body, 'body')
    missile_obs = []
    for i, m in enumerate(missiles):
        m.name = f'missile_{i}'
        missile_obs.append(m)
    obs = [o for o in (body_ob, glass_ob, rotor_ob, rotor_hub_ob, tail_ob, tail_hub_ob, gun_ob) if o] + missile_obs
    tris = [sum(len(f.vertices) - 2 for f in o.data.polygons) for o in obs]
    total = sum(tris)
    if total > a.triangles:
        for o, t in zip(obs, tris):
            if o is body_ob:
                pv.decimate(o, max(2000, t - (total - a.triangles)))
    pv.downscale_textures(a.tex)
    albedo = pt.mean_albedo(obs)
    pv.ray_ao(obs)
    if a.preview:
        preview(obs, a.out + '_preview.png')
    missile_info = []
    for m in missile_obs:
        l, h = pv.bounds([m])
        missile_info.append({'centre': [round(v, 3) for v in (l + h) / 2], 'length': round(h.z - l.z, 3)})
    for o in (rotor_ob, rotor_hub_ob):
        if o:
            o.data.transform(Matrix.Translation(-hub))
    for o in (tail_ob, tail_hub_ob):
        if o:
            o.data.transform(Matrix.Translation(-tail_hub))
    gun_ob.data.transform(Matrix.Translation(-breech))
    pv.export(a.out + '.glb', obs)
    lo, hi = pv.bounds(obs)
    info = {
        'source': os.path.basename(a.model),
        'size': [round(v, 3) for v in hi - lo],
        'hub': [round(v, 4) for v in hub],
        'rotorRadius': a.rotor_radius,
        'blades': blade_count,
        'tailHub': [round(v, 4) for v in tail_hub],
        'tailRadius': round(tail_r, 3),
        'tailSide': tail_side,
        'gunPivot': [round(v, 4) for v in breech],
        'gunLength': round(gun_length, 3),
        'missiles': missile_info or sealed,
        'pods': pods,
        'eyes': eyes,
        'albedo': round(albedo, 4),
        'triangles': sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in obs),
    }
    with open(a.out + '.json', 'w') as f:
        json.dump(info, f, indent=1)
    print(json.dumps(info, indent=1))


def preview(obs, path):
    """The split at a glance: body grey, glass cyan, rotor blue, tail green, gun red, missiles orange."""
    colours = {'body': (0.5, 0.5, 0.5, 1), 'glass': (0.2, 0.8, 0.9, 1), 'rotor_blades': (0.15, 0.35, 0.9, 1),
               'rotor_hub': (0.5, 0.2, 0.8, 1), 'tail_blades': (0.2, 0.75, 0.2, 1), 'tail_hub': (0.6, 0.8, 0.2, 1),
               'gun': (0.9, 0.15, 0.1, 1)}
    saved = {}
    for o in obs:
        m = bpy.data.materials.new(o.name + '_flat')
        col = colours.get(o.name, (1.0, 0.55, 0.1, 1))
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = col
        # Clearing the slots resets every face's material index to 0: keep them to put back.
        saved[o.name] = (list(o.data.materials), [f.material_index for f in o.data.polygons])
        o.data.materials.clear()
        o.data.materials.append(m)
    lo, hi = pv.bounds(obs)
    c = (lo + hi) / 2
    size = max(hi - lo)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.render.resolution_x, scene.render.resolution_y = 1200, 700
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size * 1.05
    cam.data.clip_end = size * 20
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
    base = path[:-4] if path.endswith('.png') else path
    for name, loc, look, up in (
        ('side', Vector((c.x - size * 3, c.y, c.z)), Vector((1, 0, 0)), Vector((0, 1, 0))),
        ('top', Vector((c.x, c.y + size * 3, c.z)), Vector((0, -1, 0)), Vector((0, 0, -1))),
    ):
        cam.location = loc
        right = look.cross(up)
        cam.rotation_euler = Matrix((right, up, -look)).transposed().to_euler()
        sun.rotation_euler = cam.rotation_euler
        scene.render.filepath = f'{base}_{name}.png'
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(sun)
    for o in obs:
        mats, index = saved[o.name]
        o.data.materials.clear()
        for m in mats:
            o.data.materials.append(m)
        o.data.polygons.foreach_set('material_index', index)


if __name__ == '__main__':
    main()
