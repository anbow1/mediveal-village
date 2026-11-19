"""Builds the Paris crowd from MPFB (MakeHuman for Blender) with real clothes, hair and skins.

Run on a machine with Blender 4.2+ and the MPFB extension installed, with the
MakeHuman system assets pack loaded in MPFB (Apply assets → Load pack):

    blender -b --python build_people_mpfb.py -- --out <dir> [--preview] [--only a,b] [--cpu]
    blender -b --python build_people_mpfb.py -- --list      # what clothes, hair and skins are installed
    blender -b --python build_people_mpfb.py -- --cast fieldline --out <dir> --preview   # the soldiers (or: lagoon)

For each character in CAST:
  1. MPFB's human with the character's macros (gender, age, ethnicity, muscle,
     weight, height) and MakeHuman's default rig (163 bones);
  2. a skin, eyes, eyebrows, eyelashes, hair, clothes and shoes picked by keyword
     from the installed library (the first pattern that matches wins, so the
     cast still builds with whatever pack is installed), each fitted by MPFB
     and hiding the body it covers;
  3. every piece evaluated at rest (shape keys, masks), turned into the game's
     frame (Y up, facing -Z) and decimated to its share of the budget;
  4. ambient occlusion baked by Cycles (OptiX on an RTX card) into the vertices,
     with the whole character present so a collar darkens the neck under it;
  5. written as <name>_<lod>.bin + .json (format 2: positions, normals, uvs,
     4 bones and weights of the game's 21 (RIG_BONES), AO; one index range per material)
     and the textures, downscaled, into <out>/tex (shared between characters).
--preview renders each character with its textures into <out>/preview/<name>.png.
"""
import argparse
import importlib
import json
import math
import os
import re
import struct
import sys

import bpy
from mathutils import Matrix

# The game's skeleton for these characters (life/rig.ts reads the names from the .json): MakeHuman's 163
# bones folded into 21, every one of which the motion capture (CMU) drives: the lumbar spine and the chest
# apart, the neck, the collar bones, the toes. L = the actor's left.
RIG_BONES = ['pelvis', 'spine', 'chest', 'neck', 'head',
             'clavicle.L', 'upperArm.L', 'forearm.L', 'hand.L', 'clavicle.R', 'upperArm.R', 'forearm.R', 'hand.R',
             'thigh.L', 'shin.L', 'foot.L', 'toe.L', 'thigh.R', 'shin.R', 'foot.R', 'toe.R']


def rig_bone(mh):
    """The game bone a MakeHuman (default rig) bone folds into."""
    side = 'L' if mh.endswith('.L') else 'R' if mh.endswith('.R') else ''
    base = mh.split('.')[0]
    if base in ('root', 'pelvis'):
        return 'pelvis'
    if base in ('spine05', 'spine04'):
        return 'spine'
    if base in ('spine03', 'spine02', 'spine01', 'breast'):
        return 'chest'
    if base.startswith('neck'):
        return 'neck'
    if base == 'clavicle' or base.startswith('shoulder'):
        return 'clavicle.' + side
    if base.startswith('upperarm'):
        return 'upperArm.' + side
    if base.startswith('lowerarm'):
        return 'forearm.' + side
    if base == 'wrist' or base.startswith(('metacarpal', 'finger')):
        return 'hand.' + side
    if base.startswith('upperleg'):
        return 'thigh.' + side
    if base.startswith('lowerleg'):
        return 'shin.' + side
    if base == 'foot':
        return 'foot.' + side
    if base.startswith('toe'):
        return 'toe.' + side
    # The face's and the eyes' bones, the jaw, the tongue: all ride on the head.
    return 'head'


# Patterns are matched against an asset's file name (lower case): every word of a pattern must occur in it.
# A man's patterns never pick a "female_" asset unless they say "female".
# Assets never picked, even as a fallback: shirts carrying a logo or a printed title (no marks in the games).
EXCLUDE = {'male_casualsuit02.mhclo', 'elvs_male_logo_tshirt1.mhclo', 'punkduck_deathnote_t-shirt.mhclo',
           'jaldmic_m1951_72.mhclo', 'toigo_ankle_boots_female.mhclo', 'wdg_scruffy_beard.mhclo', 'elvs_male_trouser_short_1.mhclo'}
EYEBROWS = ['eyebrow001', 'eyebrow']
EYELASHES = ['eyelashes01', 'eyelashes']
EYES = ['low-poly', 'eyes']

# The cast: Parisians on a late-October evening. gender 1 = male; age in years; ethnic mix (african, asian, caucasian).
CAST = [
    {'name': 'man_suit', 'gender': 1.0, 'age': 42, 'eth': (0, 0, 1), 'muscle': 0.55, 'weight': 0.5, 'height': 0.6,
     'skin': ['middleage caucasian male', 'caucasian male'], 'hair': ['short02', 'short'], 'eyes': ['brown', ''],
     'clothes': [['male_elegantsuit', 'male suit', 'suit']], 'shoes': ['shoes06', 'shoes02', 'shoes']},
    {'name': 'woman_elegant', 'gender': 0.0, 'age': 34, 'eth': (0, 0.1, 0.9), 'muscle': 0.45, 'weight': 0.45, 'height': 0.5,
     'skin': ['young caucasian female', 'caucasian female'], 'hair': ['bob02', 'bob'], 'eyes': ['blue', ''],
     'clothes': [['female_elegantsuit', 'female suit']], 'shoes': ['shoes05', 'shoes03', 'shoes']},
    {'name': 'man_casual', 'gender': 1.0, 'age': 27, 'eth': (0.9, 0, 0.1), 'muscle': 0.65, 'weight': 0.45, 'height': 0.65,
     'skin': ['young african male', 'african male'], 'hair': ['short04', 'short01', 'short'], 'eyes': ['brown', ''],
     # Not casualsuit02: its shirt carries MakeHuman's logo (no marks in the games).
     'clothes': [['male_casualsuit03', 'male_casualsuit01']], 'shoes': ['shoes01', 'shoes']},
    {'name': 'woman_casual', 'gender': 0.0, 'age': 26, 'eth': (0, 0.9, 0.1), 'muscle': 0.4, 'weight': 0.4, 'height': 0.35,
     'skin': ['young asian female', 'asian female'], 'hair': ['ponytail01', 'ponytail', 'long'], 'eyes': ['brown', ''],
     'clothes': [['female_casualsuit02', 'female_casualsuit']], 'shoes': ['shoes03', 'shoes']},
    {'name': 'man_old', 'gender': 1.0, 'age': 68, 'eth': (0, 0, 1), 'muscle': 0.4, 'weight': 0.65, 'height': 0.45,
     'skin': ['old caucasian male', 'caucasian male'], 'hair': ['short01', 'short'], 'eyes': ['grey', 'blue', ''],
     'clothes': [['male_worksuit', 'male_casualsuit01', 'male_casualsuit']], 'shoes': ['shoes02', 'shoes'], 'hat': ['fedora']},
    {'name': 'woman_old', 'gender': 0.0, 'age': 63, 'eth': (0.1, 0, 0.9), 'muscle': 0.4, 'weight': 0.6, 'height': 0.45,
     'skin': ['old caucasian female', 'caucasian female'], 'hair': ['bob01', 'bob', 'short'], 'eyes': ['green', ''],
     'clothes': [['female_casualsuit01', 'female_casualsuit']], 'shoes': ['shoes04', 'shoes']},
    {'name': 'man_young', 'gender': 1.0, 'age': 21, 'eth': (0.2, 0.3, 0.5), 'muscle': 0.5, 'weight': 0.3, 'height': 0.55,
     'skin': ['young caucasian male', 'male'], 'hair': ['short03', 'short'], 'eyes': ['brown', ''],
     'clothes': [['male_casualsuit06', 'male_casualsuit04', 'male_casualsuit']], 'shoes': ['shoes01', 'shoes']},
    {'name': 'woman_african', 'gender': 0.0, 'age': 33, 'eth': (1, 0, 0), 'muscle': 0.55, 'weight': 0.5, 'height': 0.6,
     'skin': ['young african female', 'african female'], 'hair': ['afro01', 'afro', 'braid'], 'eyes': ['brown', ''],
     'clothes': [['female_casualsuit01', 'female_casualsuit']], 'shoes': ['shoes03', 'shoes']},
    {'name': 'man_asian', 'gender': 1.0, 'age': 36, 'eth': (0, 1, 0), 'muscle': 0.5, 'weight': 0.45, 'height': 0.45,
     'skin': ['middleage asian male', 'asian male'], 'hair': ['short02', 'short'], 'eyes': ['brown', ''],
     'clothes': [['male_casualsuit01', 'male_casualsuit03']], 'shoes': ['shoes06', 'shoes']},
    {'name': 'woman_long', 'gender': 0.0, 'age': 29, 'eth': (0, 0, 1), 'muscle': 0.45, 'weight': 0.4, 'height': 0.55,
     'skin': ['young caucasian female', 'caucasian female'], 'hair': ['long01', 'long'], 'eyes': ['blue', ''],
     'clothes': [['female_elegantsuit01', 'female_casualsuit']], 'shoes': ['shoes05', 'shoes']},
    {'name': 'man_middle', 'gender': 1.0, 'age': 51, 'eth': (0.3, 0, 0.7), 'muscle': 0.5, 'weight': 0.7, 'height': 0.5,
     'skin': ['middleage caucasian male', 'male'], 'hair': ['short04', 'short'], 'eyes': ['brown', ''],
     'clothes': [['male_casualsuit05', 'male_casualsuit']], 'shoes': ['shoes02', 'shoes']},
    {'name': 'woman_middle', 'gender': 0.0, 'age': 47, 'eth': (0, 0.3, 0.7), 'muscle': 0.5, 'weight': 0.55, 'height': 0.5,
     'skin': ['middleage caucasian female', 'female'], 'hair': ['braid01', 'bob02', 'bob'], 'eyes': ['brown', ''],
     'clothes': [['female_casualsuit02', 'female_casualsuit']], 'shoes': ['shoes04', 'shoes']},
]

# Field Line's soldiers (--cast fieldline): camouflage T-shirt or a knitted sweater, cargo trousers, tactical
# vest, a steel helmet or a patrol cap, boots. Short hair under the helmets, so none pokes through. Not in
# the picks (seen in the previews): the M1951 asset fits no torso, the female ankle boots render white,
# the scruffy beard is a black block, the cut-off trousers show skin through holes.
# No unit, flag or rank marks: the games' armies are invented.
SOLDIERS = [
    {'name': 'soldier_rifleman', 'gender': 1.0, 'age': 24, 'eth': (0, 0, 1), 'muscle': 0.65, 'weight': 0.45, 'height': 0.6,
     'skin': ['young caucasian male', 'caucasian male'], 'hair': ['short01', 'short'], 'eyes': ['brown', ''],
     'clothes': [['camo tee'], ['cargo pants', 'male trousers'], ['tactical vest']],
     'shoes': ['male boots', 'boots'], 'hat': ['m1 helmet', 'helmet']},
    {'name': 'soldier_capped', 'gender': 1.0, 'age': 31, 'eth': (0.9, 0, 0.1), 'muscle': 0.7, 'weight': 0.5, 'height': 0.65,
     'skin': ['middleage african male', 'african male'], 'hair': ['short04', 'short'], 'eyes': ['brown', ''],
     'clothes': [['camo tee'], ['cargo pants', 'male trousers'], ['tactical vest']],
     'shoes': ['male boots', 'boots'], 'hat': ['patrol cap', 'cap']},
    {'name': 'soldier_kz', 'gender': 1.0, 'age': 27, 'eth': (0, 0.9, 0.1), 'muscle': 0.6, 'weight': 0.4, 'height': 0.45,
     'skin': ['young asian male', 'asian male'], 'hair': ['short02', 'short'], 'eyes': ['brown', ''],
     'clothes': [['knitted sweater', 'camo tee'], ['cargo pants', 'male trousers'], ['tactical vest']],
     'shoes': ['male boots', 'boots'], 'hat': ['helmet kz45', 'helmet']},
    {'name': 'soldier_woman', 'gender': 0.0, 'age': 26, 'eth': (0, 0.1, 0.9), 'muscle': 0.6, 'weight': 0.4, 'height': 0.5,
     'skin': ['young caucasian female', 'caucasian female'], 'hair': ['ponytail01', 'braid01', 'ponytail'], 'eyes': ['blue', ''],
     'clothes': [['camo tee'], ['cargo pants', 'female trousers'], ['tactical vest female', 'tactical vest']],
     'shoes': ['heroine boots', 'boots'], 'hat': ['patrol cap', 'cap']},
    {'name': 'soldier_sergeant', 'gender': 1.0, 'age': 44, 'eth': (0.2, 0, 0.8), 'muscle': 0.6, 'weight': 0.65, 'height': 0.55,
     'skin': ['middleage caucasian male', 'caucasian male'], 'hair': ['short03', 'short'], 'eyes': ['grey', ''],
     'clothes': [['camo tee'], ['cargo pants', 'male trousers'], ['gloves short']],
     'shoes': ['male boots', 'boots'], 'hat': ['patrol cap', 'cap']},
    {'name': 'soldier_gunner', 'gender': 1.0, 'age': 29, 'eth': (0.7, 0, 0.3), 'muscle': 0.85, 'weight': 0.6, 'height': 0.7,
     'skin': ['young african male', 'african male'], 'hair': ['short01', 'short'], 'eyes': ['brown', ''],
     'clothes': [['camo tee'], ['cargo pants', 'male trousers'], ['tactical vest'], ['gloves short']],
     'shoes': ['male boots', 'boots'], 'hat': ['m1 helmet', 'helmet']},
]

# Castaway Lagoon's guerrillas (--cast lagoon): dressed for the heat and the jungle, not uniformed. Mixed
# shirts and vests, cargo trousers or shorts, boots or sandals, a cap or a fishing hat, a beard or two.
GUERRILLAS = [
    {'name': 'guerrilla_tank', 'gender': 1.0, 'age': 23, 'eth': (0.8, 0, 0.2), 'muscle': 0.7, 'weight': 0.35, 'height': 0.6,
     'skin': ['young african male', 'african male'], 'hair': ['short04', 'short'], 'eyes': ['brown', ''],
     'clothes': [['tankshirt', 'muscle shirt'], ['cargo pants']], 'shoes': ['male boots', 'boots']},
    {'name': 'guerrilla_camo', 'gender': 1.0, 'age': 34, 'eth': (0.3, 0.5, 0.2), 'muscle': 0.6, 'weight': 0.45, 'height': 0.45,
     'skin': ['middleage asian male', 'asian male'], 'hair': ['short02', 'short'], 'eyes': ['brown', ''],
     'clothes': [['camo tee'], ['cargo pants']], 'shoes': ['male boots', 'boots'], 'hat': ['patrol cap', 'cap']},
    {'name': 'guerrilla_shirt', 'gender': 1.0, 'age': 28, 'eth': (0.1, 0.1, 0.8), 'muscle': 0.55, 'weight': 0.4, 'height': 0.55,
     'skin': ['light skin male bronze', 'young caucasian male'], 'hair': ['short03', 'short'], 'eyes': ['brown', ''],
     'clothes': [['striped shirt', 'tankshirt'], ['jeans shorts', 'cargo pants']], 'shoes': ['flip flop', 'sandals']},
    {'name': 'guerrilla_vest', 'gender': 1.0, 'age': 41, 'eth': (0.9, 0, 0.1), 'muscle': 0.75, 'weight': 0.55, 'height': 0.6,
     'skin': ['skin male african middleage', 'middleage african male'], 'hair': ['short01', 'short'], 'eyes': ['brown', ''],
     'clothes': [['muscle shirt', 'tankshirt'], ['cargo pants'], ['tactical vest']], 'shoes': ['male boots', 'boots']},
    {'name': 'guerrilla_coveralls', 'gender': 1.0, 'age': 52, 'eth': (0.2, 0.3, 0.5), 'muscle': 0.5, 'weight': 0.6, 'height': 0.5,
     'skin': ['middleage caucasian male', 'male'], 'hair': ['short04', 'short'], 'eyes': ['grey', ''],
     'clothes': [['coveralls', 'male_worksuit']], 'shoes': ['male boots', 'boots'], 'hat': ['flat cap', 'cap']},
    {'name': 'guerrilla_woman', 'gender': 0.0, 'age': 27, 'eth': (0.8, 0, 0.2), 'muscle': 0.55, 'weight': 0.4, 'height': 0.5,
     'skin': ['young african female', 'african female'], 'hair': ['braid01', 'afro01', 'ponytail'], 'eyes': ['brown', ''],
     'clothes': [['tank top'], ['cargo pants']], 'shoes': ['heroine boots', 'boots']},
]

CASTS = {'paris': CAST, 'fieldline': SOLDIERS, 'lagoon': GUERRILLAS}

# Triangle budgets (people.ts LOD): near the camera the full one, beyond ~25 m the far one.
BUDGET = {'full': 12000, 'far': 2200}
# Small pieces the far body goes without (sub-pixel there) and pieces never decimated (cards: collapse destroys them).
FAR_SKIP = {'eyebrows', 'eyelashes'}
KEEP = {'eyebrows', 'eyelashes', 'eyes'}
# Texture sizes (px, longest side) by piece kind, near and far.
TEX = {'full': {'skin': 2048, 'clothes': 1024, 'shoes': 512, 'hair': 1024, 'hat': 512, 'eyes': 256, 'eyebrows': 256, 'eyelashes': 256},
       'far': {'skin': 512, 'clothes': 256, 'shoes': 128, 'hair': 256, 'hat': 128, 'eyes': 64}}
ALPHA_KINDS = {'hair', 'eyebrows', 'eyelashes'}
# Roughness where an .mhmat gives none (MakeHuman's `shininess` is a Phong exponent's share, not a roughness).
ROUGHNESS = {'skin': 0.5, 'eyes': 0.08, 'hair': 0.45, 'eyebrows': 0.6, 'eyelashes': 0.6, 'clothes': 0.8, 'shoes': 0.45, 'hat': 0.75}

# Blender (Z up, MPFB's human facing -Y, its left at +X) → the game (Y up, facing -Z, its right at +X): a rotation.
TO_GAME = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


# ------------------------------------------------------------------ MPFB

def mpfb(path, key):
    """MPFB is an extension: its modules live under bl_ext.<repo>.mpfb, whatever the repository is called."""
    for name in list(sys.modules):
        if name.endswith(path):
            return getattr(importlib.import_module(name), key)
    raise RuntimeError(f'MPFB is not loaded ({path}): install and enable the MPFB extension')


def enable_mpfb():
    import addon_utils
    for mod in addon_utils.modules():
        if mod.__name__.endswith('.mpfb') or mod.__name__ == 'mpfb':
            addon_utils.enable(mod.__name__, default_set=True)
            return
    raise RuntimeError('MPFB extension not found: install it from extensions.blender.org first')


def asset_index():
    """Installed assets by kind: {kind: {basename lower: full path}}."""
    AssetService = mpfb('mpfb.services.assetservice', 'AssetService')
    out = {}
    for kind, subdir, typ in (('clothes', 'clothes', 'mhclo'), ('hair', 'hair', 'mhclo'), ('eyebrows', 'eyebrows', 'mhclo'),
                              ('eyelashes', 'eyelashes', 'mhclo'), ('eyes', 'eyes', 'mhclo'), ('skins', 'skins', 'mhmat'),
                              ('eye_mats', 'eyes', 'mhmat')):
        AssetService.update_asset_list(asset_subdir=subdir, asset_type=typ)
        items = AssetService.get_asset_list(asset_subdir=subdir, asset_type=typ)
        out[kind] = {os.path.basename(v['full_path']).lower(): v['full_path'] for v in items.values()}
    return out


def asset_credit(path):
    """File, author and licence of an asset, from its .mhclo header: CC-BY pieces must be credited in the game."""
    out = {'file': os.path.basename(path)}
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                key, _, value = line.strip().partition(' ')
                if key in ('author', 'license', 'homepage') and value:
                    out[key] = value.strip()
    except OSError:
        pass
    return out


def word_in(word, name):
    """A pattern word in an asset's file name: a whole part of it or the start of one ("short" in short02,
    "male" in young_caucasian_male but not in ..._female), or, for a word that itself holds a separator
    (male_elegantsuit, low-poly), a plain substring."""
    if '_' in word or '-' in word:
        return word in name
    return any(part.startswith(word) for part in re.split(r'[_.\-]', name))


def pick(index, patterns, male):
    """The first asset matching the first pattern that matches anything (patterns in order of preference)."""
    names = sorted(index)
    for pattern in patterns:
        words = pattern.lower().split()
        for name in names:
            parts = re.split(r'[_.\-]', name)
            if male and 'female' in parts and 'female' not in words:
                continue
            if male and name.startswith('female') and 'female' not in words:
                continue
            if not male and ('male' in parts or name.startswith('male')) and 'male' not in words:
                continue
            if name in EXCLUDE:
                continue
            if all(word_in(w, name) for w in words):
                return index[name]
    return None


def macro_age(years):
    """MakeHuman's age slider: 0 = 1 year, 0.5 = 25, 1 = 90."""
    return (years - 1) / 24 * 0.5 if years < 25 else 0.5 + (years - 25) / 65 * 0.5


def mhmat_of_mhclo(path):
    """The material an .mhclo names (a path relative to it)."""
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            parts = line.strip().split(None, 1)
            if len(parts) == 2 and parts[0] == 'material':
                return os.path.join(os.path.dirname(path), parts[1].strip())
    return None


def read_mhmat(path):
    """The few keys of an .mhmat the game uses; texture paths made absolute."""
    out = {'colour': [0.5, 0.5, 0.5], 'roughness': None}
    if not path or not os.path.exists(path):
        return out
    here = os.path.dirname(path)
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            parts = line.strip().split(None, 1)
            if len(parts) < 2 or parts[0].startswith(('#', '/')):
                continue
            key, value = parts[0], parts[1].strip()
            if key in ('diffuseTexture', 'normalmapTexture', 'opacitymapTexture', 'roughnessmapTexture'):
                p = value if os.path.isabs(value) else os.path.join(here, value)
                if not os.path.exists(p):
                    p = os.path.join(here, os.path.basename(value))
                if os.path.exists(p):
                    out[key] = p
            elif key == 'diffuseColor':
                out['colour'] = [float(x) for x in value.split()[:3]]
            elif key == 'roughness':
                out['roughness'] = float(value)
    return out


def build_human(c, index):
    """The character in MPFB: (rig, [(object, kind, mhmat path)])."""
    HumanService = mpfb('mpfb.services.humanservice', 'HumanService')
    HOP = mpfb('mpfb.entities.objectproperties', 'HumanObjectProperties')
    TargetService = mpfb('mpfb.services.targetservice', 'TargetService')
    male = c['gender'] > 0.5
    body = HumanService.create_human()
    for key, value in (('gender', c['gender']), ('age', macro_age(c['age'])), ('muscle', c['muscle']),
                       ('weight', c['weight']), ('height', c['height'])):
        HOP.set_value(key, value, entity_reference=body)
    total = sum(c['eth']) or 1
    for key, value in zip(('african', 'asian', 'caucasian'), c['eth']):
        HOP.set_value(key, value / total, entity_reference=body)
    TargetService.reapply_macro_details(body)
    rig = HumanService.add_builtin_rig(body, 'default')
    pieces = []
    skin = pick(index['skins'], c['skin'], male)
    if skin:
        HumanService.set_character_skin(skin, body, skin_type='GAMEENGINE')
    else:
        print(f"  {c['name']}: no skin matches {c['skin']}; flat colour", flush=True)
    pieces.append((body, 'skin', skin))

    def add(kind, patterns, subdir, asset_type):
        path = pick(index[subdir], patterns, male)
        if not path:
            print(f"  {c['name']}: no {kind} matches {patterns}", flush=True)
            return
        # No subdivision: the game takes the asset's own topology (and decimates it).
        ob = HumanService.add_mhclo_asset(path, body, asset_type=asset_type, subdiv_levels=0, material_type='GAMEENGINE')
        mat = mhmat_of_mhclo(path)
        if kind == 'eyes':
            eye_mat = pick(index['eye_mats'], c['eyes'], male)
            if eye_mat:
                mat = eye_mat
        pieces.append((ob, kind, mat))
        c.setdefault('sources', []).append(asset_credit(path))
        print(f"  {kind}: {os.path.basename(path)}", flush=True)

    add('eyes', EYES, 'eyes', 'Eyes')
    add('eyebrows', EYEBROWS, 'eyebrows', 'Eyebrows')
    add('eyelashes', EYELASHES, 'eyelashes', 'Eyelashes')
    add('hair', c['hair'], 'hair', 'Hair')
    for patterns in c['clothes']:
        add('clothes', patterns, 'clothes', 'Clothes')
    add('shoes', c['shoes'], 'clothes', 'Clothes')
    if c.get('hat'):
        add('hat', c['hat'], 'clothes', 'Clothes')
    return rig, pieces


# ------------------------------------------------------------------ game meshes

def game_piece(src, kind, rig_bones):
    """A copy of one piece evaluated at rest (shape keys, the masks clothes put on the body), in the game's frame,
    its vertex groups folded into the game's bones."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = src.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    me.transform(TO_GAME @ src.matrix_world)
    ob = bpy.data.objects.new(f'{src.name}_game', me)
    bpy.context.scene.collection.objects.link(ob)
    src_names = [g.name for g in src.vertex_groups]
    for name in src_names:
        ob.vertex_groups.new(name=name)
    game = [ob.vertex_groups.new(name='g_' + b) for b in RIG_BONES]
    folded = {}
    for i, name in enumerate(src_names):
        if name in rig_bones:
            folded[i] = RIG_BONES.index(rig_bone(name))
    for v in me.vertices:
        acc = {}
        for g in v.groups:
            b = folded.get(g.group)
            if b is not None and g.weight > 0:
                acc[b] = acc.get(b, 0.0) + g.weight
        for b, w in acc.items():
            game[b].add([v.index], w, 'REPLACE')
    # Only the game's groups travel on (the decimation interpolates them).
    for name in src_names:
        ob.vertex_groups.remove(ob.vertex_groups[name])
    ob['kind'] = kind
    return ob


def decimate(ob, triangles):
    current = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if current <= triangles:
        return
    mod = ob.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = triangles / current
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def share_budget(obs, budget):
    """Each piece's triangles: the kept cards as they are, the rest in proportion to their size, the body favoured
    (the face and hands carry the likeness)."""
    tris = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in obs}
    kept = sum(tris[ob.name] for ob in obs if ob['kind'] in KEEP)
    weight = {ob.name: tris[ob.name] * (1.6 if ob['kind'] == 'skin' else 1.0) for ob in obs if ob['kind'] not in KEEP}
    total = sum(weight.values()) or 1
    left = max(budget - kept, budget * 0.5)
    return {name: max(200, int(left * w / total)) for name, w in weight.items()}


def use_gpu(cpu_only):
    """Cycles on the RTX card: OptiX, else CUDA, else the CPU."""
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
        gpus = [d for d in prefs.devices if d.type == backend]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == backend
            scene.cycles.device = 'GPU'
            return backend
    return 'CPU'


def bake_ao(obs):
    """AO by Cycles into a vertex colour layer of every piece, the whole character present (a collar darkens the
    neck, the hair the nape). Cards (lashes, brows) occlude nothing worth having."""
    scene = bpy.context.scene
    scene.cycles.samples = 128
    scene.world = scene.world or bpy.data.worlds.new('w')
    scene.world.light_settings.distance = 0.25
    scene.render.bake.target = 'VERTEX_COLORS'
    cards = ('eyebrows', 'eyelashes')
    for ob in obs:
        ob.hide_render = ob['kind'] in cards
    for ob in obs:
        # Cards are hidden from the render (Cycles will not bake a hidden object): they keep AO 1 (no layer).
        if ob['kind'] in cards:
            continue
        me = ob.data
        if 'ao' not in me.color_attributes:
            me.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = me.color_attributes['ao']
        # The bake needs a material; the piece's own are swapped back after.
        saved = list(me.materials)
        bake = bpy.data.materials.get('ao_bake') or bpy.data.materials.new('ao_bake')
        # Blender 5 materials always have nodes (use_nodes is deprecated); 4.x needs it switched on.
        if bpy.app.version < (5, 0, 0):
            bake.use_nodes = True
        me.materials.clear()
        me.materials.append(bake)
        for o in scene.objects:
            o.select_set(o == ob)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type='AO')
        me.materials.clear()
        for m in saved:
            me.materials.append(m)


# ------------------------------------------------------------------ export

def export_texture(path, out_dir, size, alpha, cache):
    """The texture downscaled to `size`, as JPEG (PNG if its alpha matters); its name in <out>/tex."""
    if not path:
        return None
    key = (path, size, alpha)
    if key in cache:
        return cache[key]
    base = re.sub(r'[^a-z0-9_]+', '_', os.path.splitext(os.path.basename(path))[0].lower())
    name = f'{base}_{size}.{"png" if alpha else "jpg"}'
    target = os.path.join(out_dir, 'tex', name)
    if not os.path.exists(target):
        img = bpy.data.images.load(path, check_existing=False)
        w, h = img.size
        s = min(1.0, size / max(w, h, 1))
        if s < 1:
            img.scale(max(1, round(w * s)), max(1, round(h * s)))
        img.file_format = 'PNG' if alpha else 'JPEG'
        img.save(filepath=target, quality=88)
        bpy.data.images.remove(img)
    cache[key] = 'tex/' + name
    return cache[key]


def write_character(obs, mats, path_base, joints, cast, lod, out_dir, tex_cache):
    """<name>.bin, format 2: 'PPL2', u32 vertices n, u32 indices m, u32 groups; f32 pos[3n], f32 nor[3n], f32 uv[2n],
    u8 bones[4n], u8 weights[4n], u8 ao[n], padding to 4, u32 index[m]. <name>.json: joints, cast, and per index
    range its material (textures relative to the .json)."""
    pos, nor, uvs, bones, wts, ao, idx, groups = [], [], [], [], [], [], [], []
    for ob in obs:
        me = ob.data
        me.calc_loop_triangles()
        uv_layer = me.uv_layers.active
        ao_layer = me.color_attributes.get('ao')
        names = {g.index: g.name[2:] for g in ob.vertex_groups if g.name.startswith('g_')}
        weights_of = {}
        remap = {}
        start = len(idx)
        for tri in me.loop_triangles:
            for li, vi in zip(tri.loops, tri.vertices):
                u, v = uv_layer.data[li].uv if uv_layer else (0.0, 0.0)
                key = (vi, round(u, 5), round(v, 5))
                if key not in remap:
                    remap[key] = len(pos) // 3
                    co = me.vertices[vi].co
                    n = me.vertices[vi].normal
                    pos += [co.x, co.y, co.z]
                    nor += [n.x, n.y, n.z]
                    # glTF-style uv: v down (the game's textures are not flipped).
                    uvs += [u, 1 - v]
                    if vi not in weights_of:
                        ws = sorted(((RIG_BONES.index(names[g.group]), g.weight) for g in me.vertices[vi].groups
                                     if g.group in names and g.weight > 0), key=lambda bw: -bw[1])[:4]
                        if not ws:
                            ws = [(RIG_BONES.index('head' if ob['kind'] in ('eyes', 'eyebrows', 'eyelashes', 'hair', 'hat') else 'pelvis'), 1.0)]
                        s = sum(w for _, w in ws)
                        ws = [(b, w / s) for b, w in ws] + [(0, 0.0)] * (4 - len(ws))
                        q = [round(w * 255) for _, w in ws]
                        q[0] += 255 - sum(q)
                        weights_of[vi] = ([b for b, _ in ws], q)
                    b, q = weights_of[vi]
                    bones += b
                    wts += q
                    ao.append(round(255 * (ao_layer.data[vi].color[0] if ao_layer else 1.0)))
                idx.append(remap[key])
        mat = mats[ob.name]
        kind = ob['kind']
        size = TEX[lod].get(kind, 512)
        alpha = kind in ALPHA_KINDS
        groups.append({
            'start': start, 'count': len(idx) - start, 'kind': kind,
            'albedo': export_texture(mat.get('diffuseTexture'), out_dir, size, alpha, tex_cache),
            'normal': export_texture(mat.get('normalmapTexture'), out_dir, size, False, tex_cache) if lod == 'full' else None,
            'colour': mat['colour'], 'roughness': round(mat['roughness'], 3), 'alpha': 'clip' if alpha else None,
        })
    n = len(pos) // 3
    with open(path_base + '.bin', 'wb') as f:
        f.write(b'PPL2')
        f.write(struct.pack('<III', n, len(idx), len(groups)))
        f.write(struct.pack(f'<{3 * n}f', *pos))
        f.write(struct.pack(f'<{3 * n}f', *nor))
        f.write(struct.pack(f'<{2 * n}f', *uvs))
        f.write(bytes(bones))
        f.write(bytes(min(255, max(0, w)) for w in wts))
        f.write(bytes(min(255, a) for a in ao))
        f.write(b'\0' * ((-(16 + 32 * n + 9 * n)) % 4))
        f.write(struct.pack(f'<{len(idx)}I', *idx))
    with open(path_base + '.json', 'w') as f:
        json.dump({'format': 2, 'bones': RIG_BONES, 'joints': joints, 'cast': cast, 'groups': groups, 'vertices': n, 'triangles': len(idx) // 3}, f, indent=1)
    return n, len(idx) // 3


def joints_of(rig):
    """The joints the game's posing needs, from the rig at rest, game frame: each bone's root, and the ends of
    the last ones (head top, toe tip, finger base)."""
    m = TO_GAME @ rig.matrix_world

    def j(bone, tail=False):
        b = rig.data.bones[bone]
        p = m @ (b.tail_local if tail else b.head_local)
        return [round(p.x, 5), round(p.y, 5), round(p.z, 5)]
    out = {'hip': j('root'), 'chest': j('spine03'), 'neck': j('neck01'), 'head': j('head'), 'headTop': j('head', True)}
    for side in ('L', 'R'):
        out[f'clavicle.{side}'] = j(f'clavicle.{side}')
        out[f'toeTip.{side}'] = j(f'toe3-3.{side}', True)
        out[f'hip.{side}'] = j(f'upperleg01.{side}')
        out[f'knee.{side}'] = j(f'lowerleg01.{side}')
        out[f'ankle.{side}'] = j(f'foot.{side}')
        out[f'toe.{side}'] = j(f'foot.{side}', True)
        out[f'shoulder.{side}'] = j(f'upperarm01.{side}')
        out[f'elbow.{side}'] = j(f'lowerarm01.{side}')
        out[f'wrist.{side}'] = j(f'wrist.{side}')
        out[f'fingers.{side}'] = j(f'finger3-1.{side}')
    return out


def preview(obs, mats, path, keep_blend=False):
    """A Cycles picture of the character with its textures (Blender is Z up: stood up for the picture only)."""
    scene = bpy.context.scene
    keep = set(o.name for o in obs)
    for o in scene.objects:
        o.hide_render = o.name not in keep
    pivot = bpy.data.objects.new('pivot', None)
    scene.collection.objects.link(pivot)
    for ob in obs:
        ob.parent = pivot
        mat = bpy.data.materials.new('preview_' + ob.name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        info = mats[ob.name]
        bsdf.inputs['Roughness'].default_value = info['roughness']
        if info.get('diffuseTexture'):
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(info['diffuseTexture'], check_existing=True)
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            if ob['kind'] in ALPHA_KINDS:
                nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        else:
            bsdf.inputs['Base Color'].default_value = (*info['colour'], 1)
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    pivot.rotation_euler = (math.radians(90), 0, 0)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.location = (1.4, 3.3, 1.35)
    aim = bpy.data.objects.new('aim', None)
    aim.location = (0, 0, 1.0)
    scene.collection.objects.link(aim)
    track = cam.constraints.new('TRACK_TO')
    track.target = aim
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    cam.data.lens = 55
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(55), 0, math.radians(150))
    scene.collection.objects.link(sun)
    # The user's startup file sets the scene up (it is kept for MPFB's preferences): a transparent film, a
    # resolution percentage, a render border or a dark world gave empty pictures. Set them all here.
    world = bpy.data.worlds.get('preview_world') or bpy.data.worlds.new('preview_world')
    world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == 'BACKGROUND'), None) or world.node_tree.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (0.35, 0.4, 0.45, 1)
    bg.inputs['Strength'].default_value = 1.0
    out = next((n for n in world.node_tree.nodes if n.type == 'OUTPUT_WORLD'), None) or world.node_tree.nodes.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(bg.outputs['Background'], out.inputs['Surface'])
    saved_world = scene.world
    scene.world = world
    r = scene.render
    r.film_transparent = False
    r.use_border = False
    r.resolution_percentage = 100
    r.resolution_x = 600
    r.resolution_y = 900
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGB'
    scene.cycles.samples = 96
    for ob in obs:
        ob.hide_viewport = False
        ob.hide_set(False)
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f'  preview: {path}', flush=True)
    if keep_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(path)[0] + '.blend', copy=True)
    scene.world = saved_world
    for o in (cam, sun, aim):
        bpy.data.objects.remove(o)
    for ob in obs:
        ob.parent = None
    bpy.data.objects.remove(pivot)


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='')
    ap.add_argument('--only', default='')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--cpu', action='store_true')
    # Which cast to build: Paris's crowd (default), Field Line's soldiers or Castaway Lagoon's guerrillas.
    ap.add_argument('--cast', default='paris', choices=sorted(CASTS))
    # Saves each preview's scene as a .blend next to its picture, to open in Blender when a picture looks wrong.
    ap.add_argument('--preview-blend', action='store_true')
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    # An empty scene, the user's preferences kept: MPFB enabled and its asset folders where the user set them
    # (factory settings would forget both).
    bpy.ops.wm.read_homefile(use_empty=True)
    enable_mpfb()
    index = asset_index()
    if args.list:
        for kind, items in index.items():
            print(f'{kind} ({len(items)}):')
            for name in sorted(items):
                print('   ', name)
        return
    if not args.out:
        ap.error('--out is required')
    # Absolute: Blender resolves a render's relative output path against itself, not the working folder,
    # and the previews landed somewhere else.
    args.out = os.path.abspath(args.out)
    if not index['clothes']:
        print('WARNING: no clothes installed. Load the MakeHuman system assets pack in MPFB (Apply assets → Load pack).')
    os.makedirs(os.path.join(args.out, 'tex'), exist_ok=True)
    print('Cycles device:', use_gpu(args.cpu), flush=True)
    tex_cache = {}
    for c in CASTS[args.cast]:
        if args.only and c['name'] not in args.only.split(','):
            continue
        print(c['name'], flush=True)
        rig, pieces = build_human(c, index)
        rig.data.pose_position = 'REST'
        rig_bones = {b.name for b in rig.data.bones}
        mats = {}
        base = []
        for src, kind, mat in pieces:
            ob = game_piece(src, kind, rig_bones)
            mats[ob.name] = read_mhmat(mat)
            if mats[ob.name]['roughness'] is None:
                mats[ob.name]['roughness'] = ROUGHNESS.get(kind, 0.7)
            base.append(ob)
        # Stand the character on y = 0: the lowest point of its shoes (or soles).
        floor = min(v.co.y for ob in base for v in ob.data.vertices)
        for ob in base:
            ob.data.transform(Matrix.Translation((0, -floor, 0)))
        joints = joints_of(rig)
        for k in joints:
            joints[k][1] = round(joints[k][1] - floor, 5)
        # The MPFB objects go before the bakes: anything left would occlude the AO.
        for src, _, _ in pieces:
            bpy.data.objects.remove(src)
        bpy.data.objects.remove(rig)
        for lod, budget in BUDGET.items():
            obs = []
            for ob in base:
                if lod == 'far' and ob['kind'] in FAR_SKIP:
                    continue
                cp = ob.copy()
                cp.data = ob.data.copy()
                cp.name = f'{ob.name}_{lod}'
                bpy.context.scene.collection.objects.link(cp)
                mats[cp.name] = mats[ob.name]
                obs.append(cp)
            for ob in base:
                ob.hide_render = True
            shares = share_budget(obs, budget)
            for ob in obs:
                if ob.name in shares:
                    decimate(ob, shares[ob.name])
            bake_ao(obs)
            n, t = write_character(obs, mats, os.path.join(args.out, f"{c['name']}_{lod}"), joints, c, lod, args.out, tex_cache)
            print(f"  {lod}: {n} vertices, {t} triangles", flush=True)
            if args.preview and lod == 'full':
                os.makedirs(os.path.join(args.out, 'preview'), exist_ok=True)
                preview(obs, mats, os.path.join(args.out, 'preview', c['name'] + '.png'), args.preview_blend)
            for ob in obs:
                bpy.data.objects.remove(ob)
        for ob in base:
            bpy.data.objects.remove(ob)
        clear_scene()


if __name__ == '__main__':
    main()
