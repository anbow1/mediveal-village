"""Turns a downloaded lorry model into a piece of the Tanks game's scenery: one `body` node, wheels and all
(the game does not drive it; any number of axles will do).

    blender -b --python prepare_truck.py -- model.gltf --out out/truck_a --length 6.9 --forward -y --preview

(or with the `bpy` module: python -I prepare_truck.py -- ...). As prepare_vehicle.py: metres, Y up, front
toward -Z, standing on y = 0, centred; loose pieces faced outward; decimated to the budget; occlusion cast
into the second colour set (ray_ao, as the tanks'); textures downscaled. Writes <out>.glb and <out>.json
(size, the box, the triangles, the mean albedo of its textures for the game's lift). Paint real insignia out
of the textures first (scrub_marks.py). --preview renders it from the side and above to check the heading.
"""
import argparse
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prepare_vehicle as pv  # noqa: E402
import prepare_tank as pt  # noqa: E402


def args_of():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--out', required=True)
    ap.add_argument('--length', type=float, required=True, help='real length over all, m')
    ap.add_argument('--forward', default='-y')
    ap.add_argument('--up', default='z')
    ap.add_argument('--triangles', type=int, default=24000)
    ap.add_argument('--tex', type=int, default=1024)
    ap.add_argument('--drop', default='', help='words in the names of parts (or their materials) to leave out')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--cpu', action='store_true')
    return ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def drop_unused_maps(ob):
    """The game reads a lorry's base colour (with its alpha) and normal map only: the emission and
    metal/roughness images and a glass material's picture would only weigh down the file."""
    for mat in ob.data.materials:
        if mat is None or not mat.use_nodes:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None:
            continue
        names = ['Emission Color', 'Metallic', 'Roughness'] + (['Base Color', 'Alpha'] if 'glass' in mat.name.lower() else [])
        for name in names:
            sock = bsdf.inputs.get(name)
            if sock is not None:
                for link in list(sock.links):
                    mat.node_tree.links.remove(link)


def main():
    a = args_of()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    pv.import_model(a.model)
    pv.flatten_hierarchy()
    words = [w.strip().lower() for w in a.drop.split(',') if w.strip()]
    for o in [o for o in pv.meshes() if any(w in o.get('path', '').lower() or any(m and w in m.name.lower() for m in o.data.materials) for w in words)]:
        print(f'dropped {o.get("path", o.name)}')
        bpy.data.objects.remove(o)
    pv.orient_and_scale(a.forward, a.up, a.length)
    parts = []
    for o in list(pv.meshes()):
        parts += pv.split_loose(o)
    lo, hi = pv.bounds(parts)
    size = hi - lo
    print(f'{len(parts)} loose pieces; size {size.x:.2f} × {size.y:.2f} × {size.z:.2f} m')
    print(f'{pv.outward_normals(parts)} pieces faced inward, turned')
    body = pv.join(parts, 'body')
    pv.decimate(body, a.triangles)
    drop_unused_maps(body)
    pv.downscale_textures(a.tex)
    albedo = pt.mean_albedo([body])
    pv.ray_ao([body])
    if a.preview:
        body.name = 'hull'
        pt.preview([body], a.out + '_preview.png')
        body.name = 'body'
    pv.export(a.out + '.glb', [body])
    info = {
        'source': os.path.basename(a.model),
        'size': [round(size.x, 3), round(size.y, 3), round(size.z, 3)],
        'box': {'min': [round(v, 3) for v in lo], 'max': [round(v, 3) for v in hi]},
        'triangles': sum(len(f.vertices) - 2 for f in body.data.polygons),
        'albedo': round(albedo, 4),
    }
    with open(a.out + '.json', 'w') as f:
        json.dump(info, f, indent=1)
    print(json.dumps(info, indent=1))


if __name__ == '__main__':
    main()
