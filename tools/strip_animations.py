#!/usr/bin/env python3
"""strip_animations.py - drop animation clips out of a .glb and repack the buffer.

A rigged `.glb` from an animation library usually carries the mesh, the skeleton
AND every clip in one file. This engine wants the hero split in two:

    hero.glb        mesh + skeleton + skin weights (rest pose only)
    anim-ual.glb    the clip library, addressed by bone name

Splitting keeps the 6 MB of keyframe data out of the mesh request, so the two
files can be cached, swapped and versioned independently. This tool produces the
mesh-only half: it deletes `animations`, then walks every accessor that is still
reachable (mesh attributes, indices, inverse bind matrices, embedded images) and
copies only those bytes into a fresh buffer.

Dependency-free apart from numpy (which is not actually needed for the repack -
see the plain `struct` path below).

Usage:
    strip_animations.py in.glb -o out.glb
    strip_animations.py in.glb -o out.glb --keep Idle_Loop,Walk_Loop
    strip_animations.py in.glb --report          # what is in the file
"""

import argparse
import json
import struct
import sys

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path):
    raw = open(path, "rb").read()
    if raw[:4] != b"glTF":
        raise SystemExit("%s: not a binary glTF" % path)
    magic, version, total = struct.unpack_from("<III", raw, 0)
    if version != 2:
        raise SystemExit("%s: glTF version %d is not supported" % (path, version))
    off, js, bin_ = 12, None, b""
    while off < len(raw):
        ln, ty = struct.unpack_from("<II", raw, off)
        off += 8
        if ty == JSON_CHUNK:
            js = json.loads(raw[off:off + ln].decode("utf-8"))
        elif ty == BIN_CHUNK:
            bin_ = raw[off:off + ln]
        off += ln
    if js is None:
        raise SystemExit("%s: no JSON chunk" % path)
    return js, bin_


def write_glb(path, gltf, bin_):
    while len(bin_) % 4:
        bin_ += b"\x00"
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(js) % 4:
        js += b" "
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), JSON_CHUNK))
        fh.write(js)
        fh.write(struct.pack("<II", len(bin_), BIN_CHUNK))
        fh.write(bin_)
    return total


def report(path):
    g, _ = read_glb(path)
    print("== %s" % path)
    print("   generator : %s" % g.get("asset", {}).get("generator"))
    print("   nodes=%d meshes=%d skins=%s materials=%d images=%d accessors=%d bufferViews=%d"
          % (len(g.get("nodes", [])), len(g.get("meshes", [])),
             [len(s.get("joints", [])) for s in g.get("skins", [])],
             len(g.get("materials", [])), len(g.get("images", [])),
             len(g.get("accessors", [])), len(g.get("bufferViews", []))))
    for m in g.get("meshes", []):
        tris = sum(g["accessors"][p["indices"]]["count"] // 3
                   for p in m.get("primitives", []) if "indices" in p)
        print("   mesh %-14r prims=%d tris=%d attrs=%s"
              % (m.get("name"), len(m.get("primitives", [])), tris,
                 ",".join(sorted(m["primitives"][0].get("attributes", {}))) if m.get("primitives") else ""))
    names = [a.get("name") for a in g.get("animations", [])]
    print("   animations: %d" % len(names))
    for i in range(0, len(names), 4):
        print("      " + ", ".join(str(n) for n in names[i:i + 4]))


def strip(path, out, keep=None):
    g, bin_ = read_glb(path)

    unknown = set(g.get("extensionsUsed", [])) - {
        "KHR_materials_unlit", "KHR_texture_transform", "KHR_materials_emissive_strength",
    }
    if unknown:
        print("   ! extensions present, verify the output: %s" % ", ".join(sorted(unknown)),
              file=sys.stderr)

    # ---- which animations survive ----
    anims = g.get("animations", [])
    if keep:
        wanted = {k.strip().lower() for k in keep}
        anims = [a for a in anims if (a.get("name") or "").lower() in wanted]
        missing = wanted - {(a.get("name") or "").lower() for a in anims}
        for m in sorted(missing):
            print("   ! no clip named %r" % m, file=sys.stderr)
    else:
        anims = []

    # ---- every accessor that is still referenced ----
    used = set()

    def take_accessor(i):
        used.add(i)

    for m in g.get("meshes", []):
        for p in m.get("primitives", []):
            if "indices" in p:
                take_accessor(p["indices"])
            for holder in ("attributes", "targets"):
                src = p.get(holder)
                if isinstance(src, dict):
                    for a in src.values():
                        take_accessor(a)
                elif isinstance(src, list):
                    for tgt in src:
                        for a in tgt.values():
                            take_accessor(a)
    for s in g.get("skins", []):
        if "inverseBindMatrices" in s:
            take_accessor(s["inverseBindMatrices"])
    for a in anims:
        for s in a.get("samplers", []):
            take_accessor(s["input"])
            take_accessor(s["output"])

    # ---- which bufferViews those accessors (and any images) need ----
    view_owner = {}          # old view index -> new view index
    new_views, new_bin = [], bytearray()

    def keep_view(vi):
        if vi in view_owner:
            return view_owner[vi]
        v = g["bufferViews"][vi]
        start = v.get("byteOffset", 0)
        end = start + v["byteLength"]
        while len(new_bin) % 4:
            new_bin.append(0)
        nv = {"buffer": 0, "byteOffset": len(new_bin), "byteLength": v["byteLength"]}
        for k in ("byteStride", "target"):
            if k in v:
                nv[k] = v[k]
        new_bin.extend(bin_[start:end])
        new_views.append(nv)
        view_owner[vi] = len(new_views) - 1
        return view_owner[vi]

    new_accessors, acc_map = [], {}
    for i, acc in enumerate(g.get("accessors", [])):
        if i not in used or "bufferView" not in acc:
            continue
        na = dict(acc)
        na["bufferView"] = keep_view(acc["bufferView"])
        acc_map[i] = len(new_accessors)
        new_accessors.append(na)

    for img in g.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = keep_view(img["bufferView"])

    # ---- remap the accessor indices we just rewrote ----
    def remap(node):
        if isinstance(node, dict):
            return {k: (acc_map[v] if k in ("indices", "inverseBindMatrices") and isinstance(v, int)
                        else remap(v)) for k, v in node.items()}
        if isinstance(node, list):
            return [remap(v) for v in node]
        return node

    for m in g.get("meshes", []):
        for p in m.get("primitives", []):
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
            for holder in ("attributes", "targets"):
                src = p.get(holder)
                if isinstance(src, dict):
                    p[holder] = {k: acc_map[v] for k, v in src.items()}
                elif isinstance(src, list):
                    p[holder] = [{k: acc_map[v] for k, v in t.items()} for t in src]
    for s in g.get("skins", []):
        if "inverseBindMatrices" in s:
            s["inverseBindMatrices"] = acc_map[s["inverseBindMatrices"]]
    for a in anims:
        for s in a.get("samplers", []):
            s["input"] = acc_map[s["input"]]
            s["output"] = acc_map[s["output"]]

    g["accessors"] = new_accessors
    g["bufferViews"] = new_views
    if anims:
        g["animations"] = anims
    else:
        g.pop("animations", None)
    g["buffers"] = [{"byteLength": len(new_bin)}]

    total = write_glb(out, g, bytes(new_bin))
    return total, len(new_accessors), len(new_views)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("glb")
    ap.add_argument("-o", "--out")
    ap.add_argument("--keep", help="comma separated clip names to keep")
    ap.add_argument("--report", action="store_true", help="print contents and exit")
    args = ap.parse_args()

    if args.report or not args.out:
        report(args.glb)
        if not args.out:
            return
    before = len(open(args.glb, "rb").read())
    keep = args.keep.split(",") if args.keep else None
    total, nacc, nview = strip(args.glb, args.out, keep)
    print("%s -> %s   %.2f MB -> %.2f MB   accessors=%d bufferViews=%d"
          % (args.glb, args.out, before / 1048576, total / 1048576, nacc, nview))


if __name__ == "__main__":
    main()
