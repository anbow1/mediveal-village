"""MakeHuman 1.x data (CC0) read without MakeHuman: the base mesh's groups, the
macro targets, the default skeleton's joints and its skin weights.

Units: MakeHuman works in decimetres; everything here returns metres.
"""
import json
import os
from collections import defaultdict

DM = 0.1


class BaseMesh:
    def __init__(self, path):
        self.verts = []
        self.uvs = []
        # group name -> list of faces; a face is a list of (vertex index, uv index)
        self.groups = defaultdict(list)
        group = None
        with open(path) as f:
            for line in f:
                if line.startswith('v '):
                    _, x, y, z = line.split()[:4]
                    self.verts.append((float(x) * DM, float(y) * DM, float(z) * DM))
                elif line.startswith('vt '):
                    _, u, v = line.split()[:3]
                    self.uvs.append((float(u), float(v)))
                elif line.startswith('g '):
                    group = line.split(None, 1)[1].strip()
                elif line.startswith('f '):
                    face = []
                    for tok in line.split()[1:]:
                        parts = tok.split('/')
                        face.append((int(parts[0]) - 1, int(parts[1]) - 1 if len(parts) > 1 and parts[1] else -1))
                    self.groups[group].append(face)

    def group_vertices(self, name):
        return sorted({v for face in self.groups[name] for v, _ in face})


def read_target(path):
    """A target: per-vertex offsets (metres) as {index: (dx, dy, dz)}."""
    out = {}
    with open(path) as f:
        for line in f:
            if not line.strip() or line.startswith('#'):
                continue
            i, x, y, z = line.split()
            out[int(i)] = (float(x) * DM, float(y) * DM, float(z) * DM)
    return out


def apply_targets(verts, weighted):
    """verts + sum of weight * target, for [(target dict, weight)]."""
    out = [list(v) for v in verts]
    for target, w in weighted:
        if w == 0:
            continue
        for i, (x, y, z) in target.items():
            o = out[i]
            o[0] += w * x
            o[1] += w * y
            o[2] += w * z
    return out


class Skeleton:
    def __init__(self, skel_path, weights_path):
        d = json.load(open(skel_path))
        self.bones = d['bones']
        self.joint_verts = d['joints']
        w = json.load(open(weights_path))
        self.weights = w['weights']  # bone -> [[vertex, weight], ...]

    def joint(self, verts, name):
        idx = self.joint_verts[name]
        n = len(idx)
        return tuple(sum(verts[i][k] for i in idx) / n for k in range(3))

    def head(self, verts, bone):
        return self.joint(verts, self.bones[bone]['head'])

    def tail(self, verts, bone):
        return self.joint(verts, self.bones[bone]['tail'])


def data_paths(mh_data, mh_files):
    return {
        'obj': os.path.join(mh_files, 'base.obj'),
        'skel': os.path.join(mh_files, 'default.mhskel'),
        'weights': os.path.join(mh_files, 'default_weights.mhw'),
        'macro': os.path.join(mh_data, 'targets', 'macrodetails'),
    }
