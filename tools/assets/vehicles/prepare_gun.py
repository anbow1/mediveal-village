"""Turns a downloaded firearm model into a first-person weapon for the games: the body as one node and each
moving part (magazine, bolt or charging handle, trigger, selector) as its own, so the game animates them.

    blender -b --python prepare_gun.py -- ak.gltf --out out/ak --length 0.88 --forward y --up z \
        --parts "magazine=magazine_02,bolt=shutter_01,trigger=trigger_03,selector=fuse_04"

(or with the `bpy` module: python -I prepare_gun.py -- ...). Sold weapon models are often rigged: their
moving parts are bound to bones, not separate objects. Each `--parts` entry takes the vertices whose
strongest bone (vertex group) is that name into a node of the given name (a group missing from the model is
reported). Metres, Y up, the muzzle toward -Z; the model is centred across and along, its lowest point at
y = 0 (the game puts the sight line where it wants it, from the `top` profile in the .json). Material-less
helpers are dropped; clear-coat and emission maps unlinked (the games read colour, normal and
metal/roughness); occlusion cast by short rays into the second colour set (the folds of a gun are
millimetres deep: a vehicle's reach would darken all of it); textures downscaled. Writes <out>.glb and
<out>.json: size, triangles, each part's box, and `top`: the highest point on the centre line every 5 mm
along the gun (find the sights in it). Paint makers' marks and serials out first (scrub_marks.py).
"""
import argparse
import json
import os
import sys

import bpy
import bmesh  # noqa: E402 (bpy first: it puts bmesh on the path)
from mathutils import Matrix  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prepare_vehicle as pv  # noqa: E402


def args_of():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--out', required=True)
    ap.add_argument('--length', type=float, required=True, help='real length over all, m')
    ap.add_argument('--forward', default='-y', help="the muzzle's axis in Blender after import")
    ap.add_argument('--up', default='z')
    ap.add_argument('--parts', default='', help='node=vertex group or words in object names (a|b), comma separated')
    ap.add_argument('--part', action='append', default=[],
                    help='name:x0,y0,z0,x1,y1,z1[,min][@word] — loose pieces wholly inside the box (the gun\'s frame, m), '
                         'at least min long and, with @word, from objects with that word in their names: their own node '
                         '(a magazine sold inside a grip, not as an object)')
    ap.add_argument('--triangles', type=int, default=0, help="the body's triangle budget (0: as it is)")
    ap.add_argument('--part-triangles', type=int, default=0, help="each moving part's budget (0: as it is)")
    ap.add_argument('--drop', default='', help='words in the names of parts (or their materials) to leave out')
    ap.add_argument('--tex', type=int, default=2048)
    ap.add_argument('--ao-reach', type=float, default=0.03, help='occlusion ray length, m')
    return ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def group_names():
    """Each mesh's vertex group names, by object name, read before flattening (the flat copies keep the
    weights in their mesh data but not the names, which belong to the object)."""
    return {o.name: [g.name for g in o.vertex_groups] for o in pv.meshes()}


def split_by_group(ob, names, node, group):
    """The faces whose every vertex is held most strongly by `group`, separated into an object `node`."""
    if group not in names:
        print(f'WARNING: no vertex group {group} for --parts {node}={group}; groups: {names}')
        return None
    gi = names.index(group)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    deform = bm.verts.layers.deform.active
    if deform is None:
        print(f'WARNING: {ob.name} carries no weights')
        bm.free()
        return None

    def strongest(v):
        d = v[deform]
        return max(d.items(), key=lambda kv: kv[1])[0] if d else -1

    owned = {v.index for v in bm.verts if strongest(v) == gi}
    picked = [f.index for f in bm.faces if all(v.index in owned for v in f.verts)]
    bm.free()
    if not picked:
        print(f'WARNING: no faces held by {group}')
        return None
    # Two copies of the mesh: the part keeps the picked faces, the body the rest (no edit-mode operators:
    # their separate takes whatever the selection flags of vertices and edges happen to hold).
    part = bpy.data.objects.new(node, ob.data.copy())
    bpy.context.scene.collection.objects.link(part)
    part.matrix_world = ob.matrix_world.copy()
    keep = set(picked)
    for target, drop_picked in ((part.data, False), (ob.data, True)):
        t = bmesh.new()
        t.from_mesh(target)
        t.faces.ensure_lookup_table()
        gone = [f for f in t.faces if (f.index in keep) == drop_picked]
        bmesh.ops.delete(t, geom=gone, context='FACES')
        bmesh.ops.delete(t, geom=[v for v in t.verts if not v.link_faces], context='VERTS')
        t.to_mesh(target)
        t.free()
        target.update()
    print(f'{node}: {len(picked)} faces from {group}')
    return part


def drop_unused_maps():
    """Clear coat and emission are not read by the games' materials: unlinked, their images not exported."""
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type != 'BSDF_PRINCIPLED':
                continue
            for sock in n.inputs:
                if sock.name.startswith('Coat') or sock.name.startswith('Emission') or sock.name.startswith('Specular'):
                    for link in list(sock.links):
                        mat.node_tree.links.remove(link)


def decimate(ob, triangles):
    """Collapse to the budget without the vehicles' mirror symmetry (a gun's two sides differ)."""
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris <= triangles:
        return
    mod = ob.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = triangles / tris
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f'{ob.name}: {tris} → {sum(len(p.vertices) - 2 for p in ob.data.polygons)} triangles')


def top_profile(obs, step=0.005, half_width=0.004):
    """The highest point within `half_width` of the centre line every `step` along the gun: [z, y] pairs."""
    tops = {}
    for o in obs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            if abs(p.x) > half_width:
                continue
            k = round(p.z / step)
            tops[k] = max(tops.get(k, -1e9), p.y)
    return [[round(k * step, 4), round(y, 4)] for k, y in sorted(tops.items())]


def main():
    a = args_of()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    pv.import_model(a.model)
    names_by_src = group_names()
    pv.flatten_hierarchy()
    words = [w.strip().lower() for w in a.drop.split(',') if w.strip()]
    for o in list(pv.meshes()):
        mats = [m for m in o.data.materials if m]
        hit = any(w in o.get('path', '').lower() or any(w in m.name.lower() for m in mats) for w in words)
        if hit or not mats:
            print(f'dropped {o.get("path", o.name)}' + ('' if mats else ' (no material: a helper)'))
            bpy.data.objects.remove(o)
    pv.orient_and_scale(a.forward, a.up, a.length)
    obs = pv.meshes()
    names = next((n for src, n in names_by_src.items() if n), [])
    specs = [tuple(t.strip() for t in s.split('=')) for s in a.parts.split(',') if s.strip()]
    # Parts that are objects of their own (unrigged models): gathered by words in their names before the
    # rest is joined into the body; the others are vertex groups, split off the body after.
    parts = []
    for spec in a.part:
        box, _, word = spec.partition('@')
        skip = {o.name for o in pv.meshes() if word and word.lower() not in o.get('path', o.name).lower()}
        parts += pv.gather_parts([box], skip | {p.name for p in parts})
    obs = [o for o in pv.meshes() if o not in parts]
    by_group = []
    for node, key in specs:
        words = [w.lower() for w in key.split('|')]
        hits = [o for o in obs if any(w in o.get('path', o.name).lower() for w in words)]
        if hits and key not in names:
            print(f'{node}: ' + ', '.join(o.get('path', o.name).split('/')[-1] for o in hits))
            obs = [o for o in obs if o not in hits]
            parts.append(pv.join(hits, node))
        else:
            by_group.append((node, key))
    body = pv.join(obs, 'body')
    # The joined object keeps the first object's group names; with one rigged mesh that is the rig's.
    while len(body.vertex_groups) < len(names):
        body.vertex_groups.new(name=names[len(body.vertex_groups)])
    for node, group in by_group:
        p = split_by_group(body, names, node, group)
        if p is not None:
            parts.append(p)
    every = [body] + parts
    # Centred across on the body, which is symmetric; the charging handle sticking out on one side moved
    # the whole model's box (and the sight line then missed the centre-line profile).
    blo, bhi = pv.bounds([body])
    dx = -(blo.x + bhi.x) / 2
    for o in every:
        o.data.transform(Matrix.Translation((dx, 0, 0)))
    for o in every:
        o.vertex_groups.clear()
        for m in list(o.modifiers):
            o.modifiers.remove(m)
    if a.triangles:
        decimate(body, a.triangles)
    if a.part_triangles:
        for p in parts:
            decimate(p, a.part_triangles)
    drop_unused_maps()
    pv.downscale_textures(a.tex)
    pv.ray_ao(every, reach=a.ao_reach)
    lo, hi = pv.bounds(every)
    info = {
        'source': os.path.basename(a.model),
        'size': [round(v, 4) for v in hi - lo],
        'triangles': sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in every),
        'parts': {o.name: {'min': [round(v, 4) for v in pv.bounds([o])[0]], 'max': [round(v, 4) for v in pv.bounds([o])[1]]} for o in every},
        'top': top_profile([body]),
    }
    pv.export(a.out + '.glb', every)
    with open(a.out + '.json', 'w') as f:
        json.dump(info, f, indent=1)
    print(json.dumps({k: v for k, v in info.items() if k != 'top'}, indent=1))


if __name__ == '__main__':
    main()
