"""Restore original NatureKit atlas, bake HueSat variants, fix palms, export GLB.

Goal: game materials match Blender viewport colours 1:1 (no brighten hacks).
"""
from __future__ import annotations

import colorsys
import os
import sys

import bpy

REVIEW = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
ORIG_TEX = r"C:\Users\Антон\Downloads\Textures\Texture.png"
OUT_GLB = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
OUT_TEX_DIR = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\textures"

# Match MAT_GroundMix RGB nodes:
SAND = (0.86, 0.72, 0.42)
GRASS = (0.27, 0.56, 0.22)
BASIN = (0.34, 0.40, 0.26)

# Blender HueSat defaults: Hue 0.5 / Sat 1.0 / Val 1.0 = identity
HUE_VARIANTS = {
    "PixelPalette_JungleMid": (0.506, 1.1, 0.8),
    "PixelPalette_JungleWarm": (0.476, 1.02, 1.14),
    "PixelPalette_JungleDark": (0.517, 1.2, 0.6),
}

_COL_STASH: dict | None = None


def log(msg: str) -> None:
    print(msg, flush=True)


def lerp(a, b, t):
    return (
        a[0] * (1 - t) + b[0] * t,
        a[1] * (1 - t) + b[1] * t,
        a[2] * (1 - t) + b[2] * t,
    )


def blender_hue_sat(r: float, g: float, b: float, hue: float, sat: float, val: float):
    """Approximate Blender's Hue Saturation Value node (Hue 0.5 = no shift)."""
    h, s, v = colorsys.rgb_to_hsv(max(0, min(1, r)), max(0, min(1, g)), max(0, min(1, b)))
    h = (h + (hue - 0.5)) % 1.0
    s = max(0.0, min(1.0, s * sat))
    v = max(0.0, min(1.0, v * val))
    return colorsys.hsv_to_rgb(h, s, v)


def restore_original_atlas() -> bpy.types.Image:
    if not os.path.isfile(ORIG_TEX):
        raise RuntimeError(f"original atlas missing: {ORIG_TEX}")

    # Prefer the packed Texture.png used by PixelPalette
    img = None
    for i in bpy.data.images:
        low = i.name.lower()
        if low.startswith("texture") and i.size[0] == 256:
            img = i
            break
    if img is None:
        img = bpy.data.images.load(ORIG_TEX)
        img.name = "Texture.png"
    else:
        # Reload pixels from the original Kenney/NatureKit file
        src = bpy.data.images.load(ORIG_TEX)
        if tuple(src.size) != tuple(img.size):
            raise RuntimeError(f"size mismatch {tuple(src.size)} vs {tuple(img.size)}")
        img.pixels = list(src.pixels)
        img.update()
        bpy.data.images.remove(src)

    img.colorspace_settings.name = "sRGB"
    os.makedirs(OUT_TEX_DIR, exist_ok=True)
    out = os.path.join(OUT_TEX_DIR, "pixelpalette.png")
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    log(f"restored atlas -> {out}")
    return img


def bake_huesat_variants(base: bpy.types.Image) -> None:
    px = list(base.pixels)
    w, h = base.size

    for mat_name, (hue, sat, val) in HUE_VARIANTS.items():
        mat = bpy.data.materials.get(mat_name)
        if not mat or not mat.use_nodes:
            log(f"skip missing mat {mat_name}")
            continue

        out_name = f"Texture_{mat_name.replace('PixelPalette_', '')}.png"
        baked = bpy.data.images.get(out_name)
        if baked is None:
            baked = bpy.data.images.new(out_name, width=w, height=h, alpha=True)
        baked.colorspace_settings.name = "sRGB"

        out_px = px[:]
        for i in range(0, len(out_px), 4):
            r, g, b, a = out_px[i : i + 4]
            if a < 0.01:
                continue
            rr, gg, bb = blender_hue_sat(r, g, b, hue, sat, val)
            out_px[i] = rr
            out_px[i + 1] = gg
            out_px[i + 2] = bb
        baked.pixels = out_px
        baked.update()

        disk = os.path.join(OUT_TEX_DIR, out_name)
        baked.filepath_raw = disk
        baked.file_format = "PNG"
        baked.save()

        # Rewire material: Texture -> Principled (no HueSat — glTF-safe)
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = baked
        tex.interpolation = "Closest"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 1.0
        log(f"baked {mat_name} -> {disk}")


def fix_palm_materials() -> None:
    specs = {
        "Material.001": (0.1902, 0.1098, 0.0657),  # trunk
        "Material.002": (0.0719, 0.2140, 0.0216),  # fronds
    }
    for name, rgb in specs.items():
        mat = bpy.data.materials.get(name)
        if not mat:
            log(f"missing {name}")
            continue
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.85
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        log(f"palm {name} -> principled {rgb}")


def ensure_pixelpalette_closest(base: bpy.types.Image) -> None:
    for mat in bpy.data.materials:
        if not mat or not mat.name.startswith("PixelPalette"):
            continue
        if mat.name in HUE_VARIANTS:
            continue  # already rewired
        if not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE":
                n.image = base
                n.interpolation = "Closest"


def bake_ground_colors() -> None:
    obj = bpy.data.objects.get("GROUND_LakeTerrain")
    if not obj or obj.type != "MESH":
        raise RuntimeError("GROUND_LakeTerrain missing")
    mesh = obj.data
    src = mesh.color_attributes.get("Col")
    if src is None:
        raise RuntimeError("Col mask missing")

    raw = [tuple(d.color) for d in src.data]
    domain = src.domain
    if "ColBake" in mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes["ColBake"])
    dst = mesh.color_attributes.new(name="ColBake", type="FLOAT_COLOR", domain=domain)
    for i, (r, _g, b, _a) in enumerate(raw):
        col = lerp(GRASS, SAND, r)
        col = lerp(col, BASIN, b)
        dst.data[i].color = (*col, 1.0)

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
    log(f"baked ColBake n={len(dst.data)}")


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
    _COL_STASH = {"domain": src.domain, "data": [tuple(d.color) for d in src.data]}
    mesh.color_attributes.remove(src)
    bake = mesh.color_attributes.get("ColBake")
    if bake:
        mesh.color_attributes.active_color = bake
    log("export prep: Col stashed")


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
    col = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain=_COL_STASH["domain"])
    for i, rgba in enumerate(_COL_STASH["data"]):
        col.data[i].color = rgba
    _COL_STASH = None
    bake = mesh.color_attributes.get("ColBake")
    if bake:
        mesh.color_attributes.active_color = bake
    log("restored Col")


def uniquify_veg_meshes() -> None:
    """Linked VEG duplicates share one mesh; object material overrides are lost
    on glTF export_apply. Make each mesh single-user without wiping face indices."""
    n = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if not (obj.name.startswith("VEG_") or obj.name.startswith("NatureKit_M_Cliff")):
            continue
        cols = {c.name for c in obj.users_collection}
        if not (cols & {"MAP_JUNGLE_UPGRADE", "JUNGLE_VEG"}):
            continue
        mats = [s.material for s in obj.material_slots]
        face_idx = [p.material_index for p in obj.data.polygons]
        if obj.data.users > 1:
            obj.data = obj.data.copy()
            n += 1
        # Assign slot materials onto mesh WITHOUT materials.clear()
        # (clear() resets every polygon material_index to 0 — breaks palms).
        for i, m in enumerate(mats):
            if i < len(obj.data.materials):
                obj.data.materials[i] = m
            else:
                obj.data.materials.append(m)
        # Drop trailing leftover slots
        while len(obj.data.materials) > len(mats):
            obj.data.materials.pop(index=len(obj.data.materials) - 1)
        for p, idx in zip(obj.data.polygons, face_idx):
            p.material_index = min(idx, max(0, len(mats) - 1))
    log(f"uniquified shared meshes touched={n}")


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
        bpy.ops.wm.open_mainfile(filepath=REVIEW)

    log(f"FILE {bpy.data.filepath}")
    base = restore_original_atlas()
    bake_huesat_variants(base)
    ensure_pixelpalette_closest(base)
    fix_palm_materials()
    bake_ground_colors()
    uniquify_veg_meshes()
    stash_col_for_export()
    try:
        export_glb()
    finally:
        restore_col_after_export()
    bpy.ops.wm.save_mainfile(filepath=REVIEW)
    log("FIDELITY_OK")


if __name__ == "__main__":
    main()
