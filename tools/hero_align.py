#!/usr/bin/env python3
"""hero_align.py - re-align a clip library so it drives a differently-rested rig.

Use this when the animation clips you want and the mesh you want to drive them
with share a skeleton *by bone name* but not by rest pose.  That happens
constantly: a clip library is authored for a T-posed reference rig, while a
downloaded character is sculpted standing with its arms down, or in an A-pose.

This is the standalone, clip-only half of the retarget in `retarget.py`: it
changes nothing about the mesh, the node rest pose or the inverse-bind matrices,
only the rotations inside the clips.  See the worked example below.

--- the worked example this tool was written for ---

The Universal Rig - whose bone *names* `hero.glb` reuses, and on which the
clips in `anim-ual.glb` were authored - rests in a T-pose: its upper arm points
straight out along +X.  The Tiga statue is sculpted with its arms hanging down
(the upper arm points (0.27, -0.96, 0.00)).  `build_bind` copied the Universal
Rig's rest *rotations* onto the statue's rest *positions*, so the two disagree
by 75 degrees on the upper arm - and the clips key *absolute* local quaternions.

The result: every arm rotation was applied on top of a pose already 75 degrees
away from the one it was authored for, so the hero raised his arms 75 degrees
too far and buried both hands in his own stomach.

A clip only ever moves a *bone*; what the viewer sees is the geometry, and this
geometry hangs 75 degrees below its bone frame.  So each bone gets the shortest
arc carrying its statue-pose bone direction onto the Universal Rig's, and the
clip rotation is re-expressed through it:

    A(b,t) = [ A_src(b,t) . R_src(b)^-1 ] . Align(b) . R_here(b)

which is the same deviation-and-swing retarget that drives the kaiju (see
`retarget.py`): the source's motion *relative to its own rest* is applied to
this rig's rest, from this rig's rest orientation.  The skinning rotation that
reaches the vertices is then X = A . R_here^-1 = X_src . Align, and since
Align carries the statue's bone direction onto the Universal Rig's,

    X . d_here = X_src . Align . d_here = X_src . d_src

i.e. every bone's *geometry* moves exactly the way the Universal Rig's does.

The mesh, the node rest pose and the inverse-bind matrices are left alone: only
the clip rotations change, so nothing about the model's look or size moves.

    hero_align.py [--dry] [--out PATH]
"""
import json
import os
import shutil
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GAME = os.path.join(ROOT, "assets", "models")
# defaults: they reproduce this project's own hero build.  Override with
# --rig / --target / --clips to re-align any other clip library.
UAL_RIG = os.path.join(GAME, "hero.glb")      # rest pose the clips were authored for
HERO_RIG = os.path.join(GAME, "hero.glb")     # rest pose the mesh actually uses
CLIPS = os.path.join(GAME, "anim-ual.glb")
OUT = os.path.join(HERE, "out", "anim-ual-aligned.glb")


# ---------------------------------------------------------------- glTF
def read_glb(path):
    raw = open(path, "rb").read()
    off, js, binc = 12, None, None
    while off < len(raw):
        ln, ty = struct.unpack_from("<II", raw, off)
        off += 8
        if ty == 0x4E4F534A:
            js = json.loads(raw[off:off + ln])
        elif ty == 0x004E4942:
            binc = bytearray(raw[off:off + ln])
        off += ln
    return js, binc


COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
        5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def acc_read(js, binc, i):
    a = js["accessors"][i]
    bv = js["bufferViews"][a["bufferView"]]
    o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    fmt, sz = COMP[a["componentType"]]
    n = a["count"] * NCOMP[a["type"]]
    return np.array(struct.unpack_from("<%d%s" % (n, fmt), binc, o))


# ---------------------------------------------------------------- quaternions
def qmul(a, b):
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b
    return np.array([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
                     w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                     w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2])


def qmat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def mat2q(R):
    """rotation matrix -> quaternion, returned as (x,y,z,w) for glTF."""
    t = R[0, 0] + R[1, 1] + R[2, 2]
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        q = np.array([0.25 * s, (R[2, 1] - R[1, 2]) / s,
                      (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s])
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        q = np.array([(R[2, 1] - R[1, 2]) / s, 0.25 * s,
                      (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s])
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        q = np.array([(R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s,
                      0.25 * s, (R[1, 2] + R[2, 1]) / s])
    else:
        s = np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        q = np.array([(R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s,
                      (R[1, 2] + R[2, 1]) / s, 0.25 * s])
    n = np.linalg.norm(q)
    if n < 1e-9:
        return np.array([0.0, 0.0, 0.0, 1.0])
    q = q / n
    return np.array([q[1], q[2], q[3], q[0]])          # w,x,y,z -> x,y,z,w


def qslerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0:
        b = -b
        d = -d
    if d > 0.9995:
        r = a + (b - a) * t
        n = np.linalg.norm(r)
        return r / n if n > 1e-9 else a
    th = np.arccos(np.clip(d, -1.0, 1.0))
    s = np.sin(th)
    return (np.sin((1 - t) * th) / s) * a + (np.sin(t * th) / s) * b


def swing(a, b):
    """shortest arc taking unit vector a onto unit vector b."""
    a = a / (np.linalg.norm(a) + 1e-12)
    b = b / (np.linalg.norm(b) + 1e-12)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    n = np.linalg.norm(v)
    if n < 1e-9:
        return np.eye(3) if c > 0 else -np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


# ---------------------------------------------------------------- rigs
class Rig:
    def __init__(self, path, label):
        js, _ = read_glb(path)
        nodes = js["nodes"]
        names = [n.get("name") for n in nodes]
        par = {}
        for i, n in enumerate(nodes):
            for c in n.get("children", []):
                par[c] = i
        self.joints = [names[i] for i in js["skins"][0]["joints"]]
        jset = set(self.joints)
        self.parent = {}
        self.local_q = {}
        self.world_R = {}
        self.world_p = {}
        for i in js["skins"][0]["joints"]:
            nm = names[i]
            p = names[par[i]] if i in par else None
            # a joint may hang off a plain "Armature" node: that is not part of
            # the skeleton, so the chain starts here
            if p is not None and p not in jset:
                pn = nodes[par[i]]
                if (not np.allclose(pn.get("translation", [0, 0, 0]), 0)
                        or not np.allclose(pn.get("rotation", [0, 0, 0, 1]), [0, 0, 0, 1])):
                    print("!! %s: non-joint parent '%s' carries a transform, ignored"
                          % (label, p))
                p = None
            self.parent[nm] = p
            self.local_q[nm] = np.array(nodes[i].get("rotation", [0, 0, 0, 1]), float)
        for nm in self.order():
            R = qmat(self.local_q[nm])
            t = np.array(nodes[self.idx(nm, js)].get("translation", [0, 0, 0]), float)
            p = self.parent[nm]
            if p is None:
                self.world_R[nm] = R
                self.world_p[nm] = t
            else:
                self.world_R[nm] = self.world_R[p] @ R
                self.world_p[nm] = self.world_R[p] @ t + self.world_p[p]
        self.label = label

    @staticmethod
    def idx(nm, js):
        for i, n in enumerate(js["nodes"]):
            if n.get("name") == nm:
                return i
        raise KeyError(nm)

    def order(self):
        out, seen = [], set()

        def visit(nm):
            if nm in seen or nm not in self.parent:
                return
            seen.add(nm)
            out.append(nm)
            for c in self.kids.get(nm, []):
                visit(c)
        self.kids = {}
        for nm, p in self.parent.items():
            self.kids.setdefault(p, []).append(nm)
        for nm in self.joints:
            if self.parent[nm] is None:
                visit(nm)
        return out

    def dir_of(self, nm):
        """the direction this bone's geometry points in the rest pose: from the
        joint towards its first child (the same segment `build_weights` used)."""
        k = [c for c in self.kids.get(nm, []) if c in self.parent]
        if not k:
            return None
        v = self.world_p[k[0]] - self.world_p[nm]
        return v / (np.linalg.norm(v) + 1e-12)


def main():
    import argparse

    ap = argparse.ArgumentParser(
        prog="hero_align.py",
        description="Re-express a clip library through the rest-pose difference "
                    "between the rig it was authored for and the rig it will drive.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  hero_align.py --dry                      # report the mismatch, write nothing
  hero_align.py --target hero.glb --clips anim-ual.glb --out out/aligned.glb
  hero_align.py --target hero.glb --clips anim-ual.glb --install
""")
    ap.add_argument("--rig", default=UAL_RIG, help="rig whose rest pose the clips were authored for")
    ap.add_argument("--target", default=HERO_RIG, help="rig whose rest pose the mesh uses")
    ap.add_argument("--clips", default=CLIPS, help="the .glb holding the clips to rewrite")
    ap.add_argument("--out", default=OUT, help="where to write the realigned clips")
    ap.add_argument("--install", action="store_true",
                    help="overwrite --clips with the result (keeps a .orig backup)")
    ap.add_argument("--dry", action="store_true", help="report and write nothing")
    args = ap.parse_args()

    dry = args.dry
    out_path = args.out

    src = Rig(args.rig, "source rig")
    here = Rig(args.target, "target rig")
    if src.joints != here.joints:
        print("!! joint sets differ")
        return 1

    order = here.order()
    align = {}
    for nm in order:
        dh, ds = here.dir_of(nm), src.dir_of(nm)
        align[nm] = np.eye(3) if (dh is None or ds is None) else swing(dh, ds)

    ang = {nm: np.degrees(np.arccos(np.clip((np.trace(align[nm]) - 1) / 2, -1, 1)))
           for nm in order}
    big = sorted(ang.items(), key=lambda kv: -kv[1])[:6]
    print("== alignment: worst bones " +
          ", ".join("%s %.1fdeg" % (k, v) for k, v in big))

    js, binc = read_glb(args.clips)
    names = [n.get("name") for n in js["nodes"]]
    ax, bvs = js["accessors"], js["bufferViews"]

    def appended(flat, kind):
        data = np.ascontiguousarray(flat, np.float32).tobytes()
        while len(binc) % 4:
            binc.append(0)
        o = len(binc)
        binc.extend(data)
        bvs.append({"buffer": 0, "byteOffset": o, "byteLength": len(data)})
        ax.append({"bufferView": len(bvs) - 1, "componentType": 5126,
                   "count": int(len(flat) // NCOMP[kind]), "type": kind})
        return len(ax) - 1

    total_written = 0
    for anim in js["animations"]:
        tracks = {}
        timesets = []
        for ch in anim["channels"]:
            t = ch["target"]
            smp = anim["samplers"][ch["sampler"]]
            times = acc_read(js, binc, smp["input"])
            vals = acc_read(js, binc, smp["output"])
            tracks.setdefault((names[t["node"]], t["path"]), (times, vals))
            timesets.append(times)
        times = np.unique(np.concatenate(timesets))

        def sample(node, path, attr, n):
            tv = tracks.get((node, path))
            if tv is None:
                return None
            ts, vs = tv
            vs = vs.reshape(-1, n)
            out = np.zeros((len(times), n))
            j = 0
            for i, tt in enumerate(times):
                while j + 1 < len(ts) - 1 and ts[j + 1] < tt:
                    j += 1
                j = min(j, len(ts) - 2) if len(ts) > 1 else 0
                if len(ts) == 1:
                    out[i] = vs[0]
                    continue
                span = float(ts[j + 1] - ts[j]) or 1.0
                f = float(np.clip((tt - ts[j]) / span, 0, 1))
                if path == "rotation":
                    out[i] = qslerp(vs[j], vs[j + 1], f)
                else:
                    out[i] = vs[j] + (vs[j + 1] - vs[j]) * f
            return out

        # source world rotations by FK, then the aligned rig, then back to local
        sampled = {}
        for path in ("rotation", "translation"):
            for ch in anim["channels"]:
                t = ch["target"]
                if t["path"] != path:
                    continue
                nm = names[t["node"]]
                n = 4 if path == "rotation" else 3
                s = sample(nm, path, path, n)
                if s is not None:
                    sampled[(nm, path)] = s

        A_src, A_here = {}, {}
        out_q = {}
        for i, t in enumerate(times):
            for nm in order:
                s = sampled.get((nm, "rotation"))
                q = s[i] if s is not None else src.local_q[nm]
                p = here.parent[nm]
                A_src[nm] = (A_src[p] @ qmat(q)) if p in A_src else qmat(q)
                Rs = src.world_R[nm]
                Rh = here.world_R[nm]
                A_here[nm] = A_src[nm] @ Rs.T @ align[nm] @ Rh
                out_q.setdefault(nm, np.zeros((len(times), 4)))
                out_q[nm][i] = mat2q(A_here[p].T @ A_here[nm]) if p in A_here else mat2q(A_here[nm])

        # ---- self check: geometry must move exactly like the source's
        worst = 0.0
        for nm in order:
            dh, ds = here.dir_of(nm), src.dir_of(nm)
            if dh is None or ds is None:
                continue
            for i in range(len(times)):
                X = A_here[nm] @ here.world_R[nm].T
                Xs = A_src[nm] @ src.world_R[nm].T
                a = X @ dh
                b = Xs @ ds
                worst = max(worst, np.degrees(np.arccos(np.clip(np.dot(a, b), -1, 1))))
        print("   %-20s %4d keys   bone-direction error %.4f deg" %
              (anim["name"], len(times), worst))

        # ---- rebuild the animation: one shared input, a track per channel
        inp = appended(times, "SCALAR")
        chans, samplers = [], []
        for ch in anim["channels"]:
            t = ch["target"]
            node, path = names[t["node"]], t["path"]
            if path == "rotation":
                vals = out_q[node].reshape(-1)
            else:
                s = sampled.get((node, path))
                if s is None:
                    continue                       # never invent a track
                vals = s.reshape(-1)
            outacc = appended(vals, "VEC4" if path == "rotation" else "VEC3")
            samplers.append({"input": inp, "output": outacc, "interpolation": "LINEAR"})
            chans.append({"sampler": len(samplers) - 1, "target": t})
            total_written += 1
        anim["channels"] = chans
        anim["samplers"] = samplers

    js["buffers"][0]["byteLength"] = len(binc)
    print("== %d channels rewritten over %d clips ==" %
          (total_written, len(js["animations"])))
    if dry:
        print("   (dry run, nothing written)")
        return 0

    jsb = json.dumps(js, separators=(",", ":")).encode()
    while len(jsb) % 4:
        jsb += b" "
    bn = bytes(binc)
    while len(bn) % 4:
        bn += b"\x00"
    total = 12 + 8 + len(jsb) + 8 + len(bn)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(jsb), 0x4E4F534A))
        fh.write(jsb)
        fh.write(struct.pack("<II", len(bn), 0x004E4942))
        fh.write(bn)
    print("   %s: %.2f MB" % (out_path, total / 1e6))
    if args.install:
        backup = args.clips + ".orig"
        if not os.path.exists(backup):
            shutil.copy2(args.clips, backup)
            print("   backed up the previous clip set to %s" % backup)
        shutil.copy2(out_path, args.clips)
        print("   installed into %s" % args.clips)
    return 0


if __name__ == "__main__":
    sys.exit(main())
