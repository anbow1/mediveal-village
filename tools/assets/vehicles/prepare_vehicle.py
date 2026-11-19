"""Prepares a downloaded vehicle (Sketchfab CC-BY / CC0, Poly Haven, BlenderKit free) for the games.

    blender -b --python prepare_vehicle.py -- model.glb --out out/hatchback --length 4.05
        [--forward -y] [--up z] [--wheels "wheel,tire,tyre,rim"] [--lights "light,lamp"]
        [--lod 60000,15000,3000] [--tex 2048] [--preview] [--cpu]

What it does, in the game's convention (metres, Y up, the front toward -Z, the
origin on the ground under the middle of the wheelbase):
  1. imports .glb/.gltf/.fbx/.obj/.blend, applies every transform and modifier,
     and turns the model so its `--forward` axis becomes the game's -Z;
  2. scales it to `--length` (the real bumper-to-bumper length: sold models are
     often in centimetres or at a toy's scale);
  3. finds the wheels (objects or loose parts whose names contain a `--wheels`
     word; failing that, the four roughly round loose parts lowest at each
     corner), recentres each on its axle so the game can spin it, and names
     them wheel_FL/FR/RL/RR;
  4. gathers the lights (names or materials with a `--lights` word, or emissive
     materials) into `lights_head` / `lights_rear` by their end of the car, so the
     game can drive brake lights and headlights;
  5. merges the rest into `body` (one object per material) and decimates the body
     to each `--lod` triangle budget (collapse, symmetric about X), wheels to a
     sixth of it;
  6. bakes ambient occlusion with Cycles (OptiX on RTX) into a vertex colour
     `ao` (under the sills, inside the arches, the cabin's interior);
  7. downscales the textures to `--tex` and writes <out>_lod<i>.glb (Draco) and
     <out>.json (dimensions, wheel centres and radius, licence note to fill in).
--preview renders <out>_preview.png. Keep the source page's author and licence in the
.json: CC-BY needs the credit in the game.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

AXES = {'x': Vector((1, 0, 0)), '-x': Vector((-1, 0, 0)), 'y': Vector((0, 1, 0)), '-y': Vector((0, -1, 0)),
        'z': Vector((0, 0, 1)), '-z': Vector((0, 0, -1))}


def args_of():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--out', required=True)
    ap.add_argument('--length', type=float, required=True, help='real length, m')
    ap.add_argument('--forward', default='-y', help="the model's front axis in Blender (after import)")
    ap.add_argument('--up', default='z')
    ap.add_argument('--wheels', default='wheel,tire,tyre,rim,rad,reifen')
    ap.add_argument('--lights', default='light,lamp,headl,taill,brake,indicator,blinker')
    ap.add_argument('--lod', default='60000,15000,3000')
    ap.add_argument('--tex', type=int, default=2048)
    ap.add_argument('--tex-far', type=int, default=None,
                    help='texture size of lod1 (each farther level halves it); default half of --tex')
    ap.add_argument('--part', action='append', default=[],
                    help='name:x0,y0,z0,x1,y1,z1[,min] — loose parts wholly inside the box (game frame, m) whose '
                         'largest extent is at least min, as their own node (a bonnet, a door) for the game to move')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--cpu', action='store_true')
    # A pack of several cars in one file: the body to keep (a word or words in its object names); the
    # wheels kept are those standing under it.
    ap.add_argument('--pick', default='')
    return ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def import_model(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == '.blend':
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = src.objects
        for ob in dst.objects:
            if ob is not None:
                bpy.context.scene.collection.objects.link(ob)
    else:
        raise SystemExit(f'unsupported format {ext}')


def pick_one(name):
    """Keep one vehicle of a pack: the objects whose names carry `name`, and the parts (wheels) whose
    centres stand inside that body's footprint; the rest of the pack is removed."""
    words = name.lower()
    body = [o for o in meshes() if words in o.name.lower() or words in o.get('src', '').lower()]
    if not body:
        raise SystemExit(f'--pick: no object named like {name!r}')
    lo, hi = bounds(body)
    keep = set(o.name for o in body)
    for o in meshes():
        if o.name in keep:
            continue
        plo, phi = bounds([o])
        c = (plo + phi) / 2
        # Inside the body's footprint (a wheel's centre is under its arch), whatever the pack's up axis.
        inside = sum(lo[i] - 0.02 * (hi[i] - lo[i]) <= c[i] <= hi[i] + 0.02 * (hi[i] - lo[i]) for i in range(3))
        if inside == 3:
            keep.add(o.name)
    for o in list(meshes()):
        if o.name not in keep:
            bpy.data.objects.remove(o)
    print(f'--pick {name!r}: kept {len(keep)} objects')


def align_wheelbase(up, wheel_words):
    """Packs set their cars down at any heading. Turn the vehicle about the up axis so the line through its
    wheels' centres (the wheelbase, longer than the track) lies along Blender's Y; --forward then says
    which end is the front."""
    if up != 'z':
        return
    wheels = [o for o in meshes() if has_word(o.name, wheel_words) or has_word(o.get('src', ''), wheel_words)]
    if len(wheels) < 4:
        print('align: fewer than four wheels found; heading left as imported')
        return
    cs = [(lambda lo, hi: ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2))(*bounds([w])) for w in wheels]
    mx = sum(c[0] for c in cs) / len(cs)
    my = sum(c[1] for c in cs) / len(cs)
    sxx = sum((c[0] - mx) ** 2 for c in cs)
    syy = sum((c[1] - my) ** 2 for c in cs)
    sxy = sum((c[0] - mx) * (c[1] - my) for c in cs)
    # Principal axis of the four centres: the wheelbase.
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
    turn = math.pi / 2 - angle
    rot = Matrix.Rotation(turn, 4, 'Z')
    for ob in meshes():
        ob.data.transform(rot)
    print(f'align: turned {math.degrees(turn):.1f}° to put the wheelbase along Y')


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def flatten_hierarchy():
    """Every mesh with its modifiers and transforms applied, unparented; empties, cameras, lights removed."""
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in meshes():
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(ob.matrix_world)
        flat = bpy.data.objects.new(ob.name, me)
        bpy.context.scene.collection.objects.link(flat)
        flat['src'] = ob.name
        # The names of its parents too (a mesh node is often an anonymous child of the named part).
        chain, up = [], ob
        while up is not None:
            chain.append(up.name)
            up = up.parent
        flat['path'] = '/'.join(reversed(chain))
    for ob in list(bpy.context.scene.objects):
        if 'src' not in ob:
            bpy.data.objects.remove(ob)


def orient_and_scale(forward, up, length):
    """Model's forward → game -Z, up → +Y; scaled to the length; on the ground, centred."""
    f, u = AXES[forward], AXES[up]
    r = f.cross(u)
    # Rows: game X = the car's right, game Y = up, game Z = back.
    rot = Matrix((r, u, -f)).to_4x4()
    obs = meshes()
    for ob in obs:
        ob.data.transform(rot)
    lo, hi = bounds(obs)
    s = length / max(1e-6, hi.z - lo.z)
    centre = Vector(((lo.x + hi.x) / 2, lo.y, (lo.z + hi.z) / 2))
    for ob in obs:
        ob.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-centre))
    print(f'scale ×{s:.4f} (model was {hi.z - lo.z:.3f} units long)')


def outward_normals(parts, samples=48, reach=4.0):
    """Turns every loose piece whose faces face into the model, as some models ripped from other engines
    arrive (winding the other way round): their sun lighting falls on the wrong side and the occlusion
    bake, which looks along the normal, comes out black. A piece's faces vote by casting a ray each way
    against the whole model: the outer side of armour sees the open sky more often than its inner side.
    Returns how many pieces were turned."""
    import bmesh
    import random
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    for p in parts:
        bm.from_mesh(p.data)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    rng = random.Random(7)
    turned = 0
    for p in parts:
        me = p.data
        polys = list(me.polygons)
        if not polys:
            continue
        votes = 0
        for f in rng.sample(polys, min(samples, len(polys))):
            c, n = f.center, f.normal
            out_open = tree.ray_cast(c + n * 0.002, n, reach)[0] is None
            in_open = tree.ray_cast(c - n * 0.002, -n, reach)[0] is None
            votes += int(out_open) - int(in_open)
        if votes >= 0:
            continue
        # Keep the model's smoothing: each corner's normal, negated, follows its vertex through the flip.
        old = {}
        corner = list(me.corner_normals) if hasattr(me, 'corner_normals') else []
        for f in polys:
            for li in f.loop_indices:
                v = me.loops[li].vertex_index
                old[(f.index, v)] = (-corner[li].vector) if corner else -f.normal
        me.flip_normals()
        custom = [None] * len(me.loops)
        for f in me.polygons:
            for li in f.loop_indices:
                custom[li] = old[(f.index, me.loops[li].vertex_index)]
        me.normals_split_custom_set(custom)
        turned += 1
    return turned


def bounds(obs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for ob in obs:
        for v in ob.data.vertices:
            lo = Vector(map(min, lo, v.co))
            hi = Vector(map(max, hi, v.co))
    return lo, hi


def has_word(name, words):
    n = name.lower()
    return any(w and w in n for w in words)


def split_loose(ob):
    """One object per loose part (wheels sold welded into one mesh)."""
    # Separating scrambles custom normals (a quarter of a tank's corners came out facing into it, the
    # sun then lighting the wrong side): carry them through as a plain corner attribute and set them again.
    me = ob.data
    keep = me.has_custom_normals
    if keep:
        attr = me.attributes.new('_nrm', 'FLOAT_VECTOR', 'CORNER')
        for i, n in enumerate(me.corner_normals):
            attr.data[i].vector = n.vector
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.mesh.separate(type='LOOSE')
    parts = [o for o in bpy.context.selected_objects]
    if keep:
        for o in parts:
            m = o.data
            a = m.attributes.get('_nrm')
            if a is None:
                continue
            m.normals_split_custom_set([d.vector.copy() for d in a.data])
            m.attributes.remove(m.attributes['_nrm'])
    return parts


def find_wheels(words):
    """The four wheels as groups of objects, keyed FL/FR/RL/RR (game frame: right = +X, front = -Z)."""
    obs = meshes()
    named = [o for o in obs if has_word(o.name, words) or has_word(o.get('src', ''), words)
             or any(has_word(m.name, words) for m in o.data.materials if m)]
    lo, hi = bounds(obs)
    if not named:
        # No names: loose parts that are round in side view (y and z extents alike), low, and near the corners.
        parts = []
        for ob in obs:
            parts += split_loose(ob)
        for p in parts:
            plo, phi = bounds([p])
            d = phi - plo
            if d.y > 0.25 and abs(d.y - d.z) < 0.15 * d.y and plo.y < 0.12 and d.x < 0.45:
                named.append(p)
    wheels = {'FL': [], 'FR': [], 'RL': [], 'RR': []}
    mid_z = (lo.z + hi.z) / 2
    for o in named:
        plo, phi = bounds([o])
        c = (plo + phi) / 2
        key = ('F' if c.z < mid_z else 'R') + ('R' if c.x > 0 else 'L')
        wheels[key].append(o)
    return wheels


def join(obs, name):
    if not obs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


def recentre(ob):
    """The wheel's origin on its axle (the middle of its bounds), so the game spins it about its own centre."""
    lo, hi = bounds([ob])
    c = (lo + hi) / 2
    ob.data.transform(Matrix.Translation(-c))
    ob.location = c
    return c, (hi.y - lo.y) / 2


def is_light(ob, words):
    if has_word(ob.name, words) or has_word(ob.get('src', ''), words):
        return True
    for m in ob.data.materials:
        if not m:
            continue
        if has_word(m.name, words):
            return True
        if m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    e = n.inputs.get('Emission Strength')
                    col = n.inputs.get('Emission Color') or n.inputs.get('Emission')
                    if e and col and e.default_value > 0 and max(col.default_value[:3]) > 0.05 and not col.is_linked:
                        return True
    return False


def gather_parts(specs, skip):
    """Each `--part`: the loose pieces wholly inside its box and at least `min` long, joined into one object of
    that name, left in the body's frame (the game puts the hinge where it belongs)."""
    out = []
    for spec in specs:
        name, box = spec.split(':', 1)
        v = [float(t) for t in box.split(',')]
        lo, hi, least = Vector(v[0:3]), Vector(v[3:6]), v[6] if len(v) > 6 else 0.0
        pieces = []
        for o in [o for o in meshes() if o.name not in skip and o not in out]:
            olo, ohi = bounds([o])
            if any(ohi[i] < lo[i] or olo[i] > hi[i] for i in range(3)):
                continue
            for p in split_loose(o):
                plo, phi = bounds([p])
                if all(plo[i] >= lo[i] and phi[i] <= hi[i] for i in range(3)) and max(phi - plo) >= least:
                    pieces.append(p)
        ob = join(pieces, name)
        if ob is None:
            print(f'WARNING: nothing inside the box of --part {name}')
            continue
        print(f'{name}: {len(pieces)} pieces')
        out.append(ob)
    return out


def decimate(ob, triangles):
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris <= triangles:
        return
    mod = ob.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = triangles / tris
    mod.use_symmetry = True
    mod.symmetry_axis = 'X'
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def use_gpu(cpu_only):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    if cpu_only:
        return 'CPU'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for backend in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        if any(d.type == backend for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == backend
            scene.cycles.device = 'GPU'
            return backend
    return 'CPU'


def bake_ao(obs):
    """AO into a vertex colour `ao` of every object, the whole car present (the arch darkens the tyre's top)."""
    scene = bpy.context.scene
    scene.cycles.samples = 128
    scene.world = scene.world or bpy.data.worlds.new('w')
    scene.world.light_settings.distance = 0.6
    scene.render.bake.target = 'VERTEX_COLORS'
    for ob in obs:
        me = ob.data
        if 'ao' not in me.color_attributes:
            me.color_attributes.new('ao', 'BYTE_COLOR', 'POINT')
        me.color_attributes.active_color = me.color_attributes['ao']
        for o in scene.objects:
            o.select_set(o == ob)
        bpy.context.view_layer.objects.active = ob
        if not me.materials:
            me.materials.append(bpy.data.materials.new('plain'))
        bpy.ops.object.bake(type='AO')


def ray_ao(obs, rays=32, reach=0.6):
    """AO per face corner, cast in Python, for models built of interpenetrating pieces (armour plates
    through a hull, bolted-on boxes): Cycles' vertex bake looks from the vertex itself, which there lies
    inside the neighbouring piece, and a low-poly face then goes black from corner to corner. Here each
    corner looks from a little inside its own face and above it, and a ray that meets the back of a face
    (it started inside another piece) counts as open. Written into the same `ao` colour as bake_ao."""
    import math
    import random
    import bmesh
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    for o in obs:
        t = bmesh.new()
        t.from_mesh(o.data)
        t.transform(o.matrix_world)
        me = bpy.data.meshes.new('ao_tmp')
        t.to_mesh(me)
        t.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    rng = random.Random(3)
    # Cosine-weighted directions about +Z (a Fibonacci spiral on the disc, lifted to the hemisphere).
    golden = math.pi * (3 - math.sqrt(5))
    base = []
    for i in range(rays):
        r = math.sqrt((i + 0.5) / rays)
        a = i * golden
        base.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - r * r)))))
    for o in obs:
        me = o.data
        if 'ao' in me.color_attributes:
            me.color_attributes.remove(me.color_attributes['ao'])
        attr = me.color_attributes.new('ao', 'BYTE_COLOR', 'CORNER')
        mw = o.matrix_world
        rot = mw.to_3x3().inverted().transposed()
        for f in me.polygons:
            centre = mw @ f.center
            n = (rot @ f.normal).normalized()
            t = n.orthogonal().normalized()
            b = n.cross(t)
            for li in f.loop_indices:
                p = mw @ me.vertices[me.loops[li].vertex_index].co
                origin = p + (centre - p) * 0.08 + n * 0.01
                spin = rng.random() * 2 * math.pi
                cs, sn = math.cos(spin), math.sin(spin)
                hit = 0
                for d in base:
                    x = d.x * cs - d.y * sn
                    y = d.x * sn + d.y * cs
                    w = t * x + b * y + n * d.z
                    loc, hn, _, _ = tree.ray_cast(origin, w, reach)
                    if loc is not None and hn.dot(w) < 0:
                        hit += 1
                v = 1.0 - hit / rays
                attr.data[li].color = (v, v, v, 1.0)


def downscale_textures(size):
    for img in bpy.data.images:
        if img.source != 'FILE':
            continue
        # An image no node has drawn yet is not loaded (has_data false): load it, or a big texture would
        # be exported at its full size, its file's bytes passed through.
        if not img.has_data:
            img.update()
        if not img.has_data:
            continue
        w, h = img.size
        if max(w, h) > size:
            s = size / max(w, h)
            img.scale(max(1, round(w * s)), max(1, round(h * s)))


def export(path, obs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    # The game is Y up already: no axis conversion (export_yup would turn it again).
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=False,
                              export_apply=True, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=6, export_attributes=True,
                              export_image_format='JPEG', export_image_quality=88)


def preview(obs, path):
    scene = bpy.context.scene
    lo, hi = bounds(obs)
    pivot = bpy.data.objects.new('pivot', None)
    scene.collection.objects.link(pivot)
    for o in obs:
        o.parent = pivot
    pivot.rotation_euler = (math.radians(90), 0, 0)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.location = (4.5, 5.5, 2.2)
    aim = bpy.data.objects.new('aim', None)
    aim.location = (0, 0, (hi.y - lo.y) * 0.45)
    scene.collection.objects.link(aim)
    t = cam.constraints.new('TRACK_TO')
    t.target = aim
    t.track_axis = 'TRACK_NEGATIVE_Z'
    t.up_axis = 'UP_Y'
    cam.data.lens = 50
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(130))
    scene.collection.objects.link(sun)
    scene.world.color = (0.45, 0.5, 0.55)
    scene.render.resolution_x, scene.render.resolution_y = 1200, 700
    scene.cycles.samples = 96
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in obs:
        o.parent = None
    for o in (cam, sun, aim, pivot):
        bpy.data.objects.remove(o)


def main():
    a = args_of()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    print('Cycles device:', use_gpu(a.cpu))
    import_model(a.model)
    flatten_hierarchy()
    if a.pick:
        pick_one(a.pick)
        align_wheelbase(a.up, [w.strip().lower() for w in a.wheels.split(',')])
    orient_and_scale(a.forward, a.up, a.length)
    wheel_words = [w.strip().lower() for w in a.wheels.split(',')]
    light_words = [w.strip().lower() for w in a.lights.split(',')]
    groups = find_wheels(wheel_words)
    info = {'source': os.path.basename(a.model), 'licence': 'FILL IN: author, URL, CC-BY 4.0 / CC0', 'wheels': {}}
    wheels = []
    for key, parts in groups.items():
        ob = join(parts, f'wheel_{key}')
        if ob is None:
            print(f'WARNING: no wheel found at {key}; pass --wheels with the words its objects carry')
            continue
        c, r = recentre(ob)
        info['wheels'][key] = {'centre': [round(c.x, 4), round(c.y, 4), round(c.z, 4)], 'radius': round(r, 4)}
        wheels.append(ob)
    wheel_names = {w.name for w in wheels}
    moving = gather_parts(a.part, wheel_names)
    rest = [o for o in meshes() if o.name not in wheel_names and o not in moving]
    lo, hi = bounds(rest)
    mid_z = (lo.z + hi.z) / 2
    # One object can hold every lamp of the car (head and tail lights in one mesh): split it into its
    # pieces, so each lamp goes to the front or the back by where it is.
    lights = []
    for o in [o for o in rest if is_light(o, light_words)]:
        lights += split_loose(o)
    # Both sides sorted before either is joined: joining removes the pieces it merges.
    front_l = [o for o in lights if bounds([o])[0].z < mid_z]
    back_l = [o for o in lights if bounds([o])[0].z >= mid_z]
    head = join(front_l, 'lights_head')
    rear = join(back_l, 'lights_rear')
    body = join([o for o in rest if o not in lights], 'body')
    info['size'] = [round(hi.x - lo.x, 3), round(hi.y - lo.y, 3), round(hi.z - lo.z, 3)]
    if wheels:
        fz = [w['centre'][2] for k, w in info['wheels'].items() if k[0] == 'F']
        rz = [w['centre'][2] for k, w in info['wheels'].items() if k[0] == 'R']
        if fz and rz:
            info['wheelbase'] = round(sum(rz) / len(rz) - sum(fz) / len(fz), 3)
    downscale_textures(a.tex)
    parts = [o for o in (body, head, rear) if o] + wheels + moving
    budgets = [int(x) for x in a.lod.split(',')]
    for i, budget in enumerate(budgets):
        copies = []
        for o in parts:
            cp = o.copy()
            cp.data = o.data.copy()
            bpy.context.scene.collection.objects.link(cp)
            share = budget if o is body else budget // 6 if o in wheels else budget // 10
            decimate(cp, share)
            copies.append(cp)
        for o in parts:
            o.hide_render = True
        bake_ao(copies)
        # The exported nodes carry the clean names the game looks up (body, wheel_FL, lights_rear…).
        names = [o.name for o in parts]
        for o in parts:
            o.name = o.name + '_src'
        for cp, name in zip(copies, names):
            cp.name = name
        export(f'{a.out}_lod{i}.glb', copies)
        # Each farther level is seen at half the size: its textures halve too (the images are shared, and
        # the levels export near to far). At full size every level carried the near one's textures.
        far = a.tex_far if a.tex_far else a.tex >> 1
        downscale_textures(max(128, far >> i))
        tris = sum(sum(len(p.vertices) - 2 for p in c.data.polygons) for c in copies)
        print(f'lod{i}: {tris} triangles → {a.out}_lod{i}.glb')
        if a.preview and i == 0:
            preview(copies, f'{a.out}_preview.png')
        for cp in copies:
            bpy.data.objects.remove(cp)
        for o, name in zip(parts, names):
            o.name = name
            o.hide_render = False
    with open(a.out + '.json', 'w') as f:
        json.dump(info, f, indent=1)
    print(json.dumps(info, indent=1))


if __name__ == '__main__':
    main()
