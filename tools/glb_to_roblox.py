#!/usr/bin/env python3
"""glb_to_roblox.py - take a rigged .glb to Roblox as pure Luau.

Roblox cannot load a .glb at runtime.  What it *can* do is run Luau, so this
tool bakes the two things a rig actually needs - the skeleton and the animation
- into Luau modules the engine can read:

    <out>/Rig.luau        one part per bone: parent, rest CFrame, part size
    <out>/clips/NAME.luau one file per clip: keyframes of the *delta from rest*

Playback is then a loop of `part.CFrame = parentCFrame * rest * delta`, which
means the game needs no mesh upload, no KeyframeSequence and no Animator to put
a creature on screen.  It also means the same clip data can drive a real
skinned mesh later: import your .glb in Studio, let Roblox's Animation Clip
Editor build the KeyframeSequences, and swap in that rig.

Two things this deliberately does *not* do:

  * retarget.  The rig it emits is generated from the source skeleton, so the
    rest pose matches by construction and no motion transfer is needed.  Use
    tools/retarget.py first if you want to move a clip set between rigs.
  * guess your intent about root motion.  Horizontal root translation is
    stripped by default, because the game moves the character and the clip
    would otherwise fight it.  `--root-motion keep` turns that off.

Usage:
    glb_to_roblox.py model.glb --report
    glb_to_roblox.py model.glb --out roblox/src/shared
    glb_to_roblox.py model.glb --out out/ --fps 30 --max-joints 30
    glb_to_roblox.py model.glb --out out/ --prune 'finger|thumb|_ik'

`--report` is the one to run first: it checks the file against the budgets
Roblox actually enforces, so you find out about a 40k-triangle hero before you
spend an afternoon on it.
"""

import argparse
import json
import math
import os
import re
import struct
import sys

# 1 metre = 3.5714 studs (Roblox documents a stud as 0.28 m).  A 1.75 m
# character therefore lands at ~6.25 studs, which is where Roblox's own R15
# avatar sits - so a rig generated from a real-world-scaled model arrives at a
# believable size without anyone touching a scale box.
STUDS_PER_METRE = 1.0 / 0.28

NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
        5125: ("I", 4), 5126: ("f", 4)}
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

# the budgets Roblox enforces at import/publish time, from
# create.roblox.com/docs/art/modeling/specifications and
# create.roblox.com/docs/avatar/character-bodies/specifications
LIMIT_TRIS = 20000
LIMIT_INFLUENCES = 4
LIMIT_TEXTURE = 1024


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
        if ctype == JSON_CHUNK:
            g = json.loads(chunk.decode("utf-8"))
        elif ctype == BIN_CHUNK:
            bin_ = chunk
        off += clen
    if g is None:
        raise SystemExit("%s: no JSON chunk" % path)
    return g, bin_


def read_accessor(g, bin_, idx):
    acc = g["accessors"][idx]
    n = NCOMP[acc["type"]]
    fmt, size = COMP[acc["componentType"]]
    bv = g["bufferViews"][acc["bufferView"]]
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or n * size
    out = []
    for i in range(acc["count"]):
        out.append(struct.unpack_from("<" + fmt * n, bin_, base + i * stride))
    return out


def parent_map(g):
    par = {}
    for i, nd in enumerate(g.get("nodes", [])):
        for c in nd.get("children", []):
            par[c] = i
    return par


# --------------------------------------------------------------------------
# small quaternion / matrix helpers, no numpy needed for this path
# --------------------------------------------------------------------------
def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qconj(q):
    return (-q[0], -q[1], -q[2], q[3])


def qnorm(q):
    n = math.sqrt(sum(float(v) * v for v in q))
    return tuple(v / n for v in q) if n > 1e-12 else (0.0, 0.0, 0.0, 1.0)


def qmat(q):
    """quaternion -> 3x3 row-major matrix, v_world = M @ v_local"""
    x, y, z, w = q
    return ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
            (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
            (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))


def mat3_quat(m):
    t = m[0][0] + m[1][1] + m[2][2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = ((m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s,
             (m[1][0] - m[0][1]) / s, 0.25 * s)
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2
        q = (0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s,
             (m[2][1] - m[1][2]) / s)
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2
        q = ((m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s,
             (m[0][2] - m[2][0]) / s)
    else:
        s = math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2
        q = ((m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s,
             (m[1][0] - m[0][1]) / s)
    return qnorm(q)


def mv(m, v):
    return (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2])


def vslen(v):
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def qslerp(a, b, t):
    d = sum(a[i] * b[i] for i in range(4))
    if d < 0:
        b = tuple(-v for v in b)
        d = -d
    if d > 0.9995:
        return qnorm(tuple(a[i] + (b[i] - a[i]) * t for i in range(4)))
    th = math.acos(max(-1.0, min(1.0, d)))
    s = math.sin(th)
    wa, wb = math.sin((1 - t) * th) / s, math.sin(t * th) / s
    return (a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb,
            a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb)


def qaxis(axis, ang):
    h = ang * 0.5
    s = math.sin(h)
    return (axis[0] * s, axis[1] * s, axis[2] * s, math.cos(h))


# --------------------------------------------------------------------------
# reading the model
# --------------------------------------------------------------------------
def local_rot(node):
    if "matrix" in node:
        m = node["matrix"]
        return mat3_quat(((m[0], m[4], m[8]), (m[1], m[5], m[9]), (m[2], m[6], m[10])))
    return qnorm(node.get("rotation", [0, 0, 0, 1]))


def local_pos(node):
    if "matrix" in node:
        m = node["matrix"]
        return (m[12], m[13], m[14])
    return tuple(node.get("translation", [0, 0, 0]))


def tri_counts(g):
    """[(mesh name, triangles)] - Roblox budgets a mesh, not a file"""
    out = []
    for m in g.get("meshes", []):
        n = 0
        for p in m.get("primitives", []):
            if "indices" in p:
                n += g["accessors"][p["indices"]]["count"] // 3
            elif "POSITION" in p.get("attributes", {}):
                n += g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
        out.append((m.get("name") or "mesh", n))
    return out


def influence_stats(g, bin_):
    """(max influences per vertex, vertices using more than Roblox allows)"""
    worst, over = 0, 0
    for m in g.get("meshes", []):
        for p in m.get("primitives", []):
            attrs = p.get("attributes", {})
            if "WEIGHTS_0" not in attrs:
                continue
            for w in read_accessor(g, bin_, attrs["WEIGHTS_0"]):
                n = sum(1 for v in w if v > 1e-4)
                worst = max(worst, n)
                if n > LIMIT_INFLUENCES:
                    over += 1
    return worst, over


def _png_size(d):
    if len(d) > 24 and d[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", d[16:24])
    return None


def _jpeg_size(d):
    if d[:2] != b"\xff\xd8":
        return None
    i = 2
    while i < len(d) - 9:
        if d[i] != 0xFF:
            i += 1
            continue
        m = d[i + 1]
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        ln = struct.unpack(">H", d[i + 2:i + 4])[0]
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", d[i + 5:i + 9])
            return w, h
        i += 2 + ln
    return None


def image_sizes(g, bin_):
    out = []
    for i, img in enumerate(g.get("images", [])):
        bv = img.get("bufferView")
        if bv is None:
            out.append((img.get("name") or "image%d" % i, 0, 0, "", 0))
            continue
        b = g["bufferViews"][bv]
        off = b.get("byteOffset", 0)
        d = bytes(bin_[off:off + b["byteLength"]])
        wh = _png_size(d) or _jpeg_size(d) or (0, 0)
        out.append((img.get("name") or "image%d" % i, wh[0], wh[1],
                    img.get("mimeType", ""), len(d)))
    return out


def joint_mass(g, bin_):
    """joint node -> total skin weight, used to decide what to keep"""
    mass = {}
    for m in g.get("meshes", []):
        for p in m.get("primitives", []):
            attrs = p.get("attributes", {})
            if "JOINTS_0" not in attrs or "WEIGHTS_0" not in attrs:
                continue
            for jt, w in zip(read_accessor(g, bin_, attrs["JOINTS_0"]),
                             read_accessor(g, bin_, attrs["WEIGHTS_0"])):
                for k in range(len(jt)):
                    if w[k] > 1e-4:
                        mass[jt[k]] = mass.get(jt[k], 0.0) + w[k]
    return mass


def channel_data(g, bin_, anim):
    """(node, path) -> (times[], values[])"""
    out = {}
    for ch in anim.get("channels", []):
        s = anim["samplers"][ch["sampler"]]
        tgt = ch["target"]
        out[(tgt["node"], tgt["path"])] = (
            [v[0] for v in read_accessor(g, bin_, s["input"])],
            read_accessor(g, bin_, s["output"]))
    return out


def sample(times, values, t):
    if t <= times[0]:
        return values[0]
    if t >= times[-1]:
        return values[-1]
    lo, hi = 0, len(times) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if times[mid] <= t:
            lo = mid
        else:
            hi = mid
    span = times[hi] - times[lo]
    f = 0.0 if span <= 1e-9 else (t - times[lo]) / span
    a, b = values[lo], values[hi]
    if len(a) == 4:
        return qslerp(tuple(a), tuple(b), f)
    return tuple(a[i] + (b[i] - a[i]) * f for i in range(len(a)))


# --------------------------------------------------------------------------
# choosing the joints that become parts
# --------------------------------------------------------------------------
def pick_joints(g, bin_, max_joints, prune_re, verbose):
    """skin joints, thinned to `max_joints` by dropping the least influential
    leaf over and over.

    Only leaves are ever dropped, and a leaf has no descendants, so every joint
    that survives still has all of its ancestors.  That is what makes the
    result safe: a kept bone's local transform is still expressed relative to a
    kept parent, so nothing needs to be composed and no motion is lost from the
    chain above it.

    Cosmetic chains (fingers, toe tips, IK markers) go first, tips inward, then
    whatever is still over budget loses its most distal, least-used leaf.
    """
    par = parent_map(g)
    skin = (g.get("skins") or [{}])[0]
    joints = list(skin.get("joints", []))
    name = {i: (g["nodes"][i].get("name") or "node%d" % i) for i in joints}
    kept = set(joints)
    depth = {}
    for i in joints:
        d, n = 0, i
        while par.get(n) is not None:
            n = par[n]
            d += 1
        depth[i] = d

    def children_in(i):
        return [c for c in g["nodes"][i].get("children", []) if c in kept]

    def leaves():
        return [i for i in kept if not children_in(i)]

    dropped = []
    if prune_re:
        rx = re.compile(prune_re, re.I)
        changed = True
        while changed:
            changed = False
            for i in list(kept):
                if len(kept) > 1 and not children_in(i) and rx.search(name[i]):
                    kept.discard(i)
                    dropped.append(i)
                    changed = True

    mass = joint_mass(g, bin_)
    while len(kept) > max_joints:
        cand = leaves()
        if len(cand) <= 1:
            break
        # least skin influence first; ties go to the most distal bone, so a
        # weightless fingertip leaves before a weightless head does
        drop = min(cand, key=lambda i: (mass.get(i, 0.0), -depth[i]))
        kept.discard(drop)
        dropped.append(drop)

    if verbose and dropped:
        print("   thinned %d -> %d joints (dropped: %s)"
              % (len(joints), len(kept),
                 ", ".join(name[i] for i in dropped[:10])
                 + (" …" if len(dropped) > 10 else "")))

    # topological order: parent before child
    order = []

    def walk(i):
        if i not in kept or i in order:
            return
        order.append(i)
        for c in g["nodes"][i].get("children", []):
            walk(c)

    roots = [i for i in joints if par.get(i) not in kept]
    for r in roots:
        walk(r)
    for i in joints:
        walk(i)

    return order, kept, name


def local_trs(node):
    """(quaternion, position, scale) of a node, matrix or TRS alike"""
    if "matrix" in node:
        m = node["matrix"]
        cols = ((m[0], m[1], m[2]), (m[4], m[5], m[6]), (m[8], m[9], m[10]))
        s = tuple(vslen(c) for c in cols)
        r = tuple(tuple(cols[j][i] / (s[j] or 1.0) for j in range(3)) for i in range(3))
        return mat3_quat(r), (m[12], m[13], m[14]), s
    return (qnorm(node.get("rotation", [0, 0, 0, 1])),
            tuple(node.get("translation", [0, 0, 0])),
            tuple(node.get("scale", [1, 1, 1])))


def world_rest(g):
    """node -> (quaternion, position in metres, accumulated scale)

    Node scale is carried through rather than ignored, because rigs exported
    from Blender very often keep their real size on the armature node and leave
    the bones in a hundredth-scale space.  Read the bones without that scale and
    the creature arrives 100x too small with invisible limbs.
    """
    par = parent_map(g)
    memo = {}

    def rec(i):
        if i in memo:
            return memo[i]
        lq, lp, ls = local_trs(g["nodes"][i])
        p = par.get(i)
        if p is None:
            r = (lq, lp, ls)
        else:
            pq, pp, ps = rec(p)
            t = tuple(lp[k] * ps[k] for k in range(3))
            r = (qmul(pq, lq),
                 tuple(pp[k] + mv(qmat(pq), t)[k] for k in range(3)),
                 tuple(ps[k] * ls[k] for k in range(3)))
        memo[i] = r
        return r

    for i in range(len(g.get("nodes", []))):
        rec(i)
    return memo, par


def local_from_world(a, b):
    """b's frame relative to a's: (quaternion, position)"""
    aq, ap, _ = a
    bq, bp, _ = b
    return (qnorm(qmul(qconj(aq), bq)),
            mv(tuple(zip(*qmat(aq))), tuple(bp[k] - ap[k] for k in range(3))))


# --------------------------------------------------------------------------
# building the rig + clip tables
# --------------------------------------------------------------------------
def build_rig(g, W, par, order, kept, names, scale, yaw):
    """one entry per kept joint: rest local frame, part size, mid-bone offset"""
    joints = []
    index = {n: i for i, n in enumerate(order)}
    pscale = {}

    # a joint's "primary child" gives it a length and a direction to point at
    for i, node in enumerate(order):
        kids = [c for c in g["nodes"][node].get("children", []) if c in kept]
        pnode = par.get(node)
        parent = index[pnode] if pnode in index else None
        # how many metres one unit of this joint's local translation is worth
        pscale[node] = max(W[pnode][2]) if pnode is not None else 1.0

        if parent is None:
            # the root advertises the model's own ground frame, so the game can
            # place the rig at a spawn point and forget about Blender's axes
            wq, wp, _ = W[node]
            q = qnorm(qmul(qaxis((0, 1, 0), math.radians(yaw)), wq))
            p = wp
        else:
            q, p = local_from_world(W[pnode], W[node])

        if parent is None:
            # the root is the rig's pivot, not a limb: mark it so the runtime
            # skips drawing a block for it and just uses it as the model frame
            girth = 0.16
            joints.append({
                "name": names[node],
                "parent": None,
                "rest": (q, tuple(v * scale for v in p)),
                "size": (girth * scale,) * 3,
                "dir": (0.0, 1.0, 0.0),
                "len": 0.0,
                "pivot": True,
            })
            continue

        plen, pd = 0.0, (0.0, 0.0, 1.0)
        if kids:
            # the longest child bone is the one the limb visually runs along
            spans = [(c, local_from_world(W[node], W[c])[1]) for c in kids]
            best, cd = max(spans, key=lambda kv: vslen(kv[1]))
            plen = vslen(cd)
            if plen > 1e-5:
                pd = tuple(v / plen for v in cd)
        if plen < 1e-5:
            plen = 0.12

        girth = max(0.16, min(0.62, plen * 0.36))
        joints.append({
            "name": names[node],
            "parent": parent,
            "rest": (q, tuple(v * scale for v in p)),
            "size": (girth * scale, max(plen * scale, 0.06), girth * scale),
            "dir": pd,                       # bone direction, in the joint frame
            "len": plen * scale,
        })
    return joints, pscale


def rig_extent(joints):
    """(height in studs, lowest Y) of the rest pose, for a sanity check"""
    world = []
    for j in joints:
        q, p = j["rest"]
        if j["parent"] is None:
            world.append((q, p))
        else:
            pq, pp = world[j["parent"]]
            world.append((qmul(pq, q),
                          tuple(pp[k] + mv(qmat(pq), p)[k] for k in range(3))))
    ys = [p[1] for _, p in world]
    return max(ys) - min(ys), min(ys)


def build_clips(g, bin_, W, pscale, order, kept, scale, fps, root_motion,
                eps_q, eps_p, loop_rx, verbose):
    index = {n: i for i, n in enumerate(order)}
    out = {}
    best = (0.0, (0.0, 0.0, -1.0))
    for anim in g.get("animations", []):
        data = channel_data(g, bin_, anim)
        dur = 0.0
        for s in anim.get("samplers", []):
            acc = g["accessors"][s["input"]]
            if "max" in acc:
                dur = max(dur, float(acc["max"][0]))
        if dur <= 0:
            continue
        nkeys = max(2, int(round(dur * fps)) + 1)
        ts = [dur * k / (nkeys - 1) for k in range(nkeys)]
        # root motion is authored in the root bone's own frame, which is rarely
        # world-aligned (Blender rigs sit 90 degrees off), so stripping the
        # horizontal component has to be done in world axes and converted back
        qroot = W[order[0]][0] if order else (0.0, 0.0, 0.0, 1.0)
        rroot = qmat(qroot)
        rroot_t = tuple(zip(*rroot))

        travel = None
        channels = {}
        for node in kept:
            j = index[node]
            rest_q, rest_p = local_rot(g["nodes"][node]), local_pos(g["nodes"][node])
            rot = data.get((node, "rotation"))
            tra = data.get((node, "translation"))
            if rot is None and tra is None:
                continue
            qs, ps = [], []
            for t in ts:
                aq = sample(rot[0], rot[1], t) if rot else rest_q
                ap = sample(tra[0], tra[1], t) if tra else rest_p
                dq = qnorm(qmul(qconj(rest_q), tuple(aq)))
                dp = mv(qmat(rest_q), tuple(ap[k] - rest_p[k] for k in range(3)))
                # local translation is measured in the parent's units
                dp = tuple(v * pscale[node] for v in dp)
                if j == 0:
                    # how far the clip walks the model, before any stripping:
                    # whichever way the feet carry it is the way it faces
                    if travel is None:
                        travel = [list(dp), list(dp)]
                    travel[1] = list(dp)
                if j == 0 and root_motion != "keep":
                    w = mv(rroot, dp)
                    w = (0.0, w[1], 0.0) if root_motion == "strip" else (0.0, 0.0, 0.0)
                    dp = mv(rroot_t, w)
                qs.append(dq)
                ps.append(tuple(v * scale for v in dp))

            # keep quaternions on one hemisphere so slerp takes the short way
            for k in range(1, len(qs)):
                if sum(qs[k][i] * qs[k - 1][i] for i in range(4)) < 0:
                    qs[k] = tuple(-v for v in qs[k])

            rot_moves = any(sum(abs(qs[k][i] - qs[0][i]) for i in range(4)) > 1e-4
                            for k in range(len(qs)))
            pos_moves = any(vslen(tuple(ps[k][i] - ps[0][i] for i in range(3))) > eps_p
                            for k in range(len(ps)))
            if not rot_moves and not pos_moves:
                continue                       # static channel, say nothing

            keep = reduce_keys(ts, qs, ps, eps_q, eps_p) if rot_moves or pos_moves else [0]
            ch = {"t": [ts[k] for k in keep], "q": [qs[k] for k in keep]}
            if pos_moves:
                ch["p"] = [ps[k] for k in keep]
            channels[j] = ch

        out[anim.get("name") or "clip%d" % len(out)] = {
            "loop": bool(loop_rx.search(anim.get("name") or "")),
            "duration": dur,
            "channels": channels,
        }
        if travel:
            # a displacement in the root bone's frame: bring it into model space
            # (world axes at rest) and drop the vertical, which is what is left
            # is the direction the clips carry the model - i.e. which way it faces
            d = (travel[1][0] - travel[0][0], travel[1][1] - travel[0][1],
                 travel[1][2] - travel[0][2])
            w = mv(rroot, d)
            w = (w[0], 0.0, w[2])
            if vslen(w) > best[0]:
                best = (vslen(w), w)
        if verbose:
            n = sum(len(c["t"]) for c in channels.values())
            print("   %-24s %5.2fs  %2d joints  %4d keys  %s"
                  % (anim.get("name"), dur, len(channels), n,
                     "loop" if out[anim.get("name")]["loop"] else "once"))
    fwd = best[1]
    if vslen(fwd) > 1e-6:
        fwd = tuple(v / vslen(fwd) for v in fwd)
    else:
        fwd = (0.0, 0.0, -1.0)
    return out, fwd, best[0] > 1e-6


def reduce_keys(ts, qs, ps, eps_q, eps_p):
    """drop keys a straight interpolation between its neighbours already hits.

    Clips come out of a DCC at whatever rate the author used, which is far more
    keys than a game needs and is the whole reason these tables are 400 KB
    instead of 40 KB.  Greedy: walk forward, swallow every key that stays
    within tolerance of the segment from the last kept key.
    """
    n = len(ts)
    if n <= 2:
        return list(range(n))

    def err(i, j):
        span = ts[j] - ts[i]
        e = 0.0
        for k in range(i + 1, j):
            f = 0.0 if span <= 1e-9 else (ts[k] - ts[i]) / span
            q = qslerp(qs[i], qs[j], f)
            e = max(e, sum(abs(q[c] - qs[k][c]) for c in range(4)) / eps_q)
            for c in range(3):
                e = max(e, abs((ps[i][c] + (ps[j][c] - ps[i][c]) * f) - ps[k][c]) / eps_p)
        return e

    keep = [0]
    i = 0
    while i < n - 1:
        j = i + 1
        while j + 1 < n and err(i, j + 1) <= 1.0:
            j += 1
        keep.append(j)
        i = j
    return keep


# --------------------------------------------------------------------------
# writing Luau
# --------------------------------------------------------------------------
def num(v, dp=3):
    s = "%.*f" % (dp, v)
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    if s in ("-0", ""):
        s = "0"
    return s


def vec(v, dp=3):
    return "{" + ", ".join(num(x, dp) for x in v) + "}"


def lua_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return json.dumps(v)
    return num(v, 4)


def lua_table(d):
    return "{" + ", ".join("%s = %s" % (k, lua_value(v)) for k, v in d.items()) + "}"


def frames(tpl, dp=3):
    return "{" + ", ".join(num(x, dp) for x in tpl) + "}"


def write_rig(path, joints, source, scale, opts, forward, height):
    lines = []
    lines.append("--!nonstrict")
    lines.append("-- generated by tools/glb_to_roblox.py from %s - do not edit." % source)
    lines.append("-- %d parts.  rest = the joint's local frame in the rest pose," % len(joints))
    lines.append("-- size = the block drawn for it, dir/len = where the bone points.")
    lines.append("-- forward = which local axis the model walks along, worked out from")
    lines.append("-- the clip that travels furthest; scale = metres -> studs.")
    lines.append("return {")
    lines.append("\tsource = %s," % json.dumps(source))
    lines.append("\tscale = %s," % num(scale, 5))
    lines.append("\theight = %s," % num(height, 3))
    lines.append("\tforward = %s," % vec(forward))
    lines.append("\toptions = %s," % lua_table(opts))
    lines.append("\tjoints = {")
    for i, j in enumerate(joints):
        lines.append("\t\t{ name = %s, parent = %s,%s" % (
            json.dumps(j["name"]),
            "nil" if j["parent"] is None else str(j["parent"] + 1),
            " pivot = true," if j.get("pivot") else ""))
        lines.append("\t\t  rest = %s," % frames(j["rest"][1] + j["rest"][0]))
        lines.append("\t\t  size = %s, dir = %s, len = %s },"
                     % (vec(j["size"]), vec(j["dir"]), num(j["len"])))
    lines.append("\t},")
    lines.append("}")
    open(path, "w").write("\n".join(lines) + "\n")


def write_clip(path, name, clip, dp_p=3):
    lines = []
    lines.append("--!nonstrict")
    lines.append("-- generated by tools/glb_to_roblox.py - do not edit.")
    lines.append("-- %s, %.3fs, %s, %d animated parts." % (
        name, clip["duration"], "loops" if clip["loop"] else "plays once",
        len(clip["channels"])))
    lines.append("return {")
    lines.append("\tname = %s," % json.dumps(name))
    lines.append("\tloop = %s," % ("true" if clip["loop"] else "false"))
    lines.append("\tduration = %s," % num(clip["duration"], 4))
    lines.append("\tchannels = {")
    for j in sorted(clip["channels"]):
        ch = clip["channels"][j]
        lines.append("\t\t[%d] = {" % (j + 1))
        lines.append("\t\t\tt = %s," % vec(ch["t"], 3))
        qs = []
        for k in range(len(ch["q"])):
            qs.extend(ch["q"][k])
        lines.append("\t\t\tq = %s," % frames(qs, dp=3))
        if "p" in ch:
            ps = []
            for k in range(len(ch["p"])):
                ps.extend(ch["p"][k])
            lines.append("\t\t\tp = %s," % frames(ps, dp=dp_p))
        lines.append("\t\t},")
    lines.append("\t},")
    lines.append("}")
    open(path, "w").write("\n".join(lines) + "\n")


def write_index(path, clips, source):
    lines = ["--!nonstrict",
             "-- generated by tools/glb_to_roblox.py - do not edit.",
             "-- one ModuleScript per clip, loaded on demand.",
             "local dir = script",
             "return {",
             "\tsource = %s," % json.dumps(source)]
    for name in sorted(clips):
        lines.append("\t[%s] = function() return require(dir:WaitForChild(%s)) end,"
                     % (json.dumps(name), json.dumps(name)))
    lines.append("}")
    open(path, "w").write("\n".join(lines) + "\n")


# --------------------------------------------------------------------------
# the audit
# --------------------------------------------------------------------------
def report(g, bin_, path, full):
    name = os.path.basename(path)
    tris = tri_counts(g)
    total = sum(t for _, t in tris)
    worst = max([t for _, t in tris] or [0])
    maxinf, over = influence_stats(g, bin_)
    imgs = image_sizes(g, bin_)
    skin = (g.get("skins") or [{}])[0]
    njoints = len(skin.get("joints", []))

    print("== %s" % name)
    print("   %d mesh(es), %d triangles (biggest mesh %d)" % (len(tris), total, worst))
    print("   %d joints" % njoints)
    print("   %d clip(s)%s" % (len(g.get("animations", [])),
                               (": " + ", ".join(
                                   a.get("name") or "?" for a in g["animations"]))
                               if full and g.get("animations") else ""))
    for n, w, h, mime, nbytes in imgs:
        print("   texture %-20s %dx%d %s %.0f KB"
              % (n, w, h, mime.replace("image/", ""), nbytes / 1024.0))

    print("   -- Roblox budgets ------------------------------------")
    checks = []
    for mname, t in tris:
        if t > LIMIT_TRIS:
            checks.append("FAIL %s is %d tris, over the %d mesh limit"
                          % (mname, t, LIMIT_TRIS))
    if not any(t > LIMIT_TRIS for _, t in tris):
        checks.append("ok   triangles: every mesh is at or under %d" % LIMIT_TRIS)
    if maxinf > LIMIT_INFLUENCES:
        checks.append("FAIL %d vert(s) skinned to %d bones; Roblox allows %d"
                      % (over, maxinf, LIMIT_INFLUENCES))
    elif maxinf:
        checks.append("ok   skin weights: at most %d bone(s) per vertex" % maxinf)
    if not skin.get("joints"):
        checks.append("WARN not skinned - Roblox will import it as a rigid mesh")
    for n, w, h, mime, _ in imgs:
        if w > LIMIT_TEXTURE or h > LIMIT_TEXTURE:
            checks.append("FAIL texture %s is %dx%d, over the %d limit"
                          % (n, w, h, LIMIT_TEXTURE))
        elif w:
            checks.append("ok   texture %s is %dx%d" % (n, w, h))
    if not g.get("animations"):
        checks.append("NOTE no clips in this file - animation lives in another .glb")
    for c in checks:
        print("   " + c)
    print("   docs: create.roblox.com/docs/art/modeling/specifications")
    return 0 if not any(c.startswith("FAIL") for c in checks) else 1


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("glb")
    ap.add_argument("--report", action="store_true",
                    help="audit against Roblox's import budgets and stop")
    ap.add_argument("--full", action="store_true", help="with --report, list clips")
    ap.add_argument("--out", help="output directory (writes Rig.luau + clips/)")
    ap.add_argument("--fps", type=float, default=24.0,
                    help="sampling rate before key reduction (default 24)")
    ap.add_argument("--max-joints", type=int, default=40,
                    help="parts per rig, thinned from the least-used leaves (default 40)")
    ap.add_argument("--prune",
                    default=r"(finger|thumb|index|middle|ring|pinky|_leaf|-leaf|_nub|_tip|pole|_ik$|^ik_)",
                    help="regex of cosmetic bones to drop first (default: fingers/toe tips/IK)")
    ap.add_argument("--scale", type=float, default=STUDS_PER_METRE,
                    help="metres -> studs (default %s)" % num(STUDS_PER_METRE, 4))
    ap.add_argument("--yaw", type=float, default=0.0,
                    help="degrees to turn the rig, for models that face +Z")
    ap.add_argument("--root-motion", choices=("strip", "keep", "none"), default="strip",
                    help="strip = keep only vertical root motion (default)")
    ap.add_argument("--loop", default=r"(loop|idle|walk|run|sprint|fly|gallop|hover)",
                    help="clip-name regex that should loop")
    ap.add_argument("--eps-rot", type=float, default=0.02,
                    help="keyframe reduction tolerance, quaternion (default 0.02)")
    ap.add_argument("--eps-pos", type=float, default=0.01,
                    help="keyframe reduction tolerance, studs (default 0.01)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    g, bin_ = load_glb(args.glb)
    if args.report or not args.out:
        return report(g, bin_, args.glb, args.full)

    verbose = not args.quiet
    if verbose:
        print("== %s" % os.path.basename(args.glb))

    order, kept, names = pick_joints(g, bin_, args.max_joints, args.prune, verbose)
    W, par = world_rest(g)
    joints, pscale = build_rig(g, W, par, order, kept, names, args.scale, args.yaw)
    clips, forward, walked = build_clips(g, bin_, W, pscale, order, kept, args.scale,
                                         args.fps, args.root_motion, args.eps_rot,
                                         args.eps_pos, re.compile(args.loop, re.I),
                                         verbose)
    height, lo = rig_extent(joints)

    if verbose:
        print("   rig stands %.1f studs tall, feet at %+.2f" % (height, lo))
        print("   faces (%s) %s" % (", ".join(num(v, 2) for v in forward),
                                    "- read off the clip that walks furthest"
                                    if walked else
                                    "- assumed, no clip walks: --yaw fixes it"))
        skew = [s for _q, _p, s in W.values()
                if max(s) > 1e-6 and (max(s) - min(s)) / max(s) > 0.01]
        if skew:
            print("   ! non-uniform scale in the skeleton (max spread %.0f%%) - "
                  "bake it in Blender for an exact match"
                  % (100 * max((max(s) - min(s)) / max(s) for s in skew)))

    os.makedirs(os.path.join(args.out, "clips"), exist_ok=True)
    opts = {"maxJoints": args.max_joints, "fps": args.fps,
            "rootMotion": args.root_motion, "yaw": args.yaw}
    write_rig(os.path.join(args.out, "Rig.luau"), joints,
              os.path.basename(args.glb), args.scale, opts, forward, height)
    for name, clip in clips.items():
        safe = re.sub(r"[^A-Za-z0-9_]", "_", name)
        write_clip(os.path.join(args.out, "clips", safe + ".luau"), name, clip)
    write_index(os.path.join(args.out, "clips", "init.luau"), clips,
                os.path.basename(args.glb))

    sizes = [os.path.getsize(os.path.join(args.out, "Rig.luau"))]
    for name in clips:
        safe = re.sub(r"[^A-Za-z0-9_]", "_", name)
        sizes.append(os.path.getsize(os.path.join(args.out, "clips", safe + ".luau")))
    if verbose:
        print("   wrote %s/Rig.luau + clips/ (%d clips, %.1f KB)"
              % (args.out, len(clips), sum(sizes) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
