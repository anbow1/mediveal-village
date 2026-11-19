"""Measures a prepared car's paint for the games' recolouring and writes it into its .json.

    python measure_paint.py shared/vehicles hatchback sedan ...

(needs numpy and Pillow). The games repaint a car per instance by swapping the texels of the model's own
paint (vehicleModels.ts in Field Line, sharedCars.ts in Paris): those within `paintTolerance` of
`paint` in chromaticity. A texture's baked shading shifts a saturated paint's hue (a yellow toward orange
in shade), so `paint` is the median of the texels near the current guess, and `paintTolerance` the 90th
percentile of their distance from it (kept within 0.05-0.12, so lamps and trim stay out).
"""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722])


def body_texture(glb_path):
    data = open(glb_path, 'rb').read()
    jlen = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    binary = data[20 + jlen + 8:]
    mat = next(m for m in gltf['materials'] if m['name'].lower().startswith('body'))
    tex = gltf['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]
    view = gltf['bufferViews'][gltf['images'][tex['source']]['bufferView']]
    start = view.get('byteOffset', 0)
    img = Image.open(io.BytesIO(binary[start:start + view['byteLength']])).convert('RGB')
    srgb = np.asarray(img).astype(np.float32).reshape(-1, 3) / 255
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def measure(root, car):
    path = f'{root}/{car}/{car}.json'
    info = json.load(open(path))
    if not info.get('paint'):
        print(f'{car}: no paint to measure (too dark to recolour)')
        return
    lin = body_texture(f'{root}/{car}/{car}_lod0.glb')
    chroma = lin / np.maximum(lin.sum(-1, keepdims=True), 1e-4)
    guess = np.array(info['paint'])
    near = (np.linalg.norm(chroma - guess / guess.sum(), axis=-1) < 0.16) & (lin @ LUMA > 0.01)
    paint = np.median(lin[near], 0)
    spread = np.linalg.norm(chroma[near] - paint / paint.sum(), axis=-1)
    info['paint'] = [round(float(v), 4) for v in paint]
    info['paintTolerance'] = round(min(0.12, max(0.05, float(np.percentile(spread, 90)))), 3)
    with open(path, 'w') as f:
        json.dump(info, f, indent=1)
    print(f'{car}: paint {info["paint"]}, tolerance {info["paintTolerance"]}')


if __name__ == '__main__':
    for name in sys.argv[2:]:
        measure(sys.argv[1], name)
