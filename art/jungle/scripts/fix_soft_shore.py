"""Bright candy ground bake with soft sand↔water falloff, transparent water, re-export."""
from __future__ import annotations

import math
import os

import bpy

JUNGLE = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT_GLB = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"

# Candy colours (approx sRGB, match jungle.js MOSS / DIRT)
GRASS = (0.55, 0.86, 0.40)      # bright playable grass
GRASS_DEEP = (0.42, 0.74, 0.36)
SAND = (0.94, 0.84, 0.55)       # warm beach
SAND_WET = (0.78, 0.72, 0.52)   # soft wet band at shoreline
BASIN = (0.25, 0.48, 0.42)      # underwater (green-teal, not black)


def log(msg: str) -> None:
    print(msg, flush=True)


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 <= edge0:
        return 0.0 if x < edge0 else 1.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return (
        a[0] * (1 - t) + b[0] * t,
        a[1] * (1 - t) + b[1] * t,
        a[2] * (1 - t) + b[2] * t,
    )


def bake_ground_colors() -> None:
    obj = bpy.data.objects["GROUND_LakeTerrain"]
    mesh = obj.data
    src = mesh.color_attributes.get("Col")
    if src is None:
        raise RuntimeError("Col mask missing")

    if "ColBake" in mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes["ColBake"])
    dst = mesh.color_attributes.new(name="ColBake", type="BYTE_COLOR", domain=src.domain)

    # Two-pass: first copy raw, then soft-dilate sand into neighbours for a wider beach
    raw = [tuple(d.color) for d in src.data]
    sand_w = [smoothstep(0.08, 0.75, r) for r, g, b, a in raw]
    basin_w = [smoothstep(0.05, 0.7, b) for r, g, b, a in raw]

    # Dilate sand weights across face corners sharing a vertex (approx via neighbour loops)
    # Build loop -> vertex map then average sand of adjacent loops
    vert_sand = {}
    for poly in mesh.polygons:
        loops = list(poly.loop_indices)
        for li in loops:
            vi = mesh.loops[li].vertex_index
            vert_sand.setdefault(vi, []).append(sand_w[li])
    vert_sand_avg = {vi: sum(vs) / len(vs) for vi, vs in vert_sand.items()}

    dilated = list(sand_w)
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            # pull sand outward a bit
            dilated[li] = max(dilated[li], vert_sand_avg.get(vi, 0.0) * 0.85)

    for i, (r, g, b, a) in enumerate(raw):
        sand = dilated[i]
        basin = basin_w[i]
        # wet band peaks where sand meets water
        wet = sand * (1.0 - sand) * 2.2
        wet = max(wet, basin * (1.0 - sand) * 0.65)
        wet = max(0.0, min(1.0, wet))

        # base grass with slight depth variation from unused G channel / noise-free
        grass = lerp(GRASS, GRASS_DEEP, 0.35 * (1.0 - sand))
        col = lerp(grass, SAND, sand)
        col = lerp(col, SAND_WET, wet)
        col = lerp(col, BASIN, basin)
        dst.data[i].color = (*col, 1.0)

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
    log(f"baked soft ground colours count={len(dst.data)}")


def fix_water_materials() -> None:
    for name, alpha in (("Water", 0.52), ("WaterDeep", 0.72)):
        mat = bpy.data.materials.get(name)
        if not mat or not mat.use_nodes:
            log(f"water mat missing {name}")
            continue
        mat.blend_method = "BLEND"
        # Blender 5 may use surface_render_method
        if hasattr(mat, "surface_render_method"):
            try:
                mat.surface_render_method = "BLENDED"
            except Exception:
                pass
        for n in mat.node_tree.nodes:
            if n.type != "BSDF_PRINCIPLED":
                continue
            if "Alpha" in n.inputs:
                n.inputs["Alpha"].default_value = alpha
            if "Transmission Weight" in n.inputs:
                n.inputs["Transmission Weight"].default_value = 0.35 if name == "Water" else 0.15
            if "Roughness" in n.inputs:
                n.inputs["Roughness"].default_value = 0.18
        log(f"water {name} alpha={alpha}")


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
    bake_ground_colors()
    fix_water_materials()
    export_glb()
    bpy.ops.wm.save_mainfile(filepath=JUNGLE)
    log("SOFT_SHORE_OK")


if __name__ == "__main__":
    main()
