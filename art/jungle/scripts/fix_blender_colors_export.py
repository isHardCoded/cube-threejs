"""Bake MAT_GroundMix Mix colours into ColBake and re-export scene.glb.

Keeps the Col paint mask in the .blend. At export time Col is temporarily
removed so glTF emits only ColBake as COLOR_0 (otherwise Three binds a white
layer and the ground looks grey).

Does NOT brighten PixelPalette — game uses Blender-authored colours 1:1.
"""
from __future__ import annotations

import os
import sys

import bpy

REVIEW = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
WORK = r"C:\Users\Антон\Downloads\LowPolyRockPack_WORK.blend"
OUT_GLB = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
OUT_TEX = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\textures\pixelpalette.png"

# Match MAT_GroundMix RGB nodes in the dressed card:
SAND = (0.86, 0.72, 0.42)
GRASS = (0.27, 0.56, 0.22)
BASIN = (0.34, 0.40, 0.26)

# In-memory stash so we never lose Col across export.
_COL_STASH: dict | None = None


def log(msg: str) -> None:
    print(msg, flush=True)


def lerp(a, b, t):
    return (
        a[0] * (1 - t) + b[0] * t,
        a[1] * (1 - t) + b[1] * t,
        a[2] * (1 - t) + b[2] * t,
    )


def bake_ground_colors() -> None:
    obj = bpy.data.objects.get("GROUND_LakeTerrain")
    if not obj or obj.type != "MESH":
        raise RuntimeError("GROUND_LakeTerrain missing")
    mesh = obj.data
    src = mesh.color_attributes.get("Col")
    if src is None:
        raise RuntimeError("Col mask missing — restore Col before baking")

    raw = [tuple(d.color) for d in src.data]
    domain = src.domain

    if "ColBake" in mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes["ColBake"])
    dst = mesh.color_attributes.new(name="ColBake", type="FLOAT_COLOR", domain=domain)

    for i, (r, _g, b, _a) in enumerate(raw):
        col = lerp(GRASS, SAND, r)
        col = lerp(col, BASIN, b)
        dst.data[i].color = (*col, 1.0)

    # Drop stale white layers; keep Col + ColBake
    for name in list(mesh.color_attributes.keys()):
        if name not in ("Col", "ColBake"):
            mesh.color_attributes.remove(mesh.color_attributes[name])

    mat = bpy.data.materials.get("MAT_GroundMix") or bpy.data.materials.new("MAT_GroundMix")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "ColBake"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    if mesh.materials:
        mesh.materials[0] = mat
    else:
        mesh.materials.append(mat)

    mesh.color_attributes.active_color = dst

    samples = {
        (round(dst.data[i].color[0], 2), round(dst.data[i].color[1], 2), round(dst.data[i].color[2], 2))
        for i in range(0, len(dst.data), max(1, len(dst.data) // 50))
    }
    log(f"baked ColBake n={len(dst.data)} unique~{len(samples)} samples={list(samples)[:8]}")


def stash_col_for_export() -> None:
    global _COL_STASH
    obj = bpy.data.objects.get("GROUND_LakeTerrain")
    if not obj:
        return
    mesh = obj.data
    src = mesh.color_attributes.get("Col")
    if src is None:
        _COL_STASH = None
        return
    _COL_STASH = {
        "domain": src.domain,
        "data": [tuple(d.color) for d in src.data],
    }
    mesh.color_attributes.remove(src)
    bake = mesh.color_attributes.get("ColBake")
    if bake:
        mesh.color_attributes.active_color = bake
    log("export prep: Col stashed, ColBake-only")


def restore_col_after_export() -> None:
    global _COL_STASH
    if not _COL_STASH:
        return
    obj = bpy.data.objects.get("GROUND_LakeTerrain")
    if not obj:
        return
    mesh = obj.data
    if "Col" in mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes["Col"])
    col = mesh.color_attributes.new(
        name="Col", type="FLOAT_COLOR", domain=_COL_STASH["domain"])
    for i, rgba in enumerate(_COL_STASH["data"]):
        col.data[i].color = rgba
    _COL_STASH = None
    bake = mesh.color_attributes.get("ColBake")
    if bake:
        mesh.color_attributes.active_color = bake
    log("restored Col mask after export")


def export_pixelpalette() -> None:
    """Write embedded atlas as-is (no brightening) for optional runtime fallback."""
    img = None
    for i in bpy.data.images:
        if i.size[0] <= 0:
            continue
        low = i.name.lower()
        if "pixelpalette" in low or low in ("texture.png", "texture"):
            img = i
            break
        if "texture" in low and i.size[0] == 256:
            img = i
            break
    if img is None:
        log("WARN: no pixel atlas image to export")
        return
    os.makedirs(os.path.dirname(OUT_TEX), exist_ok=True)
    img.filepath_raw = OUT_TEX
    img.file_format = "PNG"
    img.save()
    log(f"atlas -> {OUT_TEX} size={tuple(img.size)}")


def export_glb() -> None:
    allow_prefixes = ("NatureKit_M_Cliff", "VEG_", "GROUND_Lake", "LakeWater_")
    bpy.ops.object.select_all(action="DESELECT")
    count = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        cols = {c.name for c in obj.users_collection}
        if not (cols & {"MAP_JUNGLE_UPGRADE", "JUNGLE_VEG"}):
            continue
        if not any(obj.name.startswith(a) for a in allow_prefixes):
            continue
        try:
            obj.hide_set(False)
        except RuntimeError:
            pass
        obj.select_set(True)
        count += 1
    if count == 0:
        raise RuntimeError("no meshes selected for export")
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    kwargs = dict(
        filepath=OUT_GLB,
        use_selection=True,
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_attributes=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)
    log(f"EXPORT {OUT_GLB} meshes={count} bytes={os.path.getsize(OUT_GLB)}")


def main() -> None:
    src = sys.argv[-1] if len(sys.argv) > 1 and sys.argv[-1].endswith(".blend") else None
    if src:
        bpy.ops.wm.open_mainfile(filepath=src)
    elif not bpy.data.filepath:
        path = REVIEW if os.path.isfile(REVIEW) else WORK
        bpy.ops.wm.open_mainfile(filepath=path)

    log(f"FILE {bpy.data.filepath}")
    bake_ground_colors()
    export_pixelpalette()
    stash_col_for_export()
    try:
        export_glb()
    finally:
        restore_col_after_export()

    if bpy.data.filepath.replace("\\", "/").endswith("LowPolyRockPack_WORK.blend"):
        bpy.ops.wm.save_as_mainfile(filepath=REVIEW)
        log(f"saved review copy -> {REVIEW}")
    else:
        bpy.ops.wm.save_mainfile()
    log("BLENDER_COLORS_OK")


if __name__ == "__main__":
    main()
