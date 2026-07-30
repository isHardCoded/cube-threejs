"""Bake MAT_GroundMix sand/grass/basin mask into exportable vertex colors,
fix palm Diffuse materials to Principled with real colours, re-export scene.glb.
"""
from __future__ import annotations

import os

import bpy
from mathutils import Color

JUNGLE = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT_GLB = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"

SAND = (0.86, 0.72, 0.42)
GRASS = (0.27, 0.56, 0.22)
BASIN = (0.34, 0.40, 0.26)


def log(msg: str) -> None:
    print(msg, flush=True)


def fix_palm_materials() -> None:
    specs = {
        "Material.001": (0.19, 0.11, 0.066),  # trunk brown
        "Material.002": (0.072, 0.214, 0.022),  # frond green
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
        bsdf.inputs["Roughness"].default_value = 0.75
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        log(f"fixed {name} -> {rgb}")


def bake_ground_colors() -> None:
    obj = bpy.data.objects.get("GROUND_LakeTerrain")
    if not obj or obj.type != "MESH":
        raise RuntimeError("GROUND_LakeTerrain missing")
    mesh = obj.data
    src = mesh.color_attributes.get("Col")
    if src is None:
        raise RuntimeError("Col mask missing")

    # Write final display colours into a POINT/CORNER color layer named ColBake
    if "ColBake" in mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes["ColBake"])
    dst = mesh.color_attributes.new(name="ColBake", type="BYTE_COLOR", domain=src.domain)

    for i, item in enumerate(src.data):
        r, g, b, a = item.color
        # same mix as MAT_GroundMix: grass->sand by R, then ->basin by B
        t = GRASS
        t = (
            t[0] * (1 - r) + SAND[0] * r,
            t[1] * (1 - r) + SAND[1] * r,
            t[2] * (1 - r) + SAND[2] * r,
        )
        t = (
            t[0] * (1 - b) + BASIN[0] * b,
            t[1] * (1 - b) + BASIN[1] * b,
            t[2] * (1 - b) + BASIN[2] * b,
        )
        dst.data[i].color = (*t, 1.0)

    # Replace material with Principled reading ColBake (exports as COLOR_0)
    mat = bpy.data.materials.get("MAT_GroundMix")
    if mat is None:
        mat = bpy.data.materials.new("MAT_GroundMix")
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

    # Make ColBake the active render color so glTF picks it up
    mesh.color_attributes.active_color = dst
    log(f"baked ground colours domain={src.domain} count={len(dst.data)}")


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
        obj.hide_set(False) if False else None
        try:
            obj.hide_set(False)
        except RuntimeError:
            pass
        obj.select_set(True)
        count += 1
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        use_selection=True,
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    log(f"EXPORT {OUT_GLB} meshes={count} bytes={os.path.getsize(OUT_GLB)}")


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=JUNGLE)
    fix_palm_materials()
    bake_ground_colors()
    export_glb()
    bpy.ops.wm.save_mainfile(filepath=JUNGLE)
    log("FIX_TEXTURES_OK")


if __name__ == "__main__":
    main()
