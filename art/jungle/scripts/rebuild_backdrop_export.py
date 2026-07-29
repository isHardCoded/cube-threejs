"""Re-export jungle backdrop: Kenney rocks, no arena plinth, fresh soft textures."""
import math
import os
import random
import bpy
from mathutils import Matrix, Vector

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
FBX_DIR = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\kenney_nature\Models\OBJ format"
TEX_DIR = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\textures"
OUT_GLB = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"

PALETTE = {
    "Wood": (0.83, 0.66, 0.47, 1),
    "WoodDark": (0.62, 0.45, 0.32, 1),
    "PalmWood": (0.83, 0.66, 0.47, 1),
    "Leaf": (0.49, 0.81, 0.42, 1),
    "LeafDark": (0.37, 0.69, 0.35, 1),
    "LeafYellow": (0.94, 0.91, 0.42, 1),
    "PalmLeafYellow": (0.94, 0.91, 0.42, 1),
    "BushLeaf": (0.49, 0.81, 0.42, 1),
    "Moss": (0.56, 0.83, 0.42, 1),
    "MossDeep": (0.44, 0.73, 0.35, 1),
    "Dirt": (0.91, 0.82, 0.64, 1),
    "RiverBank": (0.91, 0.82, 0.64, 1),
    "Hill": (0.49, 0.81, 0.42, 1),
    "HillDark": (0.37, 0.69, 0.35, 1),
    "Mountain": (0.87, 0.84, 0.80, 1),
    "MountainDark": (0.72, 0.69, 0.66, 1),
    "Stone": (0.89, 0.87, 0.83, 1),
    "StoneDark": (0.72, 0.69, 0.66, 1),
    "ObsStone": (0.91, 0.87, 0.83, 1),
    "Water": (0.48, 0.83, 0.91, 1),
    "WaterDeep": (0.35, 0.72, 0.85, 1),
    "WaterFoam": (0.94, 0.98, 1.0, 1),
}

TEX_FOR = {
    "Wood": "bark", "WoodDark": "bark", "PalmWood": "bark", "ArenaWood": "bark", "ArenaRoot": "bark",
    "Leaf": "leaf", "BushLeaf": "leaf", "Hill": "leaf",
    "LeafDark": "leaf_dark", "HillDark": "leaf_dark", "MossDeep": "leaf_dark",
    "LeafYellow": "leaf_yellow", "PalmLeafYellow": "leaf_yellow", "ObsLeafYellow": "leaf_yellow",
    "Moss": "moss", "ArenaMoss": "moss",
    "Dirt": "dirt", "ArenaSoil": "dirt", "RiverBank": "dirt",
    "Mountain": "stone", "MountainDark": "stone", "Stone": "stone", "StoneDark": "stone",
    "ArenaStone": "stone", "ArenaStoneDark": "stone", "ObsStone": "stone", "Snow": "stone",
    "Water": "water", "WaterDeep": "water", "WaterFoam": "water",
}

ROCK_OBJ = [
    "rock_largeA.obj", "rock_largeB.obj", "rock_largeC.obj", "rock_largeD.obj",
    "rock_tallA.obj", "rock_tallC.obj", "rock_tallE.obj",
    "rock_smallA.obj", "rock_smallC.obj", "rock_smallFlatA.obj",
    "stone_largeA.obj", "stone_largeC.obj", "stone_tallB.obj", "stone_smallFlatB.obj",
]


def mat_base(name: str):
    key = name.split(".")[0]
    return key


def ensure_mat(name, color):
    m = bpy.data.materials.get(name)
    if not m:
        m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    nt = m.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (280, 0)
    out.location = (520, 0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.85
    m.diffuse_color = color
    tex_name = TEX_FOR.get(name)
    if tex_name:
        path = os.path.join(TEX_DIR, f"{tex_name}.png")
        if os.path.isfile(path):
            tex = nodes.new("ShaderNodeTexImage")
            tex.location = (-320, 40)
            img = bpy.data.images.load(path, check_existing=True)
            tex.image = img
            tex.interpolation = "Linear"
            mix = nodes.new("ShaderNodeMixRGB")
            mix.blend_type = "MULTIPLY"
            mix.inputs["Fac"].default_value = 1.0
            mix.location = (40, 40)
            # brighten map toward pastel via color mix first
            tint = nodes.new("ShaderNodeMixRGB")
            tint.blend_type = "MIX"
            tint.inputs["Fac"].default_value = 0.38
            tint.location = (-80, 40)
            tint.inputs["Color2"].default_value = color
            links.new(tex.outputs["Color"], tint.inputs["Color1"])
            links.new(tint.outputs["Color"], mix.inputs["Color1"])
            mix.inputs["Color2"].default_value = color
            links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def link_col(obj, colname):
    col = bpy.data.collections.get(colname)
    if not col:
        col = bpy.data.collections.new(colname)
        bpy.context.scene.collection.children.link(col)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def import_obj(path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def join_and_name(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    meshes = [o for o in objs if o.type == "MESH"]
    if not meshes:
        return None
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    # put origin on ground (lowest Z)
    mw = obj.matrix_world
    lowest = min((mw @ Vector(v.co)).z for v in obj.data.vertices)
    obj.location.z -= lowest
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return obj


def assign_stone(obj, dark=False):
    mat = ensure_mat("StoneDark" if dark else "Stone", PALETTE["StoneDark" if dark else "Stone"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def replace_rocks():
    rnd = random.Random(7)
    old = [o for o in bpy.data.objects if o.name.startswith("Rock_")]
    placements = []
    for o in old:
        placements.append((o.matrix_world.copy(), Vector(o.dimensions), o.name))
        bpy.data.objects.remove(o, do_unlink=True)

    templates = []
    for i, fname in enumerate(ROCK_OBJ):
        path = os.path.join(FBX_DIR, fname)
        if not os.path.isfile(path):
            print("MISSING_OBJ", path)
            continue
        imported = import_obj(path)
        joined = join_and_name(imported, f"Tpl_rock_{i}")
        if not joined:
            continue
        joined.hide_set(True)
        joined.hide_render = True
        link_col(joined, "08_FillProps")
        assign_stone(joined, dark=(i % 2 == 0))
        templates.append(joined)

    if not templates:
        print("NO_ROCK_TEMPLATES")
        return

    if not placements:
        for i in range(14):
            a = (i / 14) * math.pi * 2
            r = 11.5 + (i % 3) * 1.2
            mw = Matrix.Translation(Vector((math.cos(a) * r, math.sin(a) * r, -4.2)))
            placements.append((mw, Vector((1.4, 1.1, 0.9)), f"Rock_{i:02d}"))

    for i, (mw, dims, name) in enumerate(placements):
        tpl = templates[i % len(templates)]
        inst = tpl.copy()
        inst.data = tpl.data.copy()
        bpy.context.scene.collection.objects.link(inst)
        inst.hide_set(False)
        inst.hide_render = False
        inst.matrix_world = mw
        if dims.length > 0.01 and inst.dimensions.length > 0.01:
            s = max(dims.x, dims.y) / max(0.001, max(inst.dimensions.x, inst.dimensions.y))
            s = max(0.8, min(3.2, s * rnd.uniform(0.95, 1.2)))
            inst.scale = Vector((s, s, s * rnd.uniform(0.85, 1.15)))
        inst.name = name if str(name).startswith("Rock_") else f"Rock_{i:02d}"
        inst.rotation_euler.z += rnd.uniform(0, math.pi * 2)
        assign_stone(inst, dark=(i % 3 == 0))
        link_col(inst, "08_FillProps")
    print("ROCKS_DONE", len(placements), "templates", len(templates))


def raise_insects():
    for o in bpy.data.objects:
        if o.name.startswith("Bee_") or o.name.startswith("Butterfly_"):
            o.location.z = max(o.location.z, 1.2)
        if o.name.startswith("Caterpillar_"):
            o.location.z = max(o.location.z, -3.6)
    print("INSECTS_RAISED")


def paint_materials():
    for m in list(bpy.data.materials):
        key = mat_base(m.name)
        if key in PALETTE:
            ensure_mat(key, PALETTE[key])
            # remap slots that still point at .001 variants
        elif key in TEX_FOR:
            ensure_mat(key, (0.8, 0.8, 0.8, 1))
    # Retarget object slots from Foo.001 -> Foo when possible
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            if not slot.material:
                continue
            key = mat_base(slot.material.name)
            if key in bpy.data.materials and slot.material.name != key:
                slot.material = bpy.data.materials[key]
    print("MATERIALS_PAINTED")


def export_backdrop():
    # Deselect all, select exportable backdrop meshes only
    skip_prefixes = (
        "Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review",
    )
    skip_cols = {"01_ArenaProxy", "15_ObstacleTemplates", "05_PalmTemplates", "12_BushTemplates"}
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
    print("EXPORT_SELECT", count)
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
    print("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    paint_materials()
    replace_rocks()
    raise_insects()
    paint_materials()
    bpy.ops.wm.save_mainfile(filepath=BLEND)
    export_backdrop()


if __name__ == "__main__":
    main()
