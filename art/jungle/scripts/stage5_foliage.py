import bpy, math, os, random
from mathutils import Vector, Matrix

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
RENDER = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\stage5_foliage_review.png"
GROUND_Z = -4.5
BOARD_CLEAR = 6.2  # no kit plants on play cells

bpy.ops.wm.open_mainfile(filepath=BLEND)
rnd = random.Random(55)


def ensure_col(name):
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def link_col(obj, colname):
    col = ensure_col(colname)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def mat(name):
    return bpy.data.materials.get(name)


def paint_foliage(obj, role):
    """Assign Stage-2 kit roles by mesh height bands."""
    leaf = mat("Leaf") or mat("MAT_Foliage_Mid") or mat("BushLeaf")
    leaf_d = mat("LeafDark") or mat("MAT_Foliage_Dark") or leaf
    leaf_l = mat("MAT_Foliage_Light") or mat("Leaf") or leaf
    wood = mat("Wood") or mat("MAT_Wood") or mat("PalmWood")
    flower = {
        "red": mat("FlowerRed"),
        "yellow": mat("FlowerYellow"),
        "purple": mat("FlowerPurple"),
    }
    obj.data.materials.clear()
    if role.startswith("flower"):
        key = role.split("_")[-1]
        fm = flower.get(key) or flower["red"]
        if fm:
            obj.data.materials.append(fm)
        if wood:
            obj.data.materials.append(wood)
        return
    if wood:
        obj.data.materials.append(wood)
    if leaf:
        obj.data.materials.append(leaf)
    if leaf_d:
        obj.data.materials.append(leaf_d)
    if role in ("tree", "palm", "bush") and leaf_l:
        obj.data.materials.append(leaf_l)
    me = obj.data
    if not me.polygons or len(obj.data.materials) < 2:
        return
    zs = [p.center.z for p in me.polygons]
    zmin, zmax = min(zs), max(zs)
    span = max(0.001, zmax - zmin)
    for p in me.polygons:
        t = (p.center.z - zmin) / span
        if role in ("grass", "vine"):
            p.material_index = 1 if len(obj.data.materials) > 1 else 0
            if len(obj.data.materials) > 2 and (p.index % 4 == 0):
                p.material_index = 2
        elif t < 0.32:
            p.material_index = 0  # wood
        else:
            p.material_index = 1
            if len(obj.data.materials) > 2 and (hash(p.index) % 5 == 0):
                p.material_index = 2


def copy_mesh(src, name):
    inst = src.copy()
    inst.data = src.data.copy()
    bpy.context.scene.collection.objects.link(inst)
    inst.name = name
    inst.hide_set(False)
    inst.hide_render = False
    inst.hide_viewport = False
    inst.location = (0, 0, 0)
    inst.rotation_euler = (0, 0, 0)
    inst.scale = (1, 1, 1)
    return inst


def place_instance(tpl, name, x, y, z, scale, yaw, col):
    inst = tpl.copy()
    inst.data = tpl.data  # share mesh data (modular)
    bpy.context.scene.collection.objects.link(inst)
    inst.name = name
    inst.hide_set(False)
    inst.hide_render = False
    inst.location = (x, y, z)
    inst.rotation_euler = (0, 0, yaw)
    inst.scale = (scale, scale, scale)
    link_col(inst, col)
    return inst


def in_board(x, y):
    return abs(x) < BOARD_CLEAR and abs(y) < BOARD_CLEAR


def cluster_center(i, n, r_min, r_max, back_bias=True):
    # Prefer +Y (away from MAIN_GAME_CAMERA at y=-13) for denser back
    if back_bias and i < n * 0.55:
        a = rnd.uniform(0.35, math.pi - 0.35)  # +Y half
    else:
        a = rnd.uniform(0, math.pi * 2)
    r = rnd.uniform(r_min, r_max)
    x, y = math.cos(a) * r, math.sin(a) * r
    # nudge out of board
    tries = 0
    while in_board(x, y) and tries < 8:
        r = rnd.uniform(r_min + 1.5, r_max + 2)
        a = rnd.uniform(0, math.pi * 2)
        x, y = math.cos(a) * r, math.sin(a) * r
        tries += 1
    return x, y


# Wipe previous Stage5 instances if re-run
for o in list(bpy.data.objects):
    if o.name.startswith("KitInst_") or o.name.startswith("Kit_"):
        bpy.data.objects.remove(o, do_unlink=True)

kit_col = ensure_col("FOLIAGE_KIT")

# --- Kit masters from existing templates ---
KIT_SPEC = [
    ("Kit_Bush_A", "Tpl_plant_bushDetailed", "bush"),
    ("Kit_Bush_B", "Tpl_plant_bushLarge", "bush"),
    ("Kit_Bush_C", "Tpl_plant_bushTriangle", "bush"),
    ("Kit_Grass_A", "Tpl_grass_large", "grass"),
    ("Kit_Grass_B", "Tpl_grass_leafsLarge", "grass"),
    ("Kit_Grass_C", "Tpl_plant_flatTall", "grass"),
    ("Kit_TreeSmall_A", "Tpl_tree_tree_oak", "tree"),
    ("Kit_TreeSmall_B", "Tpl_tree_tree_detailed", "tree"),
    ("Kit_Palm_A", "Template_tree_palmDetailedShort", "palm"),
    ("Kit_Palm_B", "Template_tree_palmTall", "palm"),
    ("Kit_Flower_A", "Tpl_flower_redA", "flower_red"),
    ("Kit_Flower_B", "Tpl_flower_yellowA", "flower_yellow"),
    ("Kit_Vine_A", "Tpl_vine_plant_flatTall", "vine"),
    ("Kit_Vine_B", "Tpl_vine_plant_bushTriangle", "vine"),
]

masters = {}
for kit_name, src_name, role in KIT_SPEC:
    src = bpy.data.objects.get(src_name)
    if not src:
        print("MISSING_SRC", src_name)
        continue
    m = copy_mesh(src, kit_name)
    paint_foliage(m, role)
    m.hide_render = True  # masters stay in kit, not exported as visible clutter at origin
    m.hide_viewport = False
    link_col(m, "FOLIAGE_KIT")
    masters[kit_name] = (m, role)
    print("KIT_MASTER", kit_name, "from", src_name)

# --- Cluster placement ---
# roles per cluster slot weights
bush_keys = [k for k in masters if k.startswith("Kit_Bush")]
grass_keys = [k for k in masters if k.startswith("Kit_Grass")]
tree_keys = [k for k in masters if k.startswith("Kit_Tree")]
palm_keys = [k for k in masters if k.startswith("Kit_Palm")]
flower_keys = [k for k in masters if k.startswith("Kit_Flower")]
vine_keys = [k for k in masters if k.startswith("Kit_Vine")]

inst_i = 0
n_clusters = 11
for ci in range(n_clusters):
    cx, cy = cluster_center(ci, n_clusters, 13.0, 18.5, back_bias=True)
    size = rnd.randint(3, 7)
    # denser back clusters get more palms/trees
    back = cy > 4
    for j in range(size):
        # pick type
        roll = rnd.random()
        if roll < 0.28 and bush_keys:
            key = rnd.choice(bush_keys)
            sc = rnd.uniform(0.85, 1.35)
        elif roll < 0.48 and grass_keys:
            key = rnd.choice(grass_keys)
            sc = rnd.uniform(0.7, 1.2)
        elif roll < 0.62 and flower_keys:
            key = rnd.choice(flower_keys)
            sc = rnd.uniform(1.1, 1.8)
        elif roll < 0.78 and vine_keys:
            key = rnd.choice(vine_keys)
            sc = rnd.uniform(0.9, 1.4)
        elif (back or roll < 0.90) and palm_keys and rnd.random() < 0.55:
            key = rnd.choice(palm_keys)
            sc = rnd.uniform(0.55, 0.85)
        elif tree_keys:
            key = rnd.choice(tree_keys)
            sc = rnd.uniform(1.6, 2.6)
        else:
            continue
        tpl, role = masters[key]
        ang = rnd.uniform(0, math.pi * 2)
        rad = rnd.uniform(0.4, 2.2)
        x = cx + math.cos(ang) * rad
        y = cy + math.sin(ang) * rad
        if in_board(x, y):
            continue
        z = GROUND_Z
        if role == "palm":
            z = GROUND_Z
            sc *= 1.0
        elif role == "tree":
            z = GROUND_Z
        elif role.startswith("flower"):
            z = GROUND_Z + 0.05
        name = f"KitInst_{inst_i:03d}_{key.replace('Kit_', '')}"
        place_instance(tpl, name, x, y, z, sc, rnd.uniform(0, math.pi * 2), "FOLIAGE_KIT")
        inst_i += 1

# Extra shore palms (dense ring, not on board)
if palm_keys:
    for i in range(10):
        a = (i / 10) * math.pi * 2 + rnd.uniform(-0.08, 0.08)
        r = rnd.uniform(14.2, 16.8)
        x, y = math.cos(a) * r, math.sin(a) * r
        if in_board(x, y):
            continue
        key = palm_keys[i % len(palm_keys)]
        tpl, _ = masters[key]
        place_instance(
            tpl, f"KitInst_PalmShore_{i:02d}", x, y, GROUND_Z,
            rnd.uniform(0.6, 0.95), rnd.uniform(0, math.pi * 2), "FOLIAGE_KIT",
        )
        inst_i += 1

# --- Fix broken Fern_ / VineBridge_ / VineDrape_ stacked at origin ---
trees = [o for o in bpy.data.objects if o.name.startswith("JungleTree_") or o.name.startswith("Palm_")]
tree_pos = [(o.matrix_world.translation.x, o.matrix_world.translation.y) for o in trees]

ferns = [o for o in bpy.data.objects if o.name.startswith("Fern_")]
for i, o in enumerate(ferns):
    if tree_pos:
        tx, ty = tree_pos[i % len(tree_pos)]
        a = rnd.uniform(0, math.pi * 2)
        x = tx + math.cos(a) * rnd.uniform(1.2, 2.8)
        y = ty + math.sin(a) * rnd.uniform(1.2, 2.8)
    else:
        a = (i / max(1, len(ferns))) * math.pi * 2
        x, y = math.cos(a) * 14.5, math.sin(a) * 14.5
    if in_board(x, y):
        x *= 1.4
        y *= 1.4
    o.location = (x, y, GROUND_Z + 0.05)
    o.rotation_euler.z = rnd.uniform(0, math.pi * 2)
    o.scale = Vector((rnd.uniform(0.9, 1.4),) * 3)
    o.hide_render = False
    link_col(o, "08_FillProps")

# Vine drapes / bridges — hang near tree tops (decorative only)
vines = [o for o in bpy.data.objects if o.name.startswith("VineBridge_") or o.name.startswith("VineDrape_")]
for i, o in enumerate(vines):
    if not tree_pos:
        break
    tx, ty = tree_pos[i % len(tree_pos)]
    # offset toward neighbor tree for bridge feel
    nx, ny = tree_pos[(i + 1) % len(tree_pos)]
    x = (tx + nx) * 0.5 + rnd.uniform(-0.8, 0.8)
    y = (ty + ny) * 0.5 + rnd.uniform(-0.8, 0.8)
    if in_board(x, y):
        x = tx + 1.5
        y = ty + 1.5
    o.location = (x, y, rnd.uniform(1.8, 4.2))
    o.rotation_euler.z = math.atan2(ny - ty, nx - tx) if abs(nx - tx) + abs(ny - ty) > 0.01 else rnd.uniform(0, 6)
    s = rnd.uniform(0.8, 1.5)
    o.scale = Vector((s, s, s * rnd.uniform(0.7, 1.2)))
    o.hide_render = False
    link_col(o, "06_Vines")

bpy.ops.wm.save_mainfile(filepath=BLEND)

# --- Export: include FOLIAGE_KIT instances, skip masters Kit_* and templates ---
skip_prefixes = (
    "Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review",
    "VisCell_", "MatSwatch_", "Kit_",  # masters only (KitInst_ exported)
)
skip_cols = {
    "01_ArenaProxy", "15_ObstacleTemplates",
    "05_PalmTemplates", "12_BushTemplates", "GRAPHICS_UPGRADE",
}
bpy.ops.object.select_all(action="DESELECT")
count = 0
kit_ex = 0
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
    if o.name.startswith("KitInst_"):
        kit_ex += 1
print("EXPORT_SELECT", count, "kit_inst", kit_ex)
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

for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
        o.hide_render = False
    if o.name.startswith("MatSwatch_"):
        o.hide_render = True
cam = bpy.data.objects.get("MAIN_GAME_CAMERA")
if cam:
    bpy.context.scene.camera = cam
sc = bpy.context.scene
sc.render.resolution_x = 1280
sc.render.resolution_y = 720
sc.render.filepath = RENDER
bpy.ops.render.render(write_still=True)
print("RENDER", RENDER)
for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
        o.hide_render = True
bpy.ops.wm.save_mainfile(filepath=BLEND)
print("STAGE5_OK masters", len(masters), "instances", inst_i, "ferns_fixed", len(ferns), "vines_fixed", len(vines))
