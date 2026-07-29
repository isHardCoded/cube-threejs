"""Replace river loop with a solid lake under the floating arena, then export backdrop."""
import math
import os
import random
import bpy
from mathutils import Vector

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
TEX = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\textures\water.png"

LAKE_Z = -3.15
LAKE_R = 13.5
BANK_R = 15.2


def link_col(obj, colname):
    col = bpy.data.collections.get(colname)
    if not col:
        col = bpy.data.collections.new(colname)
        bpy.context.scene.collection.children.link(col)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def ensure_mat(name, color, tex_path=None):
    m = bpy.data.materials.get(name)
    if not m:
        m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (280, 0)
    out.location = (520, 0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.35
    if "Transmission" in bsdf.inputs:
        bsdf.inputs["Transmission"].default_value = 0.15
    m.diffuse_color = color
    if tex_path and os.path.isfile(tex_path):
        tex = nodes.new("ShaderNodeTexImage")
        tex.location = (-280, 40)
        tex.image = bpy.data.images.load(tex_path, check_existing=True)
        tex.interpolation = "Linear"
        mix = nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MIX"
        mix.inputs["Fac"].default_value = 0.35
        mix.location = (40, 40)
        mix.inputs["Color2"].default_value = color
        links.new(tex.outputs["Color"], mix.inputs["Color1"])
        links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def delete_by_prefix(*prefixes):
    for o in list(bpy.data.objects):
        if any(o.name.startswith(p) for p in prefixes):
            bpy.data.objects.remove(o, do_unlink=True)


def make_disk(name, radius, z, depth, mat, col, segments=64):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=segments, radius=radius, depth=depth,
        location=(0, 0, z),
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    # Flatten top: scale Z slightly for soft disk read
    link_col(obj, col)
    return obj


def make_ring_bank(name, inner, outer, z, height, mat, col, segments=64):
    # Torus-like bank via cylinder difference approximated as thick annulus:
    # use a torus flattened.
    bpy.ops.mesh.primitive_torus_add(
        major_radius=(inner + outer) * 0.5,
        minor_radius=(outer - inner) * 0.45,
        major_segments=segments,
        minor_segments=12,
        location=(0, 0, z),
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (1.0, 1.05, height / ((outer - inner) * 0.9))
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    link_col(obj, col)
    return obj


def place_foam(mat, count=18):
    rnd = random.Random(11)
    for i in range(count):
        a = (i / count) * math.pi * 2 + rnd.uniform(-0.08, 0.08)
        r = LAKE_R * rnd.uniform(0.82, 0.98)
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=10, ring_count=6, radius=0.22,
            location=(math.cos(a) * r, math.sin(a) * r, LAKE_Z + 0.12),
        )
        obj = bpy.context.active_object
        obj.name = f"Foam_{i:02d}"
        obj.scale = (rnd.uniform(1.2, 2.0), rnd.uniform(0.7, 1.1), 0.35)
        bpy.ops.object.transform_apply(scale=True)
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        link_col(obj, "14_WaterFX")


def export_backdrop():
    skip_prefixes = (
        "Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review",
    )
    skip_cols = {
        "01_ArenaProxy", "15_ObstacleTemplates",
        "05_PalmTemplates", "12_BushTemplates",
    }
    bpy.ops.object.select_all(action="DESELECT")
    count = 0
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if any(o.name.startswith(p) for p in skip_prefixes):
            continue
        if any(c.name in skip_cols for c in o.users_collection):
            continue
        if o.hide_render:
            continue
        o.hide_set(False)
        o.select_set(True)
        count += 1
    if bpy.context.view_layer.objects.selected:
        bpy.context.view_layer.objects.active = list(
            bpy.context.view_layer.objects.selected
        )[0]
    print("EXPORT_SELECT", count)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        use_selection=True,
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    print("WROTE", OUT, os.path.getsize(OUT))


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND)

    # Remove old river + foam
    delete_by_prefix("River", "Foam_")

    water = ensure_mat("Water", (0.28, 0.78, 0.88, 1), TEX)
    deep = ensure_mat("WaterDeep", (0.18, 0.62, 0.78, 1), TEX)
    foam = ensure_mat("WaterFoam", (0.88, 0.96, 0.98, 1), None)
    bank = ensure_mat("RiverBank", (0.94, 0.82, 0.62, 1), None)
    dirt = ensure_mat("Dirt", (0.94, 0.82, 0.62, 1), None)

    # Solid lake under arena (fills former river hole)
    make_disk("LakeDeep", LAKE_R * 0.98, LAKE_Z - 0.18, 0.22, deep, "10_River", 72)
    make_disk("LakeSurface", LAKE_R, LAKE_Z, 0.12, water, "10_River", 72)
    make_ring_bank("LakeBank", LAKE_R * 0.96, BANK_R, LAKE_Z - 0.05, 0.55, bank, "10_River", 72)

    # Soft shore pads
    rnd = random.Random(3)
    for i in range(10):
        a = (i / 10) * math.pi * 2
        r = BANK_R + rnd.uniform(0.2, 1.4)
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1, radius=rnd.uniform(1.1, 1.8),
            location=(math.cos(a) * r, math.sin(a) * r, LAKE_Z - 0.35),
        )
        o = bpy.context.active_object
        o.name = f"LakeShore_{i:02d}"
        o.scale.z = 0.35
        bpy.ops.object.transform_apply(scale=True)
        o.data.materials.clear()
        o.data.materials.append(dirt)
        link_col(o, "10_River")

    place_foam(foam, 20)

    # Keep DirtRing but it's below the lake — fine as lake bed tint.
    bpy.ops.wm.save_mainfile(filepath=BLEND)
    export_backdrop()
    print("LAKE_DONE")


if __name__ == "__main__":
    main()
