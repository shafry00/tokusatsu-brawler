#!/usr/bin/env python3
"""inspect_glb.py - look inside a .glb before you commit to a pipeline.

Everything the asset pipeline needs to know about a file is in here: how many
triangles it is, whether it is skinned, what the skeleton is called, where each
bone sits in the rest pose, and which clips it carries.  Reading that up front is
what turns "the model is the wrong size / the arms are bent / the wrong bone
moved" into a two minute fix instead of an afternoon.

Usage:
    inspect_glb.py model.glb                  summary
    inspect_glb.py model.glb --bones          skeleton, with rest-pose positions
    inspect_glb.py model.glb --clips          clips, durations, channel counts
    inspect_glb.py model.glb --materials      materials and what they reference
    inspect_glb.py model.glb --json           machine readable summary

Only the JSON chunk is needed for --bones/--materials/--json, so those stay fast
on files with a large animation payload.
"""

import argparse
import json
import os
import struct
import sys

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
        5125: ("I", 4), 5126: ("f", 4)}


def read_glb(path):
    raw = open(path, "rb").read()
    if raw[:4] != b"glTF":
        raise SystemExit("%s: not a binary glTF" % path)
    off, g, binc = 12, None, b""
    while off < len(raw):
        ln, ty = struct.unpack_from("<II", raw, off)
        off += 8
        if ty == JSON_CHUNK:
            g = json.loads(raw[off:off + ln].decode("utf-8"))
        elif ty == BIN_CHUNK:
            binc = raw[off:off + ln]
        off += ln
    if g is None:
        raise SystemExit("%s: no JSON chunk" % path)
    return g, binc, len(raw)


def sizes(path):
    return sum(1 for _ in open(path, "rb"))


def quat_mat(q):
    """row-major 3x3 for a glTF quaternion [x, y, z, w]"""
    x, y, z, w = q
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def mv(m, v):
    return [sum(m[i][k] * v[k] for k in range(3)) for i in range(3)]


def rest_world(g):
    """node -> (world 3x3 rotation, world position, world scale) in the rest pose"""
    par = {}
    for i, nd in enumerate(g.get("nodes", [])):
        for c in nd.get("children", []):
            par[c] = i
    memo = {}

    def rec(i):
        if i in memo:
            return memo[i]
        nd = g["nodes"][i]
        if "matrix" in nd:
            m = nd["matrix"]
            R = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]
            t = [m[12], m[13], m[14]]
            s = [1.0, 1.0, 1.0]
        else:
            R = quat_mat(nd.get("rotation", [0, 0, 0, 1]))
            t = list(nd.get("translation", [0, 0, 0]))
            s = list(nd.get("scale", [1, 1, 1]))
        p = par.get(i)
        if p is not None:
            Rp, tp, sp = rec(p)
            t = [tp[k] + mv(Rp, [t[j] * sp[j] for j in range(3)])[k] for k in range(3)]
            R = mm(Rp, R)
            s = [sp[k] * s[k] for k in range(3)]
        memo[i] = (R, t, s)
        return memo[i]

    return rec, par


def tri_count(g):
    n = 0
    for m in g.get("meshes", []):
        for p in m.get("primitives", []):
            if "indices" in p:
                n += g["accessors"][p["indices"]]["count"] // 3
            elif "POSITION" in p.get("attributes", {}):
                n += g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    return n


def summary(g, raw_len, path):
    skins = g.get("skins", [])
    return {
        "file": os.path.basename(path),
        "bytes": raw_len,
        "generator": g.get("asset", {}).get("generator"),
        "nodes": len(g.get("nodes", [])),
        "meshes": len(g.get("meshes", [])),
        "triangles": tri_count(g),
        "materials": len(g.get("materials", [])),
        "images": len(g.get("images", [])),
        "skinned": bool(skins),
        "joints": len(skins[0]["joints"]) if skins else 0,
        "animations": len(g.get("animations", [])),
        "clips": [a.get("name") for a in g.get("animations", [])],
        "extensions": g.get("extensionsUsed", []),
    }


def print_summary(s):
    print("== %s" % s["file"])
    print("   size        %.2f MB" % (s["bytes"] / 1048576))
    print("   generator   %s" % s["generator"])
    print("   nodes       %d" % s["nodes"])
    print("   meshes      %d  (%d triangles)" % (s["meshes"], s["triangles"]))
    print("   materials   %d   images %d" % (s["materials"], s["images"]))
    print("   skinned     %s" % ("yes, %d joints" % s["joints"] if s["skinned"] else "NO — cannot retarget"))
    print("   animations  %d" % s["animations"])
    if s["extensions"]:
        print("   extensions  %s" % ", ".join(s["extensions"]))
    if not s["skinned"]:
        print("\n   ! no skin: the game can still draw this, but not animate or retarget it")


def print_bones(g):
    rec, par = rest_world(g)
    children = {c for nd in g.get("nodes", []) for c in nd.get("children", [])}
    roots = [i for i in range(len(g["nodes"])) if i not in children]
    joints = set(g["skins"][0]["joints"]) if g.get("skins") else set()

    def walk(i, depth):
        nd = g["nodes"][i]
        R, t, s = rec(i)
        mark = " *" if i in joints else ""
        print("   %s%s%s   pos=(%.3f, %.3f, %.3f)%s"
              % ("  " * depth, nd.get("name") or ("node%d" % i),
                 mark, t[0], t[1], t[2],
                 "  scale=(%.3f, %.3f, %.3f)" % tuple(s) if any(abs(v - 1) > 1e-4 for v in s) else ""))
        if "mesh" in nd:
            print("   %s   [mesh %d]" % ("  " * depth, nd["mesh"]))
        for c in nd.get("children", []):
            walk(c, depth + 1)

    print("== skeleton (%d nodes, * = skin joint) ==" % len(g.get("nodes", [])))
    for r in roots:
        walk(r, 0)


def print_clips(g):
    print("== clips ==")
    if not g.get("animations"):
        print("   (none)")
    for a in g.get("animations", []):
        dur, chans = 0.0, len(a.get("channels", []))
        paths = {}
        for s in a.get("samplers", []):
            inp = g["accessors"][s["input"]]
            if "max" in inp:
                dur = max(dur, float(inp["max"][0]))
        for c in a.get("channels", []):
            paths[c["target"]["path"]] = paths.get(c["target"]["path"], 0) + 1
        print("   %-34s %5.2fs  %3d channels  %s"
              % (a.get("name"), dur, chans,
                 ", ".join("%s x%d" % (k, v) for k, v in sorted(paths.items()))))


def print_materials(g):
    print("== materials ==")
    for i, m in enumerate(g.get("materials", [])):
        pbr = m.get("pbrMetallicRoughness", {})
        bits = []
        if "baseColorTexture" in pbr:
            bits.append("tex#%d" % pbr["baseColorTexture"]["index"])
        else:
            bits.append("rgba%s" % (pbr.get("baseColorFactor", [1, 1, 1, 1])[:3],))
        if "metallicFactor" in pbr:
            bits.append("m=%.2f r=%.2f" % (pbr.get("metallicFactor", 1), pbr.get("roughnessFactor", 1)))
        if "emissiveFactor" in m:
            bits.append("emissive")
        if "extensions" in m:
            bits.append("+".join(m["extensions"]))
        print("   [%d] %-24s %s" % (i, m.get("name"), "  ".join(bits)))
    prims = {}
    for mi, mesh in enumerate(g.get("meshes", [])):
        for pi, p in enumerate(mesh.get("primitives", [])):
            prims.setdefault(p.get("material"), []).append("%s[%d]" % (mesh.get("name"), pi))
            attrs = p.get("attributes", {})
            prims[p.get("material")][-1] += " vc" if "COLOR_0" in attrs else ""
    for mi, where in sorted(prims.items(), key=lambda kv: (kv[0] is None, kv[0])):
        print("        used by %s" % ", ".join(where))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("glb")
    ap.add_argument("--bones", action="store_true", help="print the skeleton in the rest pose")
    ap.add_argument("--clips", action="store_true", help="print the animation clips")
    ap.add_argument("--materials", action="store_true", help="print the materials")
    ap.add_argument("--json", action="store_true", help="machine readable summary")
    args = ap.parse_args()

    g, _binc, raw_len = read_glb(args.glb)
    s = summary(g, raw_len, args.glb)

    if args.json:
        print(json.dumps(s, indent=2))
        return

    print_summary(s)
    if not (args.bones or args.clips or args.materials):
        if s["clips"]:
            print("\n   clips: " + ", ".join(str(c) for c in s["clips"][:12])
                  + (" …" if len(s["clips"]) > 12 else ""))
        print("   (--bones, --clips, --materials for more)")
        return
    if args.bones:
        print()
        print_bones(g)
    if args.clips:
        print()
        print_clips(g)
    if args.materials:
        print()
        print_materials(g)


if __name__ == "__main__":
    main()
