"""Convert Collada DAE (simple polylist) to OBJ+MTL for Blender import."""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

SRC = Path(r"C:\Users\Антон\Downloads\Models\Models")
OUT = Path(r"C:\Users\Антон\Downloads\Models\obj")
TEX = Path(r"C:\Users\Антон\Downloads\Models\Textures\Colorscheme Grey.png")


def local(tag: str) -> str:
    return tag.split("}")[-1]


def parse_floats(text: str) -> list[float]:
    return [float(x) for x in text.split()]


def mat4_mul_point(m, x, y, z):
    X = m[0] * x + m[1] * y + m[2] * z + m[3]
    Y = m[4] * x + m[5] * y + m[6] * z + m[7]
    Z = m[8] * x + m[9] * y + m[10] * z + m[11]
    return X, Y, Z


def convert_one(dae_path: Path) -> None:
    root = ET.parse(dae_path).getroot()
    pos = None
    uvs = None
    for fa in root.iter():
        if local(fa.tag) != "float_array" or not fa.text:
            continue
        fid = fa.get("id", "")
        if "-positions-array" in fid:
            pos = parse_floats(fa.text)
        if "-map-0-array" in fid:
            uvs = parse_floats(fa.text)
    if not pos:
        print("NO POS", dae_path.name)
        return

    verts = [(pos[i], pos[i + 1], pos[i + 2]) for i in range(0, len(pos), 3)]
    uv_pairs = [(uvs[i], uvs[i + 1]) for i in range(0, len(uvs), 2)] if uvs else []

    mats = []
    for node in root.iter():
        if local(node.tag) == "matrix" and node.text:
            mats.append(parse_floats(node.text))
    M = mats[0] if mats else [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

    faces = []
    for pl in root.iter():
        if local(pl.tag) != "polylist":
            continue
        inputs = []
        vcount_el = None
        p_el = None
        for child in list(pl):
            t = local(child.tag)
            if t == "input":
                inputs.append((child.get("semantic"), int(child.get("offset", "0"))))
            elif t == "vcount":
                vcount_el = child
            elif t == "p":
                p_el = child
        # ElementTree: elements with text but no children are falsy — use is None
        if vcount_el is None or p_el is None:
            continue
        sem = {s: o for s, o in inputs}
        stride = max(o for _, o in inputs) + 1
        vcounts = [int(x) for x in vcount_el.text.split()]
        pdata = [int(x) for x in p_el.text.split()]
        idx = 0
        for vc in vcounts:
            face = []
            for _ in range(vc):
                base = idx * stride
                vi = pdata[base + sem.get("VERTEX", 0)]
                uvi = pdata[base + sem["TEXCOORD"]] if "TEXCOORD" in sem else None
                face.append((vi, uvi))
                idx += 1
            faces.append(face)

    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", dae_path.stem)
    obj_path = OUT / f"{safe}.obj"
    mtl_path = OUT / f"{safe}.mtl"
    tex_uri = TEX.as_posix()

    with obj_path.open("w", encoding="utf-8") as f:
        f.write(f"# converted from {dae_path.name}\n")
        f.write(f"mtllib {safe}.mtl\n")
        f.write(f"o {safe}\n")
        for x, y, z in verts:
            X, Y, Z = mat4_mul_point(M, x, y, z)
            f.write(f"v {X:.6f} {Y:.6f} {Z:.6f}\n")
        for u, v in uv_pairs:
            f.write(f"vt {u:.6f} {v:.6f}\n")
        f.write("usemtl Cliff\n")
        for face in faces:
            parts = []
            for vi, uvi in face:
                if uvi is None:
                    parts.append(str(vi + 1))
                else:
                    parts.append(f"{vi + 1}/{uvi + 1}")
            f.write("f " + " ".join(parts) + "\n")

    with mtl_path.open("w", encoding="utf-8") as f:
        f.write("newmtl Cliff\n")
        f.write("Kd 0.64 0.64 0.64\n")
        f.write(f'map_Kd "{tex_uri}"\n')

    print("OK", dae_path.name, "->", obj_path.name, "v", len(verts), "f", len(faces))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for dae_path in sorted(SRC.glob("*.dae")):
        convert_one(dae_path)
    print("DONE")


if __name__ == "__main__":
    main()
