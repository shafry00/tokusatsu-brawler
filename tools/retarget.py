"""Retarget the game's kaiju animation clips onto a Sketchfab model's own skeleton.

Why retarget instead of reskin: the downloaded models already ship with correct
skin weights. Driving their own bones keeps that deformation, we only have to
translate the *rotation motion* from the game rig onto their bone names.

Method (standard world-delta retarget):
    A_s(b,t)  world rotation of source bone b at time t   (from its clip)
    R_s(b)    world rest rotation of source bone b
    R_m(b)    world rest rotation of the matching model bone

    A_m(b,t) = R_m(b) @ (R_s(b)^-1 @ A_s(b,t))        <- apply the world-space
                                                         motion to the model rest
    local_m(b,t) = A_m(parent,t)^-1 @ A_m(b,t)

Root translation is carried across as the world-space delta of the source root,
scaled by the height ratio and re-expressed in the model parent's frame.

Usage:
    retarget.py --list                              built-in bone maps
    retarget.py <key>                               tools/models/<key>.glb -> out/
    retarget.py --model M.glb --map bones.json --install
    retarget.py <key> --no-align                    skip the rest-pose swing

The built-in MAPS below are real, working examples taken from the ten kaiju in
this project, and they cover the three rig dialects you meet most often:

  * a clean named humanoid biped      (kaykit / mixamo style names)
  * MMO-style `bip_*` bone chains
  * rigs with useless names           (mapped by node index with a position
                                       assertion, see JAMILA_CHECK)

`skeleton` must be the *source* rig the clips were authored for; nothing about
the source mesh is used, only its bone names and their rest orientations.
"""

import json
import math
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                 # the repo root
SF = os.environ.get("RETARGET_MODELS", os.path.join(HERE, "models"))
OUT = os.environ.get("RETARGET_OUT", os.path.join(HERE, "out"))
INSTALL = os.path.join(ROOT, "assets", "models")

# which game rig supplies the clips.  Any rig whose bone names are the ones in
# MAPS below works; the CC0 KayKit character that ships as the "frog" kaiju is
# the canonical one, and it carries the full eight-clip set.
SRC_GLB = os.environ.get("RETARGET_SRC", os.path.join(INSTALL, "kaiju-frog.glb"))

# --------------------------------------------------------------------------
# bone maps:  slot -> (source bone in the game rig, bone in the model)
# slots follow the kaykit rig chain: hips/spine/chest/neck/head, arms, legs
# --------------------------------------------------------------------------
MISSING = None

MAPS = {
    "zetton": {
        "hips":      ("Hips",     "bip_pelvis_01"),
        "spine":     ("Abdomen",  "bip_spine_0_02"),
        "chest":     ("Torso",    "bip_spine_2_04"),
        "neck":      ("Neck",     "bip_neck_06"),
        "head":      ("Head",     "bip_head_07"),
        "shL":       ("Shoulder.L", "bip_collar_L_09"),
        "uaL":       ("UpperArm.L", "bip_upperArm_L_010"),
        "laL":       ("LowerArm.L", "bip_lowerArm_L_011"),
        "shR":       ("Shoulder.R", "bip_collar_R_019"),
        "uaR":       ("UpperArm.R", "bip_upperArm_R_020"),
        "laR":       ("LowerArm.R", "bip_lowerArm_R_00"),
        "ulL":       ("UpperLeg.L", "bip_hip_L_028"),
        "llL":       ("LowerLeg.L", "bip_knee_L_029"),
        "ftL":       ("Foot.L",     "bip_foot_L_030"),
        "ulR":       ("UpperLeg.R", "bip_hip_R_033"),
        "llR":       ("LowerLeg.R", "bip_knee_R_034"),
        "ftR":       ("Foot.R",     "bip_foot_R_035"),
    },
    "gomora": {
        "hips":      ("Hips",       "bip_pelvis_47"),
        "spine":     ("Abdomen",    "bip_spine_1_33"),
        "chest":     ("Torso",      "bip_spine_2_32"),
        "neck":      ("Neck",       "bip_neck_1_3"),
        "head":      ("Head",       "bip_head_1"),
        "shL":       ("Shoulder.L", "bip_collar_L_17"),
        "uaL":       ("UpperArm.L", "bip_upperArm_L_16"),
        "laL":       ("LowerArm.L", "bip_lowerArm_L_15"),
        "shR":       ("Shoulder.R", "bip_collar_R_31"),
        "uaR":       ("UpperArm.R", "bip_upperArm_R_30"),
        "laR":       ("LowerArm.R", "bip_lowerArm_R_29"),
        "ulL":       ("UpperLeg.L", "bip_hip_L_37"),
        "llL":       ("LowerLeg.L", "bip_knee_L_36"),
        "ftL":       ("Foot.L",     "bip_foot_L_35"),
        "ulR":       ("UpperLeg.R", "bip_hip_R_41"),
        "llR":       ("LowerLeg.R", "bip_knee_R_40"),
        "ftR":       ("Foot.R",     "bip_foot_R_39"),
    },
    "bemular": {
        "hips":      ("Hips",       "bn_Pelvis_59"),
        "spine":     ("Abdomen",    "bn_spine_1_48"),
        "chest":     ("Torso",      "bn_spine_3_46"),
        "neck":      ("Neck",       "bn_neck_1"),
        "head":      ("Head",       "bn_head_0"),
        "shL":       ("Shoulder.L", "bn_clav_L_45"),
        "uaL":       ("UpperArm.L", "bn_upperarm_L_44"),
        "laL":       ("LowerArm.L", "bn_forearm_L_41"),
        "shR":       ("Shoulder.R", "bn_clav_R_23"),
        "uaR":       ("UpperArm.R", "bn_upperarm_R_22"),
        "laR":       ("LowerArm.R", "bn_forearm_R_19"),
        "ulL":       ("UpperLeg.L", "bn_thigh_L_53"),
        "llL":       ("LowerLeg.L", "bn_calf_L_49"),
        "ulR":       ("UpperLeg.R", "bn_thigh_R_58"),
        "llR":       ("LowerLeg.R", "bn_calf_R_54"),
    },
    "kingjoe": {
        "hips":      ("Hips",       "Bip001 Pelvis_02"),
        "spine":     ("Abdomen",    "Bip001 Spine_09"),
        "chest":     ("Torso",      "Bip001 Spine_09"),
        "shL":       ("Shoulder.L", "Bip001 L Clavicle_010"),
        "uaL":       ("UpperArm.L", "Bip001 L UpperArm_w_011"),
        "laL":       ("LowerArm.L", "Bip001 L Forearm_012"),
        "shR":       ("Shoulder.R", "Bip001 R Clavicle_027"),
        "uaR":       ("UpperArm.R", "Bip001 R UpperArm_w_028"),
        "laR":       ("LowerArm.R", "Bip001 R Forearm_029"),
        "ulL":       ("UpperLeg.L", "Bip001 L Thigh_03"),
        "llL":       ("LowerLeg.L", "Bip001 L Calf_04"),
        "ftL":       ("Foot.L",     "Bip001 L Foot_05"),
        "ulR":       ("UpperLeg.R", "Bip001 R Thigh_06"),
        "llR":       ("LowerLeg.R", "Bip001 R Calf_07"),
        "ftR":       ("Foot.R",     "Bip001 R Foot_08"),
    },
    "redking": {
        "hips":      ("Hips",       "lowerbody_55"),
        "spine":     ("Abdomen",    "upperbody1_39"),
        "chest":     ("Torso",      "upperbody2_38"),
        "neck":      ("Neck",       "neck1_31"),
        "head":      ("Head",       "head_29"),
        "shL":       ("Shoulder.L", "shoulder.L_37"),
        "uaL":       ("UpperArm.L", "upperarm.L_36"),
        "laL":       ("LowerArm.L", "forearm.L_35"),
        "shR":       ("Shoulder.R", "shoulder.R_34"),
        "uaR":       ("UpperArm.R", "upperarm.R_33"),
        "laR":       ("LowerArm.R", "forearm.R_32"),
        "ulL":       ("UpperLeg.L", "leg.L_54"),
        "llL":       ("LowerLeg.L", "knee.L_53"),
        "ftL":       ("Foot.L",     "foot.L_5"),
        "ulR":       ("UpperLeg.R", "leg.R_52"),
        "llR":       ("LowerLeg.R", "knee.R_51"),
        "ftR":       ("Foot.R",     "foot.R_1"),
    },
    "silvergon": {
        "hips":      ("Hips",       "lowerbody_059"),
        "spine":     ("Abdomen",    "upperbody_05"),
        "chest":     ("Torso",      "upperbody2_06"),
        "neck":      ("Neck",       "neck_07"),
        "head":      ("Head",       "head_09"),
        "shL":       ("Shoulder.L", "shoulder.L_018"),
        "uaL":       ("UpperArm.L", "arm.L_019"),
        "laL":       ("LowerArm.L", "elbow.L_021"),
        "shR":       ("Shoulder.R", "shoulder.R_038"),
        "uaR":       ("UpperArm.R", "arm.R_039"),
        "laR":       ("LowerArm.R", "elbow.R_041"),
        "ulL":       ("UpperLeg.L", "leg.L_080"),
        "llL":       ("LowerLeg.L", "knee.L_081"),
        "ftL":       ("Foot.L",     "ankle.L_082"),
        "ulR":       ("UpperLeg.R", "leg.R_088"),
        "llR":       ("LowerLeg.R", "knee.R_089"),
        "ftR":       ("Foot.R",     "ankle.R_090"),
    },
    "tyrant": {
        "hips":      ("Hips",       "root hips_02"),
        "spine":     ("Abdomen",    "spine lower_03"),
        "chest":     ("Torso",      "spine upper_04"),
        "neck":      ("Neck",       "head neck lower_05"),
        "head":      ("Head",       "head neck upper_06"),
        "shL":       ("Shoulder.L", "arm left collar_011"),
        "uaL":       ("UpperArm.L", "arm left shoulder_012"),
        "laL":       ("LowerArm.L", "arm left elbow_013"),
        "shR":       ("Shoulder.R", "arm right collar_016"),
        "uaR":       ("UpperArm.R", "arm right shoulder_017"),
        "laR":       ("LowerArm.R", "arm right elbow_018"),
        "ulL":       ("UpperLeg.L", "leg left thigh_024"),
        "llL":       ("LowerLeg.L", "leg left knee_025"),
        "ftL":       ("Foot.L",     "leg left  ankle_026"),
        "ulR":       ("UpperLeg.R", "leg right thigh_028"),
        "llR":       ("LowerLeg.R", "leg right knee_029"),
        "ftR":       ("Foot.R",     "leg right ankle_030"),
    },
    "birdon": {
        "hips":      ("Hips",       "spine hip_02"),
        "spine":     ("Abdomen",    "spine lower_015"),
        "chest":     ("Torso",      "spine upper_016"),
        "neck":      ("Neck",       "neck lower_017"),
        "head":      ("Head",       "neck head beak lower_023"),
        "shL":       ("Shoulder.L", "arm left collar_025"),
        "uaL":       ("UpperArm.L", "arm left shoulder_026"),
        "laL":       ("LowerArm.L", "arm left elbow_027"),
        "shR":       ("Shoulder.R", "arm right collar_035"),
        "uaR":       ("UpperArm.R", "arm right shoulder_036"),
        "laR":       ("LowerArm.R", "arm right elbow_037"),
        "ulL":       ("UpperLeg.L", "leg left thigh_03"),
        "llL":       ("LowerLeg.L", "leg left knee_04"),
        "ftL":       ("Foot.L",     "leg left ankle_05"),
        "ulR":       ("UpperLeg.R", "leg right thigh_07"),
        "llR":       ("LowerLeg.R", "leg right knee_08"),
        "ftR":       ("Foot.R",     "leg right ankle_09"),
    },
}

# jamila's bone names are Japanese MMD names that were already destroyed by a
# codepage round-trip before the GLB was written (every kanji came through as
# U+FFFD), so they cannot be matched by name.  They are pinned by *node index*
# instead, which is stable for this file; every entry was identified from the
# skeleton's rest geometry (see objprobe/jamtree.py) and is cross-checked below
# against the expected rest position inside build().
#
#   node 12  y0.985  lowerbody -- the pelvis, both leg chains hang off it
#   node 23  y0.985  upperbody
#   node 25  y1.468  chest -- carries neck + both shoulder chains
#   node 26  y1.756  neck
#   node 27  y1.893  head
#   node 13/14/15    leg.L  knee.L  ankle.L   (x -0.13)
#   node 18/19/20    leg.R  knee.R  ankle.R   (x +0.13)
#   node 37/38/39    shoulder.L arm.L elbow.L (x -0.16 .. -0.47)
#   node 88/89/90    shoulder.R arm.R elbow.R (x +0.16 .. +0.47)
JAMILA = {
    "hips":  ("Hips",       "#12"),
    "spine": ("Abdomen",    "#23"),
    "chest": ("Torso",      "#25"),
    "neck":  ("Neck",       "#26"),
    "head":  ("Head",       "#27"),
    "shL":   ("Shoulder.L", "#37"),
    "uaL":   ("UpperArm.L", "#38"),
    "laL":   ("LowerArm.L", "#39"),
    "shR":   ("Shoulder.R", "#88"),
    "uaR":   ("UpperArm.R", "#89"),
    "laR":   ("LowerArm.R", "#90"),
    "ulL":   ("UpperLeg.L", "#13"),
    "llL":   ("LowerLeg.L", "#14"),
    "ftL":   ("Foot.L",     "#15"),
    "ulR":   ("UpperLeg.R", "#18"),
    "llR":   ("LowerLeg.R", "#19"),
    "ftR":   ("Foot.R",     "#20"),
}
MAPS["jamila"] = JAMILA

# second attempt at Baltan: the first download (sketchfab/baltan.glb) turned out
# to be an unrigged, untextured scan with no skeleton at all, so it was replaced
# with "Alien Baltan" by @peak_9.20 - a rigged, textured 3ds Max Biped.
MAPS["baltan"] = {
    "hips":  ("Hips",       "Bip001 Pelvis_05"),
    "spine": ("Abdomen",    "Bip001 Spine_06"),
    "chest": ("Torso",      "Bip001 Spine1_015"),
    "neck":  ("Neck",       "Bip001 Neck_016"),
    "head":  ("Head",       "Bip001 Head_017"),
    "shL":   ("Shoulder.L", "Bip001 L Clavicle_018"),
    "uaL":   ("UpperArm.L", "Bip001 L UpperArm_019"),
    "laL":   ("LowerArm.L", "Bip001 L Forearm_00"),
    "shR":   ("Shoulder.R", "Bip001 R Clavicle_025"),
    "uaR":   ("UpperArm.R", "Bip001 R UpperArm_026"),
    "laR":   ("LowerArm.R", "Bip001 R Forearm_027"),
    "ulL":   ("UpperLeg.L", "Bip001 L Thigh_07"),
    "llL":   ("LowerLeg.L", "Bip001 L Calf_08"),
    "ftL":   ("Foot.L",     "Bip001 L Foot_09"),
    "ulR":   ("UpperLeg.R", "Bip001 R Thigh_011"),
    "llR":   ("LowerLeg.R", "Bip001 R Calf_012"),
    "ftR":   ("Foot.R",     "Bip001 R Foot_013"),
}

# sanity check for the index-pinned map: expected rest world position of each
# model bone, so a swapped/re-exported jamila.glb is caught instead of silently
# driving the wrong bones.
JAMILA_CHECK = {
    "#12": (0.000, 0.985), "#23": (0.000, 0.985), "#25": (0.000, 1.468),
    "#26": (0.000, 1.756), "#27": (0.000, 1.893),
    "#37": (-0.156, 1.652), "#38": (-0.299, 1.613), "#39": (-0.467, 1.441),
    "#88": (0.156, 1.652), "#89": (0.299, 1.613), "#90": (0.467, 1.441),
    "#13": (-0.130, 0.795), "#14": (-0.139, 0.441), "#15": (-0.132, 0.096),
    "#18": (0.130, 0.795), "#19": (0.139, 0.441), "#20": (0.132, 0.096),
}

# ordered from the root outwards; used to walk the chain parent-first
CHAIN = ["hips", "spine", "chest", "neck", "head",
         "shL", "uaL", "laL", "shR", "uaR", "laR",
         "ulL", "llL", "ftL", "ulR", "llR", "ftR"]


# --------------------------------------------------------------------------
# tiny quaternion / matrix helpers, quaternions are [x, y, z, w]
# --------------------------------------------------------------------------
def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def qconj(q):
    return np.array([-q[0], -q[1], -q[2], q[3]])


def qnorm(q):
    n = math.sqrt(float(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2))
    return q / n if n > 1e-12 else np.array([0.0, 0.0, 0.0, 1.0])


def qmat(q):
    """quaternion -> 3x3 rotation matrix"""
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def mat2q(m):
    """3x3 rotation matrix -> quaternion (shear removed by orthonormalising)"""
    m = np.asarray(m, dtype=float)
    for i in range(3):                        # Gram-Schmidt
        for j in range(i):
            m[:, i] -= m[:, i].dot(m[:, j]) * m[:, j]
        n = np.linalg.norm(m[:, i])
        if n > 1e-12:
            m[:, i] /= n
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = np.array([(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s,
                      (m[1, 0] - m[0, 1]) / s, 0.25 * s])
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = np.array([0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s,
                      (m[2, 1] - m[1, 2]) / s])
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = np.array([(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s,
                      (m[0, 2] - m[2, 0]) / s])
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = np.array([(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s,
                      (m[1, 0] - m[0, 1]) / s])
    return qnorm(q)


def qslerp(a, b, t):
    d = float(a.dot(b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        return qnorm(a + (b - a) * t)
    th = math.acos(max(-1.0, min(1.0, d)))
    s = math.sin(th)
    return qnorm(a * (math.sin((1 - t) * th) / s) + b * (math.sin(t * th) / s))


def qaxis(axis, ang):
    axis = np.asarray(axis, dtype=float)
    n = np.linalg.norm(axis)
    if n < 1e-12:
        return np.array([0.0, 0.0, 0.0, 1.0])
    axis = axis / n
    s = math.sin(ang / 2.0)
    return np.array([axis[0] * s, axis[1] * s, axis[2] * s, math.cos(ang / 2.0)])


def qarc(a, b):
    """shortest-arc rotation taking unit vector a onto unit vector b"""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    a = a / max(1e-12, np.linalg.norm(a))
    b = b / max(1e-12, np.linalg.norm(b))
    d = float(np.clip(a.dot(b), -1.0, 1.0))
    if d > 0.999999:
        return np.array([0.0, 0.0, 0.0, 1.0])
    if d < -0.999999:
        # opposed: any perpendicular axis will do
        axis = np.cross(a, [1.0, 0.0, 0.0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0.0, 1.0, 0.0])
        return qaxis(axis, math.pi)
    return qaxis(np.cross(a, b), math.acos(d))


def trs_matrix(node):
    """4x4 local matrix of a glTF node (handles matrix or TRS)"""
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4).T
    m = np.eye(4)
    if "rotation" in node:
        m[:3, :3] = qmat(np.array(node["rotation"], dtype=float))
    elif "scale" in node:
        pass
    t = np.array(node.get("translation", [0.0, 0.0, 0.0]), dtype=float)
    s = np.array(node.get("scale", [1.0, 1.0, 1.0]), dtype=float)
    m[:3, :3] = m[:3, :3] @ np.diag(s)
    m[:3, 3] = t
    return m


def local_rot_q(node):
    if "rotation" in node:
        return qnorm(np.array(node["rotation"], dtype=float))
    if "matrix" in node:
        return mat2q(np.array(node["matrix"], dtype=float).reshape(4, 4).T[:3, :3])
    return np.array([0.0, 0.0, 0.0, 1.0])


# --------------------------------------------------------------------------
# glTF io
# --------------------------------------------------------------------------
def load_glb(path):
    raw = open(path, "rb").read()
    if raw[:4] != b"glTF":
        raise SystemExit("%s is not a GLB" % path)
    off, g, bin_ = 12, None, b""
    while off < len(raw):
        clen, ctype = struct.unpack_from("<II", raw, off)
        off += 8
        chunk = raw[off:off + clen]
        if ctype == 0x4E4F534A:
            g = json.loads(chunk)
        elif ctype == 0x004E4942:
            bin_ = chunk
        off += clen
    return g, bytearray(bin_)


COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
        5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_accessor(g, bin_, idx):
    acc = g["accessors"][idx]
    n = NCOMP[acc["type"]]
    fmt, size = COMP[acc["componentType"]]
    bv = g["bufferViews"][acc["bufferView"]]
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or n * size
    out = []
    for i in range(acc["count"]):
        off = base + i * stride
        out.append(struct.unpack_from("<" + fmt * n, bin_, off))
    return out


def parent_map(g):
    par = {}
    for i, nd in enumerate(g.get("nodes", [])):
        for c in nd.get("children", []):
            par[c] = i
    return par


def joint_info(g):
    """name -> node index, plus the skin's joint list in order"""
    idx = {}
    for i, nd in enumerate(g.get("nodes", [])):
        nm = nd.get("name")
        if nm is not None and nm not in idx:
            idx[nm] = i
    sk = g.get("skins", [])
    joints = sk[0]["joints"] if sk else []
    return idx, joints


def world_rest_rot(g):
    """node index -> world rest rotation as a quaternion (ignores translation)"""
    par = parent_map(g)
    nodes = g.get("nodes", [])
    memo = {}

    def rec(i):
        if i in memo:
            return memo[i]
        q = local_rot_q(nodes[i])
        p = par.get(i)
        if p is not None:
            q = qmul(rec(p), q)
        memo[i] = q
        return q

    return {i: rec(i) for i in range(len(nodes))}


def world_rest_pos(g):
    par = parent_map(g)
    nodes = g.get("nodes", [])
    memo = {}

    def rec(i):
        if i in memo:
            return memo[i]
        m = trs_matrix(nodes[i])
        p = par.get(i)
        if p is not None:
            pm = rec(p)
            m = pm @ m
        memo[i] = m
        return m

    return {i: rec(i) for i in range(len(nodes))}


def set_trs(node, m):
    """write a 4x4 (row-vector convention) matrix onto a glTF node as TRS"""
    node.pop("matrix", None)
    t = m[:3, 3].tolist()
    cols = [m[:3, i] for i in range(3)]
    s = [float(np.linalg.norm(c)) for c in cols]
    r = np.zeros((3, 3))
    for i in range(3):
        r[:, i] = cols[i] / s[i] if s[i] > 1e-12 else cols[i]
    q = mat2q(r)
    node["translation"] = [float(v) for v in t]
    node["rotation"] = [float(v) for v in qnorm(q)]
    node["scale"] = [float(v) for v in s]


def fit_mesh_bounds(g, bin_):
    """Rewrite each skinned mesh node's transform so that Box3.setFromObject()
    reports the box the model really draws at.

    glTF says a skinned mesh ignores its own node transform - the inverse-bind
    matrices already carry the whole placement - and three.js implements exactly
    that, so the transform cancels out of the render.  Box3.setFromObject() knows
    nothing about skinning though and measures the raw geometry through that same
    transform.  These downloads all store their geometry in a different space
    from the one they draw in, so the measured height came out anywhere between
    0.02x and 4.2x the truth, and the game - which normalises the actor by that
    number - would have sized most of the kaiju wrong (Baltan by a factor of 70).

    Because the transform is render-neutral it is free, so each mesh node gets the
    axis-aligned map that carries its geometry box onto its skinned box.  The
    measurement the game takes then matches the pixels, and nothing visibly moves.
    """
    skins = g.get("skins") or []
    if not skins:
        return False
    world = world_rest_pos(g)
    par = parent_map(g)

    skin_nodes = {}
    for ni, node in enumerate(g["nodes"]):
        if "mesh" in node and "skin" in node:
            skin_nodes.setdefault(node["skin"], []).append(ni)
    if not skin_nodes:
        return False

    fitted = False
    for si, nodes in skin_nodes.items():
        skin = skins[si]
        joints = skin["joints"]
        ibms = read_accessor(g, bin_, skin["inverseBindMatrices"])
        xf = np.zeros((len(joints), 4, 4))
        for i, (j, m) in enumerate(zip(joints, ibms)):
            xf[i] = world[j].dot(np.array(m, dtype=float).reshape(4, 4).T)

        raw_lo = np.array([1e30] * 3)
        raw_hi = np.array([-1e30] * 3)
        vis_lo = np.array([1e30] * 3)
        vis_hi = np.array([-1e30] * 3)
        for ni in nodes:
            for prim in g["meshes"][g["nodes"][ni]["mesh"]]["primitives"]:
                attrs = prim["attributes"]
                if "POSITION" not in attrs:
                    continue
                pos = np.array(read_accessor(g, bin_, attrs["POSITION"]),
                               dtype=float).reshape(-1, 3)
                raw_lo = np.minimum(raw_lo, pos.min(0))
                raw_hi = np.maximum(raw_hi, pos.max(0))
                if "JOINTS_0" not in attrs or "WEIGHTS_0" not in attrs:
                    continue
                jn = np.array(read_accessor(g, bin_, attrs["JOINTS_0"])).reshape(-1, 4).astype(int)
                wt = np.array(read_accessor(g, bin_, attrs["WEIGHTS_0"]),
                              dtype=float).reshape(-1, 4)
                ph = np.concatenate([pos, np.ones((len(pos), 1))], 1)
                out = np.zeros((len(pos), 4))
                for k in range(4):
                    out += wt[:, k:k + 1] * np.einsum("nij,nj->ni", xf[jn[:, k]], ph)
                w = out[:, 3:4]
                out = out[:, :3] / np.where(np.abs(w) < 1e-9, 1.0, w)
                vis_lo = np.minimum(vis_lo, out.min(0))
                vis_hi = np.maximum(vis_hi, out.max(0))
        if raw_lo[0] > raw_hi[0] or vis_lo[0] > vis_hi[0]:
            continue

        scale = (vis_hi - vis_lo) / np.maximum(raw_hi - raw_lo, 1e-9)
        fit = np.eye(4)
        fit[:3, :3] = np.diag(scale)
        fit[:3, 3] = vis_lo - scale * raw_lo
        for ni in nodes:
            p = par.get(ni)
            local = np.linalg.inv(world[p]).dot(fit) if p is not None else fit
            set_trs(g["nodes"][ni], local)
        fitted = True
    return fitted


def bone_dir(g, node, wpos):
    """world-space direction a bone points in its rest pose (towards its child)"""
    ch = g["nodes"][node].get("children", [])
    if ch:
        v = wpos[ch[0]][:3, 3] - wpos[node][:3, 3]
    else:
        v = wpos[node][:3, :3].dot(np.array([0.0, 1.0, 0.0]))
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else np.array([0.0, 1.0, 0.0])


def channel_data(g, bin_, anim):
    """(node, path) -> (times[], values[])"""
    out = {}
    for ch in anim.get("channels", []):
        s = anim["samplers"][ch["sampler"]]
        tgt = ch["target"]
        t = [v[0] for v in read_accessor(g, bin_, s["input"])]
        v = read_accessor(g, bin_, s["output"])
        out[(tgt["node"], tgt["path"])] = (t, v)
    return out


def sample(times, values, t):
    """slerp for VEC4, linear for VEC3"""
    if t <= times[0]:
        return np.array(values[0], dtype=float)
    if t >= times[-1]:
        return np.array(values[-1], dtype=float)
    lo, hi = 0, len(times) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if times[mid] <= t:
            lo = mid
        else:
            hi = mid
    span = times[hi] - times[lo]
    f = 0.0 if span <= 1e-9 else (t - times[lo]) / span
    a = np.array(values[lo], dtype=float)
    b = np.array(values[hi], dtype=float)
    if len(a) == 4:
        return qslerp(a, b, f)
    return a + (b - a) * f


# --------------------------------------------------------------------------
# building
# --------------------------------------------------------------------------
def bbox_height(g):
    lo, hi = 1e9, -1e9
    for m in g.get("meshes", []):
        for p in m.get("primitives", []):
            a = g["accessors"][p["attributes"]["POSITION"]]
            if "min" in a and "max" in a:
                lo = min(lo, a["min"][1])
                hi = max(hi, a["max"][1])
    return max(1e-6, hi - lo)


def load_map(path):
    """Read a bone map from JSON.

        {"hips": ["Hips", "mixamorig:Hips"], "spine": ["Abdomen", "Spine"], ...}
        {"hips": {"src": "Hips", "dst": "mixamorig:Hips"}, ...}
    """
    raw = json.load(open(path))
    out = {}
    for slot, v in raw.items():
        out[slot] = (v["src"], v["dst"]) if isinstance(v, dict) else (v[0], v[1])
    return out


def build(key, src_glb=SRC_GLB, verbose=False, model=None, mapping=None, out_dir=None):
    model = model or os.path.join(SF, key + ".glb")
    if not os.path.exists(model):
        raise SystemExit("no model at %s — drop a .glb there or pass --model" % model)
    if mapping is None:
        mapping = MAPS.get(key)
    if mapping is None:
        raise SystemExit("no bone map for %r — pass --map bones.json "
                         "(--list shows the built-in ones)" % key)

    sg, sbin = load_glb(src_glb)
    dg, dbin = load_glb(model)

    fitted = fit_mesh_bounds(dg, dbin)

    s_name, s_joints = joint_info(sg)
    d_name, d_joints = joint_info(dg)
    if not d_joints:
        raise SystemExit("%s has no skin; cannot retarget" % key)

    s_par, d_par = parent_map(sg), parent_map(dg)
    s_rest = world_rest_rot(sg)
    d_rest = world_rest_rot(dg)
    s_wpos = world_rest_pos(sg)
    d_wpos = world_rest_pos(dg)

    def dst_node(spec):
        """a model bone is named, or pinned by node index as '#<n>'"""
        if isinstance(spec, str) and spec.startswith("#"):
            n = int(spec[1:])
            want = JAMILA_CHECK.get(spec)
            if want is not None:
                got = d_wpos[n][:3, 3]
                if abs(got[0] - want[0]) > 0.02 or abs(got[1] - want[1]) > 0.02:
                    raise SystemExit(
                        "%s: node %d is at (%.3f, %.3f), expected (%.3f, %.3f) - "
                        "the model changed, re-derive the bone map"
                        % (key, n, got[0], got[1], want[0], want[1]))
            return n
        return d_name.get(spec)

    # resolve each slot to (srcNode, dstNode)
    resolved = {}
    problems = []
    for slot in CHAIN:
        if slot not in mapping:
            continue
        s_bone, d_bone = mapping[slot]
        if s_bone not in s_name:
            problems.append("src bone missing: %s/%s" % (slot, s_bone))
            continue
        n = dst_node(d_bone)
        if n is None:
            problems.append("dst bone missing: %s/%s" % (slot, d_bone))
            continue
        resolved[slot] = (s_name[s_bone], n)
    if problems:
        for p in problems:
            print("  !", p)
        raise SystemExit("%s: %d unmapped bone(s)" % (key, len(problems)))

    k = bbox_height(dg) / bbox_height(sg)   # informational only
    # The two rigs are almost never authored in the same rest pose (the game rig
    # rests with arms down, most Sketchfab kaiju rest in a T-pose).  Transferring
    # only the "deviation from rest" would leave a T-posed model's arms stuck out,
    # so each bone also gets a constant swing that takes its own rest direction
    # onto the source rest direction.  A swing (shortest arc) carries no roll, so
    # the model keeps its own up-axis and facing.
    ALIGN = os.environ.get("RETARGET_ALIGN", "1") != "0"
    align = {}
    for slot, (sn, dn) in resolved.items():
        if not ALIGN:
            align[dn] = np.array([0.0, 0.0, 0.0, 1.0])
            continue
        align[dn] = qarc(bone_dir(dg, dn, d_wpos), bone_dir(sg, sn, s_wpos))

    # src world rotation at time t, sampled straight off the source hierarchy
    def src_world(node, chans, t, memo):
        if node in memo:
            return memo[node]
        ch = chans.get((node, "rotation"))
        local = sample(ch[0], ch[1], t) if ch else local_rot_q(sg["nodes"][node])
        p = s_par.get(node)
        q = qmul(src_world(p, chans, t, memo), local) if p is not None else local
        memo[node] = q
        return q

    # dst animated world rotation: mapped bones follow the source motion,
    # unmapped scaffolding keeps its rest local rotation
    def dst_world(node, chans, t, memo):
        if node in memo:
            return memo[node]
        for slot, (sn, dn) in resolved.items():
            if dn == node:
                dev = qmul(src_world(sn, chans, t, {}), qconj(s_rest[sn]))
                q = qmul(qmul(dev, align[dn]), d_rest[dn])
                memo[node] = q
                return q
        local = local_rot_q(dg["nodes"][node])
        p = d_par.get(node)
        q = qmul(dst_world(p, chans, t, memo), local) if p is not None else local
        memo[node] = q
        return q

    anims = []
    for clip in sg.get("animations", []):
        chans = channel_data(sg, sbin, clip)

        # one shared time base: every key any mapped bone uses in this clip
        times = set()
        for slot, (sn, dn) in resolved.items():
            ch = chans.get((sn, "rotation"))
            if ch:
                times.update(ch[0])
        times = sorted(times)
        if len(times) < 2:
            continue

        tracks = []
        for slot, (sn, dn) in resolved.items():
            vals = []
            for t in times:
                memo = {}
                wb = dst_world(dn, chans, t, memo)
                p = d_par.get(dn)
                wp = dst_world(p, chans, t, {}) if p is not None else np.array([0.0, 0.0, 0.0, 1.0])
                vals.append(qmul(qconj(wp), wb))
            tracks.append((dn, "rotation", vals))

        anims.append((clip.get("name", "clip"), times, tracks))

    if not anims:
        raise SystemExit("nothing to retarget")

    # ---- write the new accessors into the destination buffer ----
    def put(values, typ, n, as_float=True):
        nonlocal dbin
        while len(dbin) % 4:
            dbin.append(0)
        off = len(dbin)
        flat = []
        for v in values:
            flat.extend(v if hasattr(v, "__len__") else [v])
        dbin.extend(struct.pack("<%d%s" % (len(flat), "f" if as_float else "I"), *flat))
        dg["bufferViews"].append({"buffer": 0, "byteOffset": off,
                                  "byteLength": len(flat) * (4 if as_float else 4)})
        mn = [min(float(v[i]) for v in values) for i in range(n)]
        mx = [max(float(v[i]) for v in values) for i in range(n)]
        dg["accessors"].append({"bufferView": len(dg["bufferViews"]) - 1,
                                "componentType": 5126 if as_float else 5125,
                                "count": len(values), "type": typ,
                                "min": mn, "max": mx})
        return len(dg["accessors"]) - 1

    dg.setdefault("animations", [])
    for name, times, tracks in anims:
        tin = put([[t] for t in times], "SCALAR", 1)
        samplers, channels = [], []
        for node, path, vals in tracks:
            if path == "rotation":
                acc = put([list(qnorm(v)) for v in vals], "VEC4", 4)
            else:
                acc = put([list(v) for v in vals], "VEC3", 3)
            samplers.append({"input": tin, "interpolation": "LINEAR", "output": acc})
            channels.append({"sampler": len(samplers) - 1,
                             "target": {"node": node, "path": path}})
        dg["animations"].append({"name": name, "samplers": samplers, "channels": channels})

    dg["buffers"][0]["byteLength"] = len(dbin)
    while len(dbin) % 4:
        dbin.append(0)

    js = json.dumps(dg, separators=(",", ":")).encode("utf-8")
    while len(js) % 4:
        js += b" "
    total = 12 + 8 + len(js) + 8 + len(dbin)
    out = bytearray()
    out += b"glTF" + struct.pack("<II", 2, total)
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(dbin), 0x004E4942) + bytes(dbin)
    os.makedirs(out_dir or OUT, exist_ok=True)
    dest = os.path.join(out_dir or OUT, "kaiju-%s.glb" % key)
    open(dest, "wb").write(bytes(out))

    return {
        "key": key,
        "tris": sum(dg["accessors"][p["indices"]]["count"] // 3
                    for m in dg.get("meshes", []) for p in m["primitives"] if "indices" in p),
        "clips": [a[0] for a in anims],
        "mapped": len(resolved),
        "missing": len([s for s in CHAIN if s in mapping]) - len(resolved),
        "seconds": [round(a[1][-1], 2) for a in anims],
        "bytes": total,
        "size_ratio_k": round(k, 4),
        "problems": problems,
        "boundsFit": fitted,
        "dest": dest,
    }


def main():
    import argparse
    import shutil

    ap = argparse.ArgumentParser(
        prog="retarget.py",
        description="Retarget the game's clip set onto another model's own skeleton.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  retarget.py --list                       # the ten bone maps that ship here
  retarget.py zetton                        # tools/models/zetton.glb -> out/
  retarget.py --model ~/dl/kaiju.glb --map my-bones.json --install
  retarget.py bull --no-align               # keep the model's own rest pose
""")
    ap.add_argument("key", nargs="?", help="name of a built-in bone map (also the output name)")
    ap.add_argument("--model", help="the .glb to retarget onto (default tools/models/<key>.glb)")
    ap.add_argument("--map", dest="mapfile", help="JSON bone map, overrides the built-in one")
    ap.add_argument("--out", help="output directory (default tools/out)")
    ap.add_argument("--install", action="store_true",
                    help="copy the result into assets/models/kaiju-<key>.glb")
    ap.add_argument("--no-align", action="store_true",
                    help="do not swing each bone onto the source rest pose")
    ap.add_argument("--list", action="store_true", help="list the built-in bone maps")
    args = ap.parse_args()

    if args.no_align:
        os.environ["RETARGET_ALIGN"] = "0"

    if args.list or not (args.key or args.model):
        print("built-in bone maps (tools/models/<name>.glb):")
        for k in sorted(MAPS):
            print("   %-10s %2d slots  %s" % (k, len(MAPS[k]),
                                              "pinned by node index" if any(
                                                  isinstance(v[1], str) and v[1].startswith("#")
                                                  for v in MAPS[k].values()) else "mapped by name"))
        print("\nsource clips: %s" % SRC_GLB)
        return 0

    key = args.key or os.path.splitext(os.path.basename(args.model))[0]
    mapping = load_map(args.mapfile) if args.mapfile else None

    r = build(key, model=args.model, mapping=mapping, out_dir=args.out, verbose=True)
    print("%-10s %6d tris  %2d bones  %2d clips  %5.1f MB  k=%s  %s%s" % (
        r["key"], r["tris"], r["mapped"], len(r["clips"]),
        r["bytes"] / 1048576, r["size_ratio_k"], "OK" if not r["problems"] else "!!",
        "" if r["boundsFit"] else "  (no skinned bounds fit)"))
    if r["problems"]:
        for p in r["problems"]:
            print("      ", p)
    print("       clips:", ", ".join(r["clips"]))

    if args.install:
        shutil.copy2(r["dest"], os.path.join(INSTALL, "kaiju-%s.glb" % key))
        print("       installed -> %s" % os.path.join(INSTALL, "kaiju-%s.glb" % key))
    return 0


if __name__ == "__main__":
    sys.exit(main())

