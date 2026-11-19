"""Turns a downloaded armoured-vehicle model into the Tanks game's three moving parts.

    blender -b --python prepare_tank.py -- model.glb --out out/mbt_west --length 9.77 --forward -y --preview

(or with the `bpy` module: python -I prepare_tank.py -- ...). Many models arrive with their parts merged by
material, so the split is geometric, on the model's loose pieces after it is oriented and scaled
(prepare_vehicle.py: metres, Y up, front toward -Z, standing on y = 0):

  gun     the longest slender piece lying along the vehicle (the barrel), and every piece on its axis in
          front of its breech (muzzle brake, fume extractor, thermal sleeve);
  turret  the biggest broad piece above the hull's deck (the turret shell), and every piece standing on
          its footprint above its floor (hatches, sights, the roof gun, stowage bins);
  hull    the rest, running gear included (the game does not turn these wheels).

Writes <out>.glb with three nodes, `hull` in the hull frame, `turret` about its ring (the turret's pivot)
and `gun` about its trunnions (the gun's pivot), ambient occlusion baked by Cycles into a vertex colour,
and <out>.json with the pivots, the muzzle, the parts' boxes and the vehicle's size. --preview renders
the split, hull grey, turret blue, gun red, to check it.
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


def args_of():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--out', required=True)
    ap.add_argument('--length', type=float, required=True, help='real length over all, gun forward, m')
    ap.add_argument('--forward', default='-y')
    ap.add_argument('--up', default='z')
    ap.add_argument('--triangles', type=int, default=40000, help='budget for the whole vehicle')
    ap.add_argument('--tex', type=int, default=2048)
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--cpu', action='store_true')
    # Overrides when the automatic split misreads a model (metres, game frame).
    ap.add_argument('--turret-floor', type=float, default=None, help='height of the turret ring')
    ap.add_argument('--turret-margin', type=float, default=0.06,
                    help='how far outside the shell the centre of a piece may lie (a mantlet, a launcher on its side)')
    return ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def box(ob):
    lo, hi = pv.bounds([ob])
    return lo, hi, (lo + hi) / 2, hi - lo


def find_barrel(parts, front_z, size):
    """The longest piece much longer than it is wide, along Z, its muzzle in the vehicle's front third
    (a tank's gun overhangs the hull; an IFV's cannon may stop short of its nose), round in section, near
    the centre line and above the running gear: the barrel. Track runs and side skirts are as slender but
    lie low or are flat."""
    best, best_len = None, 0.0
    for p in parts:
        lo, hi, c, d = box(p)
        slender = d.z > 6 * max(d.x, d.y) and d.z > 0.12 * size.z
        # A tube, not a plate (side skirts are as long and lie as high), near the centre line.
        round_ = 0.5 < d.x / max(d.y, 1e-6) < 2.0 and abs(c.x) < 0.25 * size.x
        if slender and round_ and lo.z < front_z + 0.33 * size.z and c.y > 0.9 and d.z > best_len:
            best, best_len = p, d.z
    return best


def find_shell(parts, deck_y, size):
    """The biggest broad piece whose floor is at or above the hull deck and that is no longer than a
    turret is (at most 0.6 of the vehicle, gun included; a low hull's deck plate runs most of it) and
    rises well above the deck (the glacis does not): the turret's shell."""
    best, best_area = None, 0.0
    for p in parts:
        lo, hi, c, d = box(p)
        area = d.x * d.z
        if lo.y > deck_y - 0.15 and hi.y > deck_y + 0.35 and d.x > 0.35 * size.x and 0.2 * size.z < d.z < 0.6 * size.z and area > best_area:
            best, best_area = p, area
    return best


def deck_height(parts, size):
    """The hull deck: the top of the biggest piece spanning most of the vehicle's length."""
    best, best_area = None, 0.0
    for p in parts:
        lo, hi, c, d = box(p)
        if d.z > 0.55 * size.z and d.x > 0.6 * size.x and d.x * d.z > best_area:
            best, best_area = p, d.x * d.z
    if best is None:
        return 0.45 * size.y
    return pv.bounds([best])[1].y


def main():
    a = args_of()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    print('Cycles device:', pv.use_gpu(a.cpu))
    pv.import_model(a.model)
    pv.flatten_hierarchy()
    pv.orient_and_scale(a.forward, a.up, a.length)
    parts = []
    for o in list(pv.meshes()):
        parts += pv.split_loose(o)
    lo, hi = pv.bounds(parts)
    size = hi - lo
    print(f'{len(parts)} loose pieces; size {size.x:.2f} × {size.y:.2f} × {size.z:.2f} m')
    print(f'{pv.outward_normals(parts)} pieces faced inward, turned')

    barrel = find_barrel(parts, lo.z, size)
    if barrel is None:
        raise SystemExit('no barrel found: a slender piece along the vehicle in its front half')
    blo, bhi, bc, bd = box(barrel)
    axis_x, axis_y = bc.x, bc.y
    radius = max(bd.x, bd.y) * 0.5
    breech_z = bhi.z
    reach = max(radius * 2.0, 0.12)

    def on_axis(p):
        # Wholly inside a cylinder round the barrel's axis, between its muzzle and its breech: the muzzle
        # brake and the fume extractor are; the glacis, whose centre may sit on the axis, is not.
        plo, phi, _, _ = box(p)
        return (max(abs(plo.x - axis_x), abs(phi.x - axis_x)) < reach and max(abs(plo.y - axis_y), abs(phi.y - axis_y)) < reach
                and plo.z >= blo.z - 0.15 and phi.z <= breech_z + 0.05)

    gun = [p for p in parts if p is barrel or on_axis(p)]
    deck_y = deck_height(parts, size)
    shell = find_shell([p for p in parts if p not in gun], deck_y, size)
    if shell is None:
        raise SystemExit('no turret shell found above the deck; pass --turret-floor')
    slo, shi, sc, sd = box(shell)
    floor_y = a.turret_floor if a.turret_floor is not None else slo.y
    margin = a.turret_margin
    turret = [p for p in parts if p not in gun and (p is shell or (
        slo.x - margin <= box(p)[2].x <= shi.x + margin and slo.z - margin <= box(p)[2].z <= shi.z + margin and box(p)[0].y >= floor_y - 0.03))]
    hull = [p for p in parts if p not in gun and p not in turret]
    print(f'deck {deck_y:.2f} m, turret floor {floor_y:.2f} m; pieces: hull {len(hull)}, turret {len(turret)}, gun {len(gun)}')

    turret_pivot = Vector((sc.x, floor_y, sc.z))
    gun_pivot_hull = Vector((axis_x, axis_y, breech_z))
    gun_pivot = gun_pivot_hull - turret_pivot
    muzzle = Vector((0, 0, min(box(p)[0].z for p in gun) - gun_pivot_hull.z))

    hull_ob = pv.join(hull, 'hull')
    turret_ob = pv.join(turret, 'turret')
    gun_ob = pv.join(gun, 'gun')
    # Share of the triangle budget by share of the triangles each part has now.
    obs = [hull_ob, turret_ob, gun_ob]
    tris = [sum(len(f.vertices) - 2 for f in o.data.polygons) for o in obs]
    total = sum(tris)
    for o, t in zip(obs, tris):
        if total > a.triangles:
            pv.decimate(o, max(200, int(a.triangles * t / total)))
    pv.downscale_textures(a.tex)
    albedo = mean_albedo(obs)
    pv.ray_ao(obs)
    boxes = {}
    for name, o in (('hull', hull_ob), ('turret', turret_ob), ('gun', gun_ob)):
        plo, phi = pv.bounds([o])
        boxes[name] = {'min': [round(v, 3) for v in plo], 'max': [round(v, 3) for v in phi]}
    if a.preview:
        preview(obs, a.out + '_preview.png')
    # Turret about its ring, gun about its trunnions: the game hangs them under its pivots.
    turret_ob.data.transform(Matrix.Translation(-turret_pivot))
    gun_ob.data.transform(Matrix.Translation(-gun_pivot_hull))
    pv.export(a.out + '.glb', obs)
    info = {
        'source': os.path.basename(a.model),
        'size': [round(size.x, 3), round(size.y, 3), round(size.z, 3)],
        'turretPivot': [round(v, 4) for v in turret_pivot],
        'gunPivot': [round(v, 4) for v in gun_pivot],
        'muzzle': [round(v, 4) for v in muzzle],
        'boxes': boxes,
        'triangles': sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in obs),
        'albedo': round(albedo, 4),
    }
    with open(a.out + '.json', 'w') as f:
        json.dump(info, f, indent=1)
    print(json.dumps(info, indent=1))


def mean_albedo(obs):
    """Mean linear luminance of the colour textures, weighted by the triangles that wear each: game
    textures are often painted dark, lighting baked in, and the game lifts them to a real paint's albedo."""
    import numpy as np
    weight, total = 0.0, 0.0
    for o in obs:
        for slot, mat in enumerate(o.data.materials):
            img = base_image(mat)
            if img is None:
                continue
            tris = sum(len(f.vertices) - 2 for f in o.data.polygons if f.material_index == slot)
            px = np.empty(len(img.pixels), dtype=np.float32)
            img.pixels.foreach_get(px)
            rgb = px.reshape(-1, 4)[:, :3]
            # Byte images hold their sRGB code values; decode before averaging.
            lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
            lum_all = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
            # The atlas's empty background is black and no face samples it: leave it out of the mean.
            used = lum_all[lum_all > 0.0015]
            lum = float(used.mean()) if used.size else 0.0
            weight += tris
            total += tris * lum
    return total / weight if weight else 0.0


def base_image(mat):
    """The image feeding a material's base colour, if any."""
    if mat is None or not mat.use_nodes:
        return None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None or not bsdf.inputs['Base Color'].links:
        return None
    node = bsdf.inputs['Base Color'].links[0].from_node
    while node is not None and node.type != 'TEX_IMAGE':
        links = [l for i in node.inputs for l in i.links]
        node = links[0].from_node if links else None
    return node.image if node is not None and node.image is not None and node.image.size[0] > 0 else None


def preview(obs, path):
    """The split at a glance: hull grey, turret blue, gun red, from the front left and above."""
    colours = {'hull': (0.5, 0.5, 0.5, 1), 'turret': (0.15, 0.35, 0.9, 1), 'gun': (0.9, 0.15, 0.1, 1)}
    saved = {}
    for o in obs:
        m = bpy.data.materials.new(o.name + '_flat')
        m.diffuse_color = colours[o.name]
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = colours[o.name]
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
    scene.render.resolution_x, scene.render.resolution_y = 1200, 500
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size * 1.08
    cam.data.clip_end = size * 20
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 1.2
    # The data is the game's frame (Y up, front toward -Z). Side: from the left (-X), front to the left
    # of the picture; top: from above, front at the top.
    views = [
        ('side', Vector((c.x - size * 3, c.y, c.z)), Vector((1, 0, 0)), Vector((0, 1, 0))),
        ('top', Vector((c.x, c.y + size * 3, c.z)), Vector((0, -1, 0)), Vector((0, 0, -1))),
    ]
    base = path[:-4] if path.endswith('.png') else path
    for name, loc, look, up in views:
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
