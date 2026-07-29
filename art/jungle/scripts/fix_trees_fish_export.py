"""Replace jungle trees with Kenney Nature Kit oaks/detailed, green palms, export piranha + backdrop."""
import math
import os
import random
import bpy
from mathutils import Matrix, Vector

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OBJ_DIR = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\kenney_nature\Models\OBJ format"
OUT_SCENE = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
OUT_PIRANHA = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\props\piranha.glb"
FISH_CANDIDATES = [
    r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\quaternius_cute_fish",
]

TREE_OBJS = [
    "tree_oak.obj", "tree_detailed.obj", "tree_fat.obj", "tree_tall.obj",
    "tree_default.obj", "tree_plateau.obj",
]

GREEN = (0.47, 0.85, 0.37, 1)
GREEN_DARK = (0.28, 0.70, 0.31, 1)
WOOD = (0.83, 0.66, 0.47, 1)
WOOD_DARK = (0.62, 0.45, 0.32, 1)


def link_col(obj, colname):
    col = bpy.data.collections.get(colname)
    if not col:
        col = bpy.data.collections.new(colname)
        bpy.context.scene.collection.children.link(col)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def ensure_mat(name, color):
    m = bpy.data.materials.get(name)
    if not m:
        m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.85
    m.diffuse_color = color
    return m


def paint_slot_greens():
    # Remap yellow canopy materials to jungle greens in the blend itself
    ensure_mat("Leaf", GREEN)
    ensure_mat("LeafDark", GREEN_DARK)
    ensure_mat("LeafYellow", GREEN)  # was autumn yellow — jungle keeps green
    ensure_mat("PalmLeafYellow", GREEN)
    ensure_mat("PalmLeaf", GREEN)
    ensure_mat("BushLeaf", GREEN)
    ensure_mat("ObsLeafYellow", GREEN_DARK)
    ensure_mat("Wood", WOOD)
    ensure_mat("WoodDark", WOOD_DARK)
    ensure_mat("PalmWood", WOOD)
    print("GREENS_PAINTED")


def import_obj(path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def join_meshes(objs, name):
    meshes = [o for o in objs if o.type == "MESH"]
    if not meshes:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    # Kenney OBJ often imports Y-up into Blender → tree lies on side; stand it up.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    d = obj.dimensions
    if d.y >= d.x and d.y >= d.z:
        obj.rotation_euler = (math.radians(-90), 0, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    # put origin on ground (lowest Z)
    me = obj.data
    zmin = min(v.co.z for v in me.vertices)
    for v in me.vertices:
        v.co.z -= zmin
    me.update()
    return obj


def assign_tree_mats(obj):
    leaf = ensure_mat("Leaf", GREEN)
    leaf_d = ensure_mat("LeafDark", GREEN_DARK)
    wood = ensure_mat("Wood", WOOD)
    wood_d = ensure_mat("WoodDark", WOOD_DARK)
    # Heuristic by average vertex height / material index: Kenney objs often 1–2 mats
    obj.data.materials.clear()
    # Prefer: first slots wood-ish (darker), later leaf — but Kenney varies.
    # Force two slots: wood trunk + green crown by splitting isn't easy; paint all to leaf then
    # darken lower materials by name from imported MTL if present.
    imported_names = []
    for slot in list(obj.material_slots):
        imported_names.append(slot.material.name if slot.material else "")
    obj.data.materials.clear()
    obj.data.materials.append(wood)
    obj.data.materials.append(leaf)
    # If mesh has multiple material indices, map even→wood odd→leaf via simple pass
    me = obj.data
    if me.polygons:
        # Use Z of polygon center in local space: lower third wood, upper leaf
        zs = [(p, (p.center.z)) for p in me.polygons]
        zmin = min(z for _, z in zs)
        zmax = max(z for _, z in zs)
        mid = zmin + (zmax - zmin) * 0.35
        for p, z in zs:
            p.material_index = 0 if z < mid else 1
    # sprinkle some dark leaf on top polys
    if len(obj.data.materials) < 3:
        obj.data.materials.append(leaf_d)
    for p in me.polygons:
        if p.material_index == 1 and (hash(p.index) % 5 == 0):
            p.material_index = 2


def replace_jungle_trees():
    rnd = random.Random(21)
    templates = []
    for i, fname in enumerate(TREE_OBJS):
        path = os.path.join(OBJ_DIR, fname)
        if not os.path.isfile(path):
            continue
        imported = import_obj(path)
        joined = join_meshes(imported, f"Tpl_kenney_tree_{i}")
        if not joined:
            continue
        assign_tree_mats(joined)
        joined.hide_set(True)
        joined.hide_render = True
        link_col(joined, "04_JungleTrees")
        templates.append(joined)
    print("TREE_TEMPLATES", len(templates))
    if not templates:
        return

    targets = [o for o in bpy.data.objects if o.name.startswith("JungleTree_")]
    far = [o for o in bpy.data.objects if o.name.startswith("JungleTreeFar_")]
    for group_name, group, scale_mul in (
        ("near", targets, 1.0),
        ("far", far, 1.35),
    ):
        placements = []
        for o in group:
            placements.append((o.matrix_world.copy(), Vector(o.dimensions), o.name))
            bpy.data.objects.remove(o, do_unlink=True)
        for i, (mw, dims, name) in enumerate(placements):
            tpl = templates[i % len(templates)]
            inst = tpl.copy()
            inst.data = tpl.data.copy()
            bpy.context.scene.collection.objects.link(inst)
            inst.hide_set(False)
            inst.hide_render = False
            inst.matrix_world = mw
            # Kenney trees ~2m; scale up to previous footprint
            target_h = max(dims.z, 4.0) * scale_mul
            if inst.dimensions.z > 0.01:
                s = target_h / inst.dimensions.z
                s = max(2.2, min(7.5, s * rnd.uniform(0.92, 1.12)))
                inst.scale = Vector((s, s, s))
            inst.rotation_euler.z = rnd.uniform(0, math.pi * 2)
            inst.name = name
            assign_tree_mats(inst)
            link_col(inst, "04_JungleTrees")
        print("REPLACED", group_name, len(placements))


def find_fish_file():
    prefer = (
        "piranha", "redsnapper", "red_snapper", "flowerhorn", "flower_horn",
        "coralgrouper", "clown", "goldfish", "fish",
    )
    found = []
    for root in FISH_CANDIDATES:
        if not os.path.isdir(root):
            continue
        for dirpath, _, files in os.walk(root):
            for f in files:
                low = f.lower()
                if low.endswith((".glb", ".gltf", ".fbx", ".obj")):
                    found.append(os.path.join(dirpath, f))
    if not found:
        return None
    for key in prefer:
        for p in found:
            if key in os.path.basename(p).lower().replace(" ", "").replace("_", ""):
                return p
    # Prefer glb
    for p in found:
        if p.lower().endswith(".glb"):
            return p
    return found[0]


def make_kenney_style_piranha():
    """Chunky arcade piranha matching Nature Kit silhouette language."""
    bpy.ops.object.select_all(action="DESELECT")
    parts = []
    body_m = ensure_mat("Piranha", (0.91, 0.35, 0.40, 1))
    belly_m = ensure_mat("PiranhaBelly", (0.94, 0.75, 0.44, 1))
    fin_m = ensure_mat("PiranhaFin", (0.82, 0.25, 0.35, 1))
    eye_m = ensure_mat("Eye", (0.16, 0.12, 0.18, 1))
    tooth_m = ensure_mat("Tooth", (0.97, 0.94, 0.88, 1))

    def add(prim, **kw):
        getattr(bpy.ops.mesh, prim)(**kw)
        o = bpy.context.active_object
        parts.append(o)
        return o

    body = add("primitive_uv_sphere_add", segments=12, ring_count=8, radius=0.35, location=(0, 0, 0))
    body.scale = (1.4, 0.75, 0.95)
    bpy.ops.object.transform_apply(scale=True)
    body.data.materials.append(body_m)

    belly = add("primitive_uv_sphere_add", segments=10, ring_count=6, radius=0.22, location=(0.05, 0, -0.12))
    belly.scale = (1.2, 0.7, 0.55)
    bpy.ops.object.transform_apply(scale=True)
    belly.data.materials.append(belly_m)

    snout = add("primitive_cone_add", vertices=8, radius1=0.16, depth=0.32, location=(0.42, 0, -0.02))
    snout.rotation_euler = (0, math.pi / 2, 0)
    bpy.ops.object.transform_apply(rotation=True)
    snout.data.materials.append(body_m)

    for side in (-1, 1):
        jaw = add("primitive_cube_add", size=0.12, location=(0.48, 0, side * 0.08))
        jaw.scale = (1.4, 0.9, 0.35)
        bpy.ops.object.transform_apply(scale=True)
        jaw.data.materials.append(body_m)
        for i in range(3):
            t = add("primitive_cone_add", vertices=4, radius1=0.025, depth=0.07,
                    location=(0.55, (i - 1) * 0.04, side * 0.05))
            t.rotation_euler = (math.pi if side > 0 else 0, 0, 0)
            bpy.ops.object.transform_apply(rotation=True)
            t.data.materials.append(tooth_m)

    dorsal = add("primitive_cone_add", vertices=5, radius1=0.14, depth=0.3, location=(-0.05, 0, 0.32))
    dorsal.data.materials.append(fin_m)
    tail = add("primitive_cone_add", vertices=5, radius1=0.18, depth=0.34, location=(-0.48, 0, 0.02))
    tail.rotation_euler = (0, -math.pi / 2, 0)
    bpy.ops.object.transform_apply(rotation=True)
    tail.data.materials.append(fin_m)
    for side in (-1, 1):
        fin = add("primitive_cone_add", vertices=5, radius1=0.09, depth=0.2, location=(0.05, side * 0.28, -0.05))
        fin.rotation_euler = (side * 0.7, 0, side * 0.3)
        bpy.ops.object.transform_apply(rotation=True)
        fin.data.materials.append(fin_m)
    for side in (-1, 1):
        eye = add("primitive_uv_sphere_add", segments=8, ring_count=6, radius=0.05, location=(0.22, side * 0.2, 0.1))
        eye.data.materials.append(eye_m)

    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    fish = bpy.context.active_object
    fish.name = "Piranha"
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    return fish


def export_piranha_prop():
    # Clear selection, build fish (or import Quaternius)
    for o in list(bpy.data.objects):
        if o.name.startswith("_ExportFish"):
            bpy.data.objects.remove(o, do_unlink=True)

    src = find_fish_file()
    fish = None
    if src:
        print("FISH_SRC", src)
        before = set(bpy.data.objects)
        low = src.lower()
        try:
            if low.endswith(".glb") or low.endswith(".gltf"):
                bpy.ops.import_scene.gltf(filepath=src)
            elif low.endswith(".fbx"):
                # ASCII FBX often fails — try anyway
                bpy.ops.import_scene.fbx(filepath=src)
            elif low.endswith(".obj"):
                bpy.ops.wm.obj_import(filepath=src)
            imported = [o for o in bpy.data.objects if o not in before]
            fish = join_meshes(imported, "_ExportFish")
        except Exception as e:
            print("FISH_IMPORT_FAIL", e)
            fish = None
    if not fish:
        print("FISH_FALLBACK_KENNEY_STYLE")
        fish = make_kenney_style_piranha()
        fish.name = "_ExportFish"

    # Normalize size ~0.7m long
    if fish.dimensions.length > 0.01:
        s = 0.75 / max(fish.dimensions)
        fish.scale = Vector((s, s, s))
        bpy.ops.object.transform_apply(scale=True)

    # Recolor to candy piranha if imported
    body = ensure_mat("Piranha", (0.91, 0.35, 0.40, 1))
    for slot in fish.material_slots:
        if slot.material:
            # keep variety but tint toward red candy for piranha read
            slot.material = body

    bpy.ops.object.select_all(action="DESELECT")
    fish.select_set(True)
    bpy.context.view_layer.objects.active = fish
    os.makedirs(os.path.dirname(OUT_PIRANHA), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_PIRANHA, use_selection=True, export_format="GLB",
        export_apply=True, export_texcoords=True, export_normals=True,
        export_materials="EXPORT",
    )
    print("PIRANHA_WROTE", OUT_PIRANHA, os.path.getsize(OUT_PIRANHA))
    bpy.data.objects.remove(fish, do_unlink=True)


def export_backdrop():
    skip_prefixes = ("Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review", "_Export")
    skip_cols = {"01_ArenaProxy", "15_ObstacleTemplates", "05_PalmTemplates", "12_BushTemplates"}
    bpy.ops.object.select_all(action="DESELECT")
    n = 0
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
        n += 1
    print("EXPORT_SELECT", n)
    if bpy.context.view_layer.objects.selected:
        bpy.context.view_layer.objects.active = list(bpy.context.view_layer.objects.selected)[0]
    bpy.ops.export_scene.gltf(
        filepath=OUT_SCENE, use_selection=True, export_format="GLB",
        export_apply=True, export_texcoords=True, export_normals=True,
        export_materials="EXPORT", export_image_format="AUTO",
    )
    print("SCENE_WROTE", OUT_SCENE, os.path.getsize(OUT_SCENE))


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    paint_slot_greens()
    replace_jungle_trees()
    paint_slot_greens()
    export_piranha_prop()
    bpy.ops.wm.save_mainfile(filepath=BLEND)
    export_backdrop()
    print("DONE")


if __name__ == "__main__":
    main()
