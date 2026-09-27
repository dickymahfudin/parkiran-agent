# Run: Blender --background assets/generated/character/character.blend --python scripts/blender/make_animations.py -- <repo_root>
# Adds every clip the web app plays to the MPFB "mixamo" rig and exports character.glb + clips.json:
#   1. Quaternius Universal Animation Library (CC0) clips, retargeted from its rig.
#   2. Warung gestures (typing, smoking, sipping, lighter...) keyframed here as data and baked with two-bone IK.
# Everything is plain pose math on armature-space matrices; no constraints, no depsgraph tricks.
import json
import math
import os
import sys
import tempfile
import zipfile

import bpy
from mathutils import Matrix, Quaternion, Vector

REPO = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
OUT = os.path.join(REPO, "assets", "generated", "character")
UAL_ZIP = os.path.join(REPO, "assets", "raw", "quaternius-ual", "ual-standard.zip")
UAL_MEMBER = "Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb"
FPS = 24
P = "mixamorig:"

# ---------------------------------------------------------------- rigs


def dfs(bones):
    out = []

    def visit(b):
        out.append(b.name)
        for c in b.children:
            visit(c)

    for b in bones:
        if b.parent is None:
            visit(b)
    return out


rig = bpy.data.objects["Parkiran"]
if rig.matrix_world != Matrix.Identity(4):
    raise RuntimeError("expected the MPFB rig at the origin")
ORDER = dfs(rig.data.bones)
PARENT = {b.name: (b.parent.name if b.parent else None) for b in rig.data.bones}
CHILDREN = {n: [c.name for c in rig.data.bones[n].children] for n in ORDER}
REST = {n: rig.data.bones[n].matrix_local.copy() for n in ORDER}
REST_INV = {n: m.inverted() for n, m in REST.items()}

SIDES = (("Left", "L"), ("Right", "R"))
MAP = {P + "Hips": "DEF-hips", P + "Spine": "DEF-spine.001", P + "Spine1": "DEF-spine.002", P + "Spine2": "DEF-spine.003", P + "Neck": "DEF-neck", P + "Head": "DEF-head"}
for side, s in SIDES:
    MAP.update({
        f"{P}{side}Shoulder": f"DEF-shoulder.{s}", f"{P}{side}Arm": f"DEF-upper_arm.{s}", f"{P}{side}ForeArm": f"DEF-forearm.{s}", f"{P}{side}Hand": f"DEF-hand.{s}",
        f"{P}{side}UpLeg": f"DEF-thigh.{s}", f"{P}{side}Leg": f"DEF-shin.{s}", f"{P}{side}Foot": f"DEF-foot.{s}", f"{P}{side}ToeBase": f"DEF-toe.{s}",
    })
    for finger, src in (("Index", "f_index"), ("Middle", "f_middle"), ("Ring", "f_ring"), ("Pinky", "f_pinky"), ("Thumb", "thumb")):
        for k in (1, 2, 3):
            MAP[f"{P}{side}Hand{finger}{k}"] = f"DEF-{src}.0{k}.{s}"
missing = [n for n in ORDER if n not in MAP]
if missing:
    raise RuntimeError(f"unmapped target bones: {missing}")
# Bones whose rest *pose* differs (A-pose vs T-pose, bent vs straight legs); the rest are only defined differently.
ALIGN = {n for n in ORDER if any(k in n for k in ("Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot", "ToeBase"))}


def import_ual():
    tmp = tempfile.mkdtemp(prefix="ual-")
    with zipfile.ZipFile(UAL_ZIP) as z:
        path = z.extract(UAL_MEMBER, tmp)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    arms = [o for o in bpy.data.objects if o not in before and o.type == "ARMATURE"]
    if len(arms) != 1:
        raise RuntimeError("expected one armature in the UAL file")
    for o in bpy.data.objects:
        if o not in before and o.type == "MESH":
            o.hide_render = True
    return arms[0]


src = import_ual()
TO_TARGET = rig.matrix_world.inverted() @ src.matrix_world
SREST = {s: TO_TARGET @ src.data.bones[s].matrix_local for s in MAP.values()}


def rot(m):
    return m.to_3x3().normalized().to_quaternion()


def bone_dir(m):
    return (m.to_3x3() @ Vector((0, 1, 0))).normalized()


# Reference pose: target limbs turned to the source rest directions, so source deltas apply 1:1.
DELTA = {}
REF_Q = {}
for n in ORDER:
    parent_d = DELTA[PARENT[n]] if PARENT[n] else Quaternion()
    q = Quaternion()
    if n in ALIGN:
        q = (parent_d @ bone_dir(REST[n])).rotation_difference(bone_dir(SREST[MAP[n]]))
    DELTA[n] = q @ parent_d
    REF_Q[n] = DELTA[n] @ rot(REST[n])
SREST_Q_INV = {s: rot(m).inverted() for s, m in SREST.items()}
HIPS = P + "Hips"
SRC_HIPS = MAP[HIPS]
HIP_SCALE = REST[HIPS].translation.z / SREST[SRC_HIPS].translation.z


def build_pose(rotations, hips_pos):
    """Armature-space pose matrices from world rotations; every head follows its parent."""
    M = {}
    for n in ORDER:
        p = PARENT[n]
        pos = hips_pos if p is None else (M[p] @ (REST_INV[p] @ REST[n])).translation
        M[n] = Matrix.Translation(pos) @ rotations[n].to_matrix().to_4x4()
    return M


def set_action(obj, act):
    obj.animation_data_create()
    obj.animation_data.action = act
    if act.slots:
        obj.animation_data.action_slot = act.slots[0]


_retarget_cache = {}


def retarget_frame(action_name, frame):
    key = (action_name, frame)
    if key in _retarget_cache:
        return {n: m.copy() for n, m in _retarget_cache[key].items()}
    set_action(src, bpy.data.actions[action_name])
    bpy.context.scene.frame_set(frame)
    rotations = {}
    for n in ORDER:
        s = MAP[n]
        q = rot(TO_TARGET @ src.pose.bones[s].matrix) @ SREST_Q_INV[s]
        rotations[n] = q @ REF_Q[n]
    s_hips = (TO_TARGET @ src.pose.bones[SRC_HIPS].matrix).translation
    hips = REST[HIPS].translation + (s_hips - SREST[SRC_HIPS].translation) * HIP_SCALE
    M = build_pose(rotations, hips)
    _retarget_cache[key] = M
    return {n: m.copy() for n, m in M.items()}


def frame_count(action_name):
    f0, f1 = bpy.data.actions[action_name].frame_range
    return int(round(f1 - f0))


# ---------------------------------------------------------------- pose helpers

AX = Vector((1, 0, 0))  # character's left
UP = Vector((0, 0, 1))
FWD = Vector((0, -1, 0))


def subtree(n):
    out = [n]
    for c in CHILDREN[n]:
        out += subtree(c)
    return out


SUBTREE = {n: subtree(n) for n in ORDER}


def rotate_subtree(M, n, q, pivot):
    t = Matrix.Translation(pivot) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pivot)
    for b in SUBTREE[n]:
        M[b] = t @ M[b]


def euler_q(pitch=0.0, yaw=0.0, roll=0.0):
    """Degrees in the character frame: pitch > 0 bends forward, yaw > 0 turns to the character's left, roll > 0 leans left."""
    return Quaternion(UP, math.radians(yaw)) @ Quaternion(AX, math.radians(pitch)) @ Quaternion(-FWD, math.radians(roll))


def bend(M, bones_weights, pitch=0.0, yaw=0.0, roll=0.0):
    for n, w in bones_weights:
        rotate_subtree(M, n, euler_q(pitch * w, yaw * w, roll * w), M[n].translation)


def head_of(M, n):
    return M[n].translation.copy()


def two_bone_ik(M, side, target, pole):
    A, F, H = f"{P}{side}Arm", f"{P}{side}ForeArm", f"{P}{side}Hand"
    S, E, W = head_of(M, A), head_of(M, F), head_of(M, H)
    a, b = (E - S).length, (W - E).length
    to_t = target - S
    d = min(max(to_t.length, 1e-4), (a + b) * 0.995)
    direction = to_t.normalized()
    bend_dir = pole - S
    bend_dir -= direction * bend_dir.dot(direction)
    bend_dir.normalize()
    ang = math.acos(max(-1.0, min(1.0, (a * a + d * d - b * b) / (2 * a * d))))
    elbow = S + (direction * math.cos(ang) + bend_dir * math.sin(ang)) * a
    rotate_subtree(M, A, (E - S).normalized().rotation_difference((elbow - S).normalized()), S)
    E2, W2 = head_of(M, F), head_of(M, H)
    rotate_subtree(M, F, (W2 - E2).normalized().rotation_difference((S + direction * d - E2).normalized()), E2)


# Finger curl axes: palm normal in the rest pose, pointing to the side the fingers close towards.
FINGERS = ("Index", "Middle", "Ring", "Pinky")
PALM_N = {}
for side, _ in SIDES:
    h = REST[f"{P}{side}Hand"]
    fdir = bone_dir(REST[f"{P}{side}HandMiddle1"])
    across = REST[f"{P}{side}HandIndex1"].translation - REST[f"{P}{side}HandPinky1"].translation
    n = fdir.cross(across).normalized()
    medial = Vector((-1 if side == "Left" else 1, 0, 0))
    thumb = (REST[f"{P}{side}HandThumb1"].translation - h.translation).normalized()
    # The palm faces the thumb side's inner surface; in MPFB's A-pose that is medial-forward.
    if n.dot(medial + thumb * 0.5) < 0:
        n = -n
    PALM_N[side] = (rot(h).inverted(), n)

# Rest-pose finger direction and palm normal per hand (armature space), the frame HAND_O presets are mapped from.
HAND_REST = {}
for side, _ in SIDES:
    n = PALM_N[side][1]
    f = bone_dir(REST[f"{P}{side}HandMiddle1"])
    HAND_REST[side] = ((f - n * f.dot(n)).normalized(), n)


def hand_rotation(M, side, preset):
    spec = HAND_O[preset]
    f_t, n_t = Vector(spec[0]), Vector(spec[1])
    if side == "Left":
        f_t.x, n_t.x = -f_t.x, -n_t.x
    if len(spec) > 2:
        head = P + "Head"
        turn = rot(M[head]) @ rot(REST[head]).inverted()
        f_t, n_t = turn @ f_t, turn @ n_t
    f_t.normalize()
    n_t = (n_t - f_t * n_t.dot(f_t)).normalized()
    f0, n0 = HAND_REST[side]
    b0 = Matrix((f0, n0, f0.cross(n0))).transposed()
    b1 = Matrix((f_t, n_t, f_t.cross(n_t))).transposed()
    return (b1 @ b0.transposed()).to_quaternion() @ rot(REST[f"{P}{side}Hand"])


def orient_hand(M, side, q):
    """Turns the hand to world rotation `q`; half of the roll about the forearm goes into the forearm so the wrist never wrings."""
    fore, hand = f"{P}{side}ForeArm", f"{P}{side}Hand"
    E, W = head_of(M, fore), head_of(M, hand)
    axis = (W - E).normalized()
    delta = q @ rot(M[hand]).inverted()
    along = axis * Vector((delta.x, delta.y, delta.z)).dot(axis)
    twist = Quaternion((delta.w, along.x, along.y, along.z))
    if twist.magnitude > 1e-6:
        twist.normalize()
        ax, ang = twist.to_axis_angle()
        ang = ang if ax.dot(axis) >= 0 else -ang
        ang = (ang + math.pi) % (2 * math.pi) - math.pi
        rotate_subtree(M, fore, Quaternion(axis, ang * 0.5), E)
    rotate_subtree(M, hand, q @ rot(M[hand]).inverted(), head_of(M, hand))


FINGER_POSES = {
    "relaxed": {"f": (18, 24, 14), "t": (12, 10)},
    "open": {"f": (-5, -5, 0), "t": (-10, 0)},
    "fist": {"f": (75, 95, 60), "t": (35, 40)},
    "cig": {"f": (24, 30, 14), "ring": (60, 75, 50), "t": (25, 25)},
    "cup": {"f": (45, 55, 35), "t": (30, 20)},
    "type": {"f": (22, 28, 16), "t": (15, 10)},
    "lighter": {"f": (70, 85, 55), "t": (10, -10)},
    "point": {"f": (70, 90, 55), "index": (0, 5, 0), "t": (30, 30)},
    "phone": {"f": (55, 62, 40), "t": (8, 10)},
    "phoneTap": {"f": (55, 62, 40), "t": (26, 32)},
}


def finger_curls(name):
    p = FINGER_POSES[name]
    out = {}
    for f in FINGERS:
        out[f] = p.get(f.lower(), p["ring"] if f in ("Ring", "Pinky") and "ring" in p else p["f"])
    out["Thumb"] = p["t"] + (p["t"][1],)
    return out


def apply_fingers(M, side, curls):
    """Finger presets are absolute: fingers start straight (rest pose relative to the hand), then curl."""
    hand = f"{P}{side}Hand"
    to_hand = M[hand] @ REST_INV[hand]
    for b in SUBTREE[hand][1:]:
        M[b] = to_hand @ REST[b]
    # The rest hand is spread like a starfish; close the gaps so fingers lie side by side.
    for f, towards, k in (("Index", "Middle", 0.6), ("Ring", "Middle", 0.4), ("Pinky", "Ring", 0.45)):
        b = f"{P}{side}Hand{f}1"
        q = bone_dir(M[b]).rotation_difference(bone_dir(M[f"{P}{side}Hand{towards}1"]))
        rotate_subtree(M, b, Quaternion().slerp(q, k), M[b].translation)
    rest_inv, n_rest = PALM_N[side]
    n_cur = (rot(M[hand]) @ rest_inv) @ n_rest
    for f, angles in curls.items():
        for k, deg in zip((1, 2, 3), angles):
            b = f"{P}{side}Hand{f}{k}"
            d = bone_dir(M[b])
            axis = d.cross(n_cur)
            if axis.length < 1e-6:
                continue
            rotate_subtree(M, b, Quaternion(axis.normalized(), math.radians(deg)), M[b].translation)


def lerp_curls(a, b, u):
    return {f: tuple(x + (y - x) * u for x, y in zip(a[f], b[f])) for f in a}


# Landmarks on the MPFB body (rest pose), carried by bones.
def mouth_local():
    body = next(o for o in rig.children if o.name.startswith("Body"))
    pts = [body.matrix_world @ v.co for v in body.data.vertices]
    face = [p for p in pts if abs(p.x) < 0.012 and 1.5 < p.z < 1.62]
    nose = min(face, key=lambda p: p.y)
    mouth = nose + Vector((0, 0.012, -0.045))
    return REST_INV[P + "Head"] @ mouth


MOUTH = mouth_local()


def landmarks(M):
    hips = head_of(M, HIPS)
    head = P + "Head"
    # "face": the mouth, with offsets turned by the head (resolve()), so a hand at the lips stays there when the head tilts.
    out = {"hips": hips, "mouth": M[head] @ MOUTH, "face": M[head] @ MOUTH, "_head_turn": rot(M[head]) @ rot(REST[head]).inverted()}
    for side, s in SIDES:
        knee = head_of(M, f"{P}{side}Leg")
        hip_j = head_of(M, f"{P}{side}UpLeg")
        out[f"thigh{s}"] = hip_j.lerp(knee, 0.62) + Vector((0, 0, 0.075))
        out[f"pocket{s}"] = hip_j + Vector((0.04 if s == "L" else -0.04, -0.05, -0.08))
        out[f"side{s}"] = head_of(M, f"{P}{side}Hand")
        out[f"temple{s}"] = M[P + "Head"] @ (REST_INV[P + "Head"] @ (REST[P + "Head"].translation + Vector((0.075 if s == "L" else -0.075, -0.02, 0.1))))
    return out


# ---------------------------------------------------------------- gestures as data
# A key: t (s) plus optional spine/head (pitch, yaw, roll), arm targets per side, hand twist and finger pose.
# Arm target: (landmark, dx, dy, dz) in the character frame (+x left, -y forward, +z up) or None = keep the base arm.


def K(t, spine=(0, 0, 0), head=(0, 0, 0), L=None, R=None, hL=(0, 0, 0), hR=(0, 0, 0), fL="relaxed", fR="relaxed", shoulders=0.0, oL=None, oR=None, pL=None, pR=None):
    """`shoulders`: shrug in degrees (clavicles up). `oL`/`oR`: a HAND_O preset that sets the hand's absolute orientation
    (replaces the relative twist `hL`/`hR`, which leaves the palm wherever the IK happened to roll the forearm).
    `pL`/`pR`: where the elbow points, as (outwards, back, up) from the shoulder; default ARM_POLE (out, back and down)."""
    return {"t": t, "spine": spine, "head": head, "L": L, "R": R, "hL": hL, "hR": hR, "fL": fL, "fR": fR, "shoulders": shoulders, "oL": oL, "oR": oR, "pL": pL, "pR": pR}


ARM_POLE = (0.45, 0.35, -0.5)
# Hands clasped behind the head: elbows wide and a little up.
ELBOWS_OUT = (0.6, -0.05, 0.3)


# Hand orientations: (finger direction, palm normal) in the character frame, authored for the right hand; the left mirrors x.
# A third element "head" means the vectors are in the upright head's frame and turn with the head (hands at the face).
HAND_O = {
    # Cigarette between index and middle finger at the lips: palm towards the face, fingers up and a little inwards.
    "cigMouth": ((0.7, 0.1, 0.7), (0.2, 1, -0.15), "head"),
    # Holding it up by the chin between drags.
    "cigUp": ((0.3, -0.25, 1), (0.35, 1, 0.15)),
    # Lowered in front, hand on its side, lit end out.
    "cigSide": ((0.25, -1, 0.2), (0.7, 0.05, -0.7)),
    # Standing, arm hanging: fingers down and forward, palm towards the thigh.
    "cigHang": ((0.05, -0.45, -1), (1, 0, 0)),
    # Cup upright in front (thumb up), and tipped towards the mouth.
    "cupHold": ((0.3, -1, 0), (1, 0.3, 0)),
    "cupMouth": ((0.35, -0.8, 0.5), (1, 0.3, -0.2), "head"),
    # Lighter thumb-up in front of the face; the other hand shields the flame.
    "lighter": ((0.4, -1, 0.1), (1, 0.4, 0), "head"),
    "shield": ((0.5, -1, 0.2), (1, 0.5, 0), "head"),
    # Fingers laced behind the head: wrists behind the ears, fingers inwards across the back of the head, palms on it.
    "behindHead": ((0.85, 0.5, 0.1), (0.5, -0.85, 0), "head"),
    "facepalm": ((0.15, 0.3, 1), (0.1, 1, -0.3), "head"),
    # Waving: palm forward, fingers up, rocking side to side.
    "waveIn": ((0.3, 0, 1), (0, -1, 0)),
    "waveOut": ((-0.35, 0, 1), (0, -1, 0)),
    "stub": ((0.1, -0.35, -1), (1, 0, 0.1)),
    # Phone held upright in the palm, screen towards the eyes: the fingers run across its back to the far long edge
    # (web: the phone's long side lies along the knuckle line), the thumb on the screen. Steeper than square to the eyes,
    # so from the usual high-front camera its back shows instead of a sliver.
    "phone": ((1, -0.03, -0.05), (0.05, 0.8, 0.6)),
    # Patting the trouser pocket: palm flat on the side of the thigh.
    "pat": ((0, -0.2, -1), (1, 0, 0)),
}


def typing_keys(length):
    keys = []
    kb = 0.31
    for i, t in enumerate([x * length / 10 for x in range(11)]):
        lift_l = 0.012 if i % 2 == 0 else 0.0
        lift_r = 0.012 if i % 2 == 1 else 0.0
        look_up = 1 if 5 <= i <= 6 else 0
        keys.append(K(t, spine=(10, 0, 0), head=(17 - 12 * look_up, 3 if i % 3 == 0 else -2, 0),
                      L=("hips", 0.12, -kb, 0.155 + lift_l), R=("hips", -0.12, -kb + 0.01, 0.155 + lift_r),
                      hL=(25, -10, 0), hR=(25, 10, 0), fL="type", fR="type"))
    keys[-1] = dict(keys[0], t=length)
    return keys


# The laptop always lies open on the lap while seated (web: its top is ~9 cm above the hips, keyboard 25–40 cm ahead),
# so resting hands sit on its front corners, never on the thighs underneath it.
# A fifth "rest" element marks a resting hand: the wrist is laid flat like on a keyboard.
SIT_REST_L = ("hips", 0.165, -0.27, 0.13, "rest")
SIT_REST_R = ("hips", -0.165, -0.27, 0.13, "rest")
REST_TWIST = {"L": (25, -10, 0), "R": (25, 10, 0)}
# Wrist target for a drag: puts the index/middle finger gap 3.5 cm in front of the lips (web: the filter pokes 3 cm out of
# the palm side there), with the "cigMouth" hand orientation.
CIG_AT_MOUTH = ("face", -0.066, -0.032, -0.12)
CUP_AT_MOUTH = ("mouth", -0.02, -0.07, -0.09)

GESTURES = {
    "type": {"base": "sit", "length": 5.0, "loop": True, "keys": typing_keys(5.0)},
    "smoke": {"base": "sit", "length": 6.667, "loop": True, "keys": [
        K(0.0, spine=(6, 0, 0), L=SIT_REST_L, R=SIT_REST_R, fR="cig"),
        K(0.9, spine=(6, 0, 0), L=SIT_REST_L, R=SIT_REST_R, fR="cig"),
        K(1.7, spine=(4, 0, 0), head=(4, -4, 0), L=SIT_REST_L, R=CIG_AT_MOUTH, oR="cigMouth", fR="cig"),
        K(2.9, spine=(4, 0, 0), head=(2, -4, 0), L=SIT_REST_L, R=CIG_AT_MOUTH, oR="cigMouth", fR="cig"),
        K(3.5, spine=(0, 0, 0), head=(-14, 6, 0), L=SIT_REST_L, R=("hips", -0.17, -0.32, 0.22), oR="cigSide", fR="cig"),
        K(4.4, spine=(4, 0, 0), head=(-4, 10, 0), L=SIT_REST_L, R=SIT_REST_R, fR="cig"),
        K(5.4, spine=(6, 0, 0), head=(2, 14, 0), L=SIT_REST_L, R=("hips", -0.24, -0.3, 0.16), oR="cigSide", fR="cig"),
        K(6.667, spine=(6, 0, 0), L=SIT_REST_L, R=SIT_REST_R, fR="cig"),
    ]},
    "sip": {"base": "sit", "length": 4.0, "loop": False, "keys": [
        K(0.0, spine=(8, 0, 0), L=SIT_REST_L, R=("hips", -0.2, -0.3, 0.2), oR="cupHold", fR="cup"),
        K(0.9, spine=(4, 0, 0), L=SIT_REST_L, R=CUP_AT_MOUTH, oR="cupMouth", fR="cup"),
        K(1.3, spine=(0, 0, 0), head=(-18, 0, 0), L=SIT_REST_L, R=("mouth", -0.02, -0.06, -0.06), oR="cupMouth", fR="cup"),
        K(2.4, spine=(0, 0, 0), head=(-14, 0, 0), L=SIT_REST_L, R=("mouth", -0.02, -0.06, -0.06), oR="cupMouth", fR="cup"),
        K(3.1, spine=(6, 0, 0), head=(4, 0, 0), L=SIT_REST_L, R=("hips", -0.2, -0.3, 0.2), oR="cupHold", fR="cup"),
        K(4.0, spine=(8, 0, 0), L=SIT_REST_L, R=("hips", -0.2, -0.3, 0.2), oR="cupHold", fR="cup"),
    ]},
    # Leaning back with the fingers laced behind the head, elbows wide (hands on top of the head showed their palms).
    "stretch": {"base": "sit", "length": 3.2, "loop": False, "keys": [
        K(0.0, L=SIT_REST_L, R=SIT_REST_R),
        K(0.8, spine=(-10, 0, 0), head=(-12, 0, 0), L=("face", 0.1, 0.15, 0.08), R=("face", -0.1, 0.15, 0.08), oL="behindHead", oR="behindHead", pL=ELBOWS_OUT, pR=ELBOWS_OUT, fL="type", fR="type", shoulders=8),
        K(1.9, spine=(-15, 4, 0), head=(-18, 6, 0), L=("face", 0.1, 0.16, 0.08), R=("face", -0.1, 0.16, 0.08), oL="behindHead", oR="behindHead", pL=ELBOWS_OUT, pR=ELBOWS_OUT, fL="type", fR="type", shoulders=10),
        K(3.2, L=SIT_REST_L, R=SIT_REST_R),
    ]},
    "frustrated": {"base": "sit", "length": 2.4, "loop": False, "keys": [
        K(0.0, L=SIT_REST_L, R=SIT_REST_R),
        K(0.45, spine=(16, 0, 0), head=(20, 0, 0), L=SIT_REST_L, R=("mouth", -0.01, -0.07, 0.07), oR="facepalm", fR="open"),
        K(1.0, spine=(18, 0, 0), head=(24, 10, 0), L=SIT_REST_L, R=("mouth", -0.01, -0.07, 0.07), oR="facepalm", fR="open"),
        K(1.5, spine=(18, 0, 0), head=(24, -10, 0), L=SIT_REST_L, R=("mouth", -0.01, -0.07, 0.07), oR="facepalm", fR="open"),
        K(2.4, L=SIT_REST_L, R=SIT_REST_R),
    ]},
    # The laptop stays open, so the torso stays upright and only the chin drops to the chest; leaning in puts the head through the lid.
    "doze": {"base": "sit", "length": 5.0, "loop": True, "keys": [
        K(0.0, spine=(7, 0, -4), head=(44, 10, 14), L=("hips", 0.15, -0.27, 0.13, "rest"), R=("hips", -0.15, -0.27, 0.13, "rest")),
        K(2.5, spine=(9, 0, -4), head=(50, 10, 16), L=("hips", 0.15, -0.27, 0.125, "rest"), R=("hips", -0.15, -0.27, 0.125, "rest")),
        K(5.0, spine=(7, 0, -4), head=(44, 10, 14), L=("hips", 0.15, -0.27, 0.13, "rest"), R=("hips", -0.15, -0.27, 0.13, "rest")),
    ]},
    "stubOut": {"base": "sit", "length": 1.2, "loop": False, "keys": [
        K(0.0, L=SIT_REST_L, R=SIT_REST_R, fR="cig"),
        K(0.5, spine=(20, -8, -14), head=(20, -20, 0), L=SIT_REST_L, R=("hips", -0.36, -0.05, -0.04), oR="stub", fR="cig"),
        K(0.8, spine=(20, -8, -14), head=(20, -20, 0), L=SIT_REST_L, R=("hips", -0.36, -0.05, -0.05), oR="stub", fR="cig"),
        K(1.2, L=SIT_REST_L, R=SIT_REST_R),
    ]},
    "closeLaptop": {"base": "sit", "length": 1.0, "loop": False, "keys": [
        K(0.0, spine=(10, 0, 0), head=(17, 0, 0), L=("hips", 0.12, -0.31, 0.155), R=("hips", -0.12, -0.3, 0.155), hL=(25, -10, 0), hR=(25, 10, 0), fL="type", fR="type"),
        K(0.45, spine=(14, 0, 0), head=(18, 0, 0), L=("hips", 0.13, -0.42, 0.26), R=("hips", -0.13, -0.42, 0.26), hL=(-30, 0, 0), hR=(-30, 0, 0), fL="open", fR="open"),
        K(0.75, spine=(18, 0, 0), head=(24, 0, 0), L=("hips", 0.13, -0.38, 0.17), R=("hips", -0.13, -0.38, 0.17), hL=(30, 0, 0), hR=(30, 0, 0), fL="open", fR="open"),
        K(1.0, L=SIT_REST_L, R=SIT_REST_R),
    ]},
    "lightUp": {"base": "sit", "length": 1.4, "loop": False, "keys": [
        K(0.0, L=SIT_REST_L, R=SIT_REST_R, fL="lighter", fR="cig"),
        K(0.45, spine=(10, 0, 0), head=(16, 0, 0), L=("mouth", 0.03, -0.12, -0.08), R=("mouth", -0.06, -0.09, -0.04), oL="lighter", oR="shield", fL="lighter", fR="cig"),
        K(1.0, spine=(10, 0, 0), head=(16, 0, 0), L=("mouth", 0.03, -0.12, -0.08), R=("mouth", -0.06, -0.09, -0.04), oL="lighter", oR="shield", fL="lighter", fR="cig"),
        K(1.4, spine=(4, 0, 0), head=(-6, 0, 0), L=SIT_REST_L, R=CIG_AT_MOUTH, oR="cigMouth", fR="cig"),
    ]},
}

def thinking_keys():
    kb_l = ("hips", 0.12, -0.31, 0.155)
    kb_r = ("hips", -0.11, -0.30, 0.16)
    chin = ("mouth", -0.07, -0.13, -0.15)
    tap = lambda k, i: (k[0], k[1], k[2], k[3] + (0.012 if i % 2 == 0 else 0.0))
    keys = [
        K(0.0, spine=(8, 0, 0), head=(14, 3, 0), L=kb_l, R=chin, hL=(25, -10, 0), oR="cigUp", fL="type", fR="cig"),
        K(0.7, spine=(8, 0, 0), head=(15, 2, 0), L=tap(kb_l, 0), R=chin, hL=(25, -10, 0), oR="cigUp", fL="type", fR="cig"),
        K(1.3, spine=(6, 0, 0), head=(10, -2, 0), L=tap(kb_l, 1), R=chin, hL=(25, -10, 0), oR="cigUp", fL="type", fR="cig"),
        K(1.9, spine=(4, 0, 0), head=(4, -4, 0), L=kb_l, R=CIG_AT_MOUTH, hL=(25, -10, 0), oR="cigMouth", fL="type", fR="cig"),
        K(2.6, spine=(4, 0, 0), head=(3, -4, 0), L=tap(kb_l, 0), R=CIG_AT_MOUTH, hL=(25, -10, 0), oR="cigMouth", fL="type", fR="cig"),
        K(3.2, spine=(2, 0, 0), head=(-12, 6, 0), L=kb_l, R=chin, hL=(25, -10, 0), oR="cigUp", fL="type", fR="cig"),
        K(3.9, spine=(8, 0, 0), head=(14, 2, 0), L=tap(kb_l, 1), R=chin, hL=(25, -10, 0), oR="cigUp", fL="type", fR="cig"),
        K(4.5, spine=(10, 0, 0), head=(16, 0, 0), L=tap(kb_l, 0), R=kb_r, hL=(25, -10, 0), hR=(25, 10, 0), fL="type", fR="cig"),
        K(5.0, spine=(10, 0, 0), head=(17, 3, 0), L=kb_l, R=tap(kb_r, 0), hL=(25, -10, 0), hR=(25, 10, 0), fL="type", fR="cig"),
        K(5.5, spine=(10, 0, 0), head=(16, -2, 0), L=tap(kb_l, 1), R=kb_r, hL=(25, -10, 0), hR=(25, 10, 0), fL="type", fR="cig"),
        K(6.2, spine=(8, 0, 0), head=(14, 3, 0), L=kb_l, R=chin, hL=(25, -10, 0), oR="cigUp", fL="type", fR="cig"),
    ]
    keys.append(dict(keys[0], t=6.667))
    return keys


STAND_SIDE_L = ("sideL", 0.0, 0.0, 0.0)
STAND_SIDE_R = ("sideR", 0.0, 0.0, 0.0)

def phone_keys(seated):
    """Idle with the phone: scrolling with the thumb, a drag on the cigarette now and then (seated: right hand;
    standing: the cigarette stays in the lips and the right hand has the phone, since the left carries the laptop)."""
    if seated:
        # Lower-chest height and a forearm's length out, elbow by the side, the head bowed to it.
        hold = ("hips", 0.07, -0.36, 0.3)
        low = ("hips", 0.1, -0.33, 0.25)
        rest = ("hips", -0.19, -0.28, 0.16)
        k = lambda t, f, head=(30, 0, 0), L=hold, R=rest, oR="cigSide", spine=(8, 0, 0): K(t, spine=spine, head=head, L=L, R=R, oL="phone", oR=oR, fL=f, fR="cig")
        return [
            k(0.0, "phone"),
            k(1.2, "phoneTap"),
            k(2.4, "phone", head=(32, 4, 0)),
            k(3.6, "phoneTap", head=(32, 4, 0)),
            k(4.5, "phone", head=(10, -4, 0), L=low, R=CIG_AT_MOUTH, oR="cigMouth", spine=(4, 0, 0)),
            k(5.6, "phone", head=(6, -4, 0), L=low, R=CIG_AT_MOUTH, oR="cigMouth", spine=(4, 0, 0)),
            k(6.6, "phone", head=(-8, 6, 0), L=low, R=("mouth", -0.07, -0.13, -0.15), oR="cigUp", spine=(2, 0, 0)),
            k(7.8, "phoneTap"),
            k(9.0, "phone", head=(28, -3, 0)),
            k(10.2, "phoneTap", head=(28, -3, 0)),
            k(12.0, "phone"),
        ]
    hold = ("hips", -0.08, -0.31, 0.21)
    k = lambda t, f, head=(34, 0, 0): K(t, spine=(6, 0, 0), head=head, L=STAND_SIDE_L, R=hold, oR="phone", fR=f)
    return [
        k(0.0, "phone"),
        k(1.2, "phoneTap"),
        k(2.4, "phone", head=(36, 5, 0)),
        k(3.6, "phoneTap", head=(36, 5, 0)),
        k(5.0, "phone", head=(4, 25, 0)),
        k(6.4, "phone", head=(6, 22, 0)),
        k(7.6, "phoneTap"),
        k(9.0, "phone", head=(32, -4, 0)),
        k(10.4, "phoneTap", head=(32, -4, 0)),
        k(12.0, "phone"),
    ]


GESTURES.update({
    # Idle: laptop shut on the lap, phone in the left hand, cigarette in the right.
    "phone": {"base": "sit", "length": 12.0, "loop": True, "keys": phone_keys(True)},
    "phoneStand": {"base": "stand", "length": 12.0, "loop": True, "keys": phone_keys(False)},
    # Seated idle with the laptop on the lap: hands rest on its corners, the head wanders a little.
    "sitIdle": {"base": "sit", "length": 5.0, "loop": True, "keys": [
        K(0.0, spine=(6, 0, 0), head=(10, 0, 0), L=SIT_REST_L, R=SIT_REST_R),
        K(1.6, spine=(6, 4, 0), head=(6, 22, 0), L=SIT_REST_L, R=SIT_REST_R),
        K(2.6, spine=(5, 4, 0), head=(4, 26, 0), L=SIT_REST_L, R=SIT_REST_R),
        K(3.8, spine=(6, -3, 0), head=(12, -12, 0), L=SIT_REST_L, R=SIT_REST_R),
        K(5.0, spine=(6, 0, 0), head=(10, 0, 0), L=SIT_REST_L, R=SIT_REST_R),
    ]},
    "think": {"base": "sit", "length": 6.667, "loop": True, "keys": thinking_keys()},
    # Riding a matic scooter (web Ambient SADDLE): knees bent past 90° keep the toes and knees behind the leg shield,
    # thighs tilt down a little so the soles stay on the floorboard; hands on the grips with a forward lean.
    "ride": {"base": "sit", "length": 1.667, "loop": True, "legs": (4, 24), "keys": [
        K(0.0, spine=(29, 0, 0), head=(-21, 0, 0), L=("hips", 0.3, -0.56, 0.155), R=("hips", -0.3, -0.56, 0.155), hL=(0, 0, 20), hR=(0, 0, -20), fL="fist", fR="fist"),
        K(0.83, spine=(30, 0, 1), head=(-20, 3, 0), L=("hips", 0.3, -0.56, 0.16), R=("hips", -0.3, -0.56, 0.155), hL=(0, 0, 20), hR=(0, 0, -20), fL="fist", fR="fist"),
        K(1.667, spine=(29, 0, 0), head=(-21, 0, 0), L=("hips", 0.3, -0.56, 0.155), R=("hips", -0.3, -0.56, 0.155), hL=(0, 0, 20), hR=(0, 0, -20), fL="fist", fR="fist"),
    ]},
    "patPockets": {"base": "stand", "length": 2.5, "loop": True, "keys": [
        K(0.0, spine=(14, 8, 0), head=(30, 10, 0), L=("pocketL", 0.0, 0.0, 0.0), R=STAND_SIDE_R, oL="pat", fL="open"),
        K(0.6, spine=(14, 8, 0), head=(30, 10, 0), L=("pocketL", 0.0, 0.0, 0.03), R=STAND_SIDE_R, oL="pat", fL="open"),
        K(1.25, spine=(14, -8, 0), head=(30, -10, 0), L=STAND_SIDE_L, R=("pocketR", 0.0, 0.0, 0.0), oR="pat", fR="open"),
        K(1.85, spine=(14, -8, 0), head=(30, -10, 0), L=STAND_SIDE_L, R=("pocketR", 0.0, 0.0, 0.03), oR="pat", fR="open"),
        K(2.5, spine=(14, 8, 0), head=(30, 10, 0), L=("pocketL", 0.0, 0.0, 0.0), R=STAND_SIDE_R, oL="pat", fL="open"),
    ]},
    "lookAround": {"base": "stand", "length": 5.0, "loop": True, "keys": [
        K(0.0, spine=(0, 12, 0), head=(-4, 45, 0), R=("pocketR", -0.02, 0.0, 0.04)),
        K(1.4, spine=(0, 12, 0), head=(-6, 50, 0), R=("pocketR", -0.02, 0.0, 0.04)),
        K(2.5, spine=(0, -12, 0), head=(-4, -45, 0), R=("pocketR", -0.02, 0.0, 0.04)),
        K(3.9, spine=(0, -12, 0), head=(-8, -52, 0), R=("pocketR", -0.02, 0.0, 0.04)),
        K(5.0, spine=(0, 12, 0), head=(-4, 45, 0), R=("pocketR", -0.02, 0.0, 0.04)),
    ]},
    # Standing, the left hand carries the laptop: the right hand works the lighter (web: the right-hand lighter prop).
    "lightUpStand": {"base": "stand", "length": 1.8, "loop": False, "keys": [
        K(0.0, L=STAND_SIDE_L, R=STAND_SIDE_R, fR="lighter"),
        K(0.55, spine=(8, 0, 0), head=(16, 0, 0), L=STAND_SIDE_L, R=("mouth", -0.03, -0.12, -0.08), oR="lighter", fR="lighter"),
        K(1.35, spine=(8, 0, 0), head=(16, 0, 0), L=STAND_SIDE_L, R=("mouth", -0.03, -0.12, -0.08), oR="lighter", fR="lighter"),
        K(1.8, head=(-8, 0, 0), L=STAND_SIDE_L, R=CIG_AT_MOUTH, oR="cigMouth", fR="cig"),
    ]},
    "drag": {"base": "stand", "length": 1.5, "loop": False, "keys": [
        K(0.0, head=(-8, 0, 0), R=CIG_AT_MOUTH, oR="cigMouth", fR="cig"),
        K(0.6, head=(-14, 0, 0), R=CIG_AT_MOUTH, oR="cigMouth", fR="cig"),
        K(1.1, head=(-18, 8, 0), R=("pocketR", -0.03, -0.12, 0.12), oR="cigHang", fR="cig"),
        K(1.5, head=(-6, 8, 0), R=("pocketR", -0.03, -0.12, 0.1), oR="cigHang", fR="cig"),
    ]},
    "sigh": {"base": "stand", "length": 1.6, "loop": False, "keys": [
        K(0.0),
        K(0.45, spine=(-6, 0, 0), head=(-10, 0, 0), shoulders=12),
        K(1.0, spine=(14, 0, 0), head=(34, 0, 0), shoulders=-6),
        K(1.6, spine=(6, 0, 0), head=(14, 0, 0)),
    ]},
    "pocketCig": {"base": "stand", "length": 1.1, "loop": False, "keys": [
        K(0.0, head=(6, 0, 0), R=CIG_AT_MOUTH, oR="cigMouth", fR="cig"),
        K(0.5, head=(14, -10, 0), R=("pocketR", -0.04, -0.06, 0.08), oR="cigHang", fR="cig"),
        K(0.8, head=(16, -10, 0), R=("pocketR", 0.0, 0.0, 0.0), oR="cigHang", fR="relaxed"),
        K(1.1, head=(6, 0, 0)),
    ]},
    "wave": {"base": "stand", "length": 2.0, "loop": False, "keys": [
        K(0.0),
        K(0.4, head=(-6, -8, 0), R=("mouth", -0.32, -0.05, 0.12), oR="waveIn", fR="open"),
        K(0.75, head=(-6, -8, 0), R=("mouth", -0.4, -0.05, 0.1), oR="waveOut", fR="open"),
        K(1.1, head=(-6, -8, 0), R=("mouth", -0.32, -0.05, 0.12), oR="waveIn", fR="open"),
        K(1.45, head=(-6, -8, 0), R=("mouth", -0.4, -0.05, 0.1), oR="waveOut", fR="open"),
        K(2.0),
    ]},
    "smokeStand": {"base": "stand", "length": 7.5, "loop": True, "keys": [
        K(0.0, L=("pocketL", 0.0, 0.0, 0.03), R=("pocketR", -0.03, -0.12, 0.1), oR="cigHang", fL="relaxed", fR="cig"),
        K(1.6, L=("pocketL", 0.0, 0.0, 0.03), R=("pocketR", -0.03, -0.12, 0.1), oR="cigHang", fR="cig"),
        K(2.4, head=(4, -4, 0), L=("pocketL", 0.0, 0.0, 0.03), R=CIG_AT_MOUTH, oR="cigMouth", fR="cig"),
        K(3.6, head=(2, -4, 0), L=("pocketL", 0.0, 0.0, 0.03), R=CIG_AT_MOUTH, oR="cigMouth", fR="cig"),
        K(4.3, head=(-16, 6, 0), L=("pocketL", 0.0, 0.0, 0.03), R=("pocketR", -0.03, -0.14, 0.16), oR="cigHang", fR="cig"),
        K(5.3, head=(-2, 12, 0), L=("pocketL", 0.0, 0.0, 0.03), R=("pocketR", -0.03, -0.12, 0.1), oR="cigHang", fR="cig"),
        K(7.5, L=("pocketL", 0.0, 0.0, 0.03), R=("pocketR", -0.03, -0.12, 0.1), oR="cigHang", fL="relaxed", fR="cig"),
    ]},
    "sipStand": {"base": "stand", "length": 4.0, "loop": False, "keys": [
        K(0.0, R=("pocketR", -0.02, -0.16, 0.16), oR="cupHold", fR="cup"),
        K(0.9, R=CUP_AT_MOUTH, oR="cupMouth", fR="cup"),
        K(1.3, head=(-18, 0, 0), R=("mouth", -0.02, -0.06, -0.06), oR="cupMouth", fR="cup"),
        K(2.4, head=(-14, 0, 0), R=("mouth", -0.02, -0.06, -0.06), oR="cupMouth", fR="cup"),
        K(3.1, head=(4, 0, 0), R=("pocketR", -0.02, -0.16, 0.16), oR="cupHold", fR="cup"),
        K(4.0, R=("pocketR", -0.02, -0.16, 0.16), oR="cupHold", fR="cup"),
    ]},
    "frustratedStand": {"base": "stand", "length": 2.4, "loop": False, "keys": [
        K(0.0),
        K(0.45, spine=(14, 0, 0), head=(18, 0, 0), R=("mouth", -0.01, -0.07, 0.07), oR="facepalm", fR="open", L=("pocketL", 0.02, 0.0, 0.05)),
        K(1.0, spine=(16, 0, 0), head=(22, 10, 0), R=("mouth", -0.01, -0.07, 0.07), oR="facepalm", fR="open", L=("pocketL", 0.02, 0.0, 0.05)),
        K(1.5, spine=(16, 0, 0), head=(22, -10, 0), R=("mouth", -0.01, -0.07, 0.07), oR="facepalm", fR="open", L=("pocketL", 0.02, 0.0, 0.05)),
        K(2.4),
    ]},
})

RETARGET = {
    "walk": ("Walk_Loop", True),
    "standIdle": ("Idle_Loop", True),
    "sitDown": ("Sitting_Enter", False),
    "standUp": ("Sitting_Exit", False),
    "chat": ("Sitting_Talking_Loop", True),
    "talk": ("Idle_Talking_Loop", True),
    "interact": ("Interact", False),
    "pickUp": ("PickUp_Table", False),
    "drive": ("Driving_Loop", True),
}
BASES = {"sit": "Sitting_Idle_Loop", "stand": "Idle_Loop"}


def smooth(u):
    return u * u * (3 - 2 * u)


def resolve(target, lm):
    if target is None:
        return None
    name, dx, dy, dz = target[:4]
    d = Vector((dx, dy, dz))
    return lm[name] + (lm["_head_turn"] @ d if name == "face" else d)


def gesture_pose(g, t, base_M):
    keys = g["keys"]
    i = 0
    while i < len(keys) - 2 and t > keys[i + 1]["t"]:
        i += 1
    k0, k1 = keys[i], keys[i + 1]
    span = max(1e-6, k1["t"] - k0["t"])
    u = smooth(min(1.0, max(0.0, (t - k0["t"]) / span)))
    lerp3 = lambda a, b: tuple(x + (y - x) * u for x, y in zip(a, b))
    M = base_M
    # Optional seated leg tweak (thigh down, extra knee bend), degrees; the foot is turned back so the sole stays flat.
    thigh, knee = g.get("legs", (0, 0))
    if thigh or knee:
        for side, _ in SIDES:
            rotate_subtree(M, f"{P}{side}UpLeg", Quaternion(AX, math.radians(thigh)), M[f"{P}{side}UpLeg"].translation)
            rotate_subtree(M, f"{P}{side}Leg", Quaternion(AX, math.radians(knee)), M[f"{P}{side}Leg"].translation)
            rotate_subtree(M, f"{P}{side}Foot", Quaternion(AX, -math.radians(thigh + knee)), M[f"{P}{side}Foot"].translation)
    spine = lerp3(k0["spine"], k1["spine"])
    bend(M, [(P + "Spine", 0.2), (P + "Spine1", 0.4), (P + "Spine2", 0.4)], *spine)
    shrug = k0["shoulders"] + (k1["shoulders"] - k0["shoulders"]) * u
    if shrug:
        for side, axis in (("Left", FWD), ("Right", -FWD)):
            sh = P + side + "Shoulder"
            rotate_subtree(M, sh, Quaternion(axis, math.radians(shrug)), M[sh].translation)
    head = lerp3(k0["head"], k1["head"])
    bend(M, [(P + "Neck", 0.4), (P + "Head", 0.6)], *head)
    lm = landmarks(M)
    for side, s in SIDES:
        a, b = resolve(k0[s], lm), resolve(k1[s], lm)
        base_wrist = head_of(M, f"{P}{side}Hand")
        if a is not None or b is not None:
            target = (a if a is not None else base_wrist).lerp(b if b is not None else base_wrist, u)
            sx = 1 if side == "Left" else -1
            po = lerp3(k0["p" + s] or ARM_POLE, k1["p" + s] or ARM_POLE)
            pole = head_of(M, f"{P}{side}Arm") + Vector((sx * po[0], po[1], po[2]))
            two_bone_ik(M, side, target, pole)
        rest = lambda k: REST_TWIST[s] if k[s] is not None and len(k[s]) == 5 else (0, 0, 0)
        twist = tuple(a + b for a, b in zip(lerp3(k0["h" + s], k1["h" + s]), lerp3(rest(k0), rest(k1))))
        hand = f"{P}{side}Hand"
        o0, o1 = k0["o" + s], k1["o" + s]
        if o0 is None and o1 is None:
            rotate_subtree(M, hand, euler_q(*twist), M[hand].translation)
        else:
            free = euler_q(*twist) @ rot(M[hand])
            q0 = hand_rotation(M, side, o0) if o0 else free
            q1 = hand_rotation(M, side, o1) if o1 else free
            if q0.dot(q1) < 0:
                q1 = -q1
            orient_hand(M, side, q0.slerp(q1, u))
        apply_fingers(M, side, lerp_curls(finger_curls(k0["f" + s]), finger_curls(k1["f" + s]), u))
    return M


# ---------------------------------------------------------------- baking


def to_basis(M):
    out = {}
    for n in ORDER:
        p = PARENT[n]
        basis = REST_INV[n] @ M[n] if p is None else REST_INV[n] @ REST[p] @ M[p].inverted() @ M[n]
        loc, q, _ = basis.decompose()
        out[n] = (loc, q)
    return out


def bake(name, frames, loop):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    set_action(rig, act)
    prev = {}
    for f, M in enumerate(frames):
        for n, (loc, q) in to_basis(M).items():
            pb = rig.pose.bones[n]
            pb.rotation_mode = "QUATERNION"
            if n in prev and prev[n].dot(q) < 0:
                q = -q
            prev[n] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f, group=n)
            if n == HIPS:
                pb.location = loc
                pb.keyframe_insert("location", frame=f, group=n)
    act["parkiran_loop"] = loop
    return act


def retarget_clip(name, src_action, loop):
    n = frame_count(src_action)
    frames = [retarget_frame(src_action, f) for f in range(n + 1)]
    return bake(name, frames, loop)


def gesture_clip(name, g):
    n = int(round(g["length"] * FPS))
    base_action = BASES[g["base"]]
    base_n = frame_count(base_action)
    frames = []
    for f in range(n + 1):
        base = retarget_frame(base_action, f % base_n if base_n else 0)
        frames.append(gesture_pose(g, f / FPS, base))
    return bake(name, frames, g["loop"])


def walk_speed():
    """Ground speed of the planted foot in the in-place walk, so the app can scale playback to its walk speed."""
    n = frame_count("Walk_Loop")
    feet = []
    for f in range(n + 1):
        M = retarget_frame("Walk_Loop", f)
        feet.append(head_of(M, P + "LeftFoot"))
    low = min(p.z for p in feet)
    speeds = [abs(feet[f + 1].y - feet[f].y) * FPS for f in range(n) if feet[f].z < low + 0.012 and feet[f + 1].z < low + 0.012]
    return sum(speeds) / len(speeds)


def export(meta):
    bpy.context.scene.render.fps = FPS
    rig.animation_data.action = None
    for o in list(bpy.data.objects):
        if o != rig and o.parent != rig:
            bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if "parkiran_loop" not in a:
            bpy.data.actions.remove(a)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for c in rig.children:
        c.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, "character.glb"),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_morph=False,
        export_skins=True,
        export_yup=True,
    )
    with open(os.path.join(OUT, "clips.json"), "w") as f:
        json.dump(meta, f, indent=2)


def main():
    bpy.context.scene.render.fps = FPS
    only = os.environ.get("PARKIRAN_CLIPS")
    meta = {"fps": FPS, "clips": {}}
    for name, (src_action, loop) in RETARGET.items():
        if only and name not in only.split(","):
            continue
        retarget_clip(name, src_action, loop)
        meta["clips"][name] = {"source": f"Quaternius UAL {src_action}", "loop": loop, "seconds": frame_count(src_action) / FPS}
    for name, g in GESTURES.items():
        if only and name not in only.split(","):
            continue
        gesture_clip(name, g)
        meta["clips"][name] = {"source": "keyframed", "loop": g["loop"], "seconds": g["length"], "base": g["base"]}
    sit = retarget_frame("Sitting_Idle_Loop", 0)
    hips = head_of(sit, HIPS)
    # glTF is Y-up with the character facing +Z.
    meta["sitHips"] = [round(hips.x, 4), round(hips.z, 4), round(-hips.y, 4)]
    meta["walkSpeed"] = round(walk_speed(), 4)
    meta["mouth"] = [round(v, 4) for v in (REST[P + "Head"] @ MOUTH)]
    print("PARKIRAN_META", json.dumps(meta))
    if os.environ.get("PARKIRAN_NO_EXPORT"):
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(tempfile.gettempdir(), "parkiran-anim-debug.blend"))
        return
    export(meta)
    print("PARKIRAN_DONE", OUT)


main()
