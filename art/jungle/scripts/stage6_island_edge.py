import bpy, math, os, random
from mathutils import Vector

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
RENDER = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\stage6_island_edge_review.png"

LAKE_Z = -3.15
TOP_Z = 0.05
SEGMENTS = 12
INNER_R = 6.4
OUTER_R = 8.6
BASE_OUTER = 9.4

bpy.ops.wm.open_mainfile(filepath=BLEND)
rnd = random.Random(66)


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


def get_mat(*names):
    for n in names:
        m = bpy.data.materials.get(n)
        if m:
            return m
    return None


def ensure_mat(name, color, rough=0.78):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*color, 1)
    return m


mat_top = get_mat("MAT_Grass_B", "Moss", "MAT_Grass_A") or ensure_mat("IslandTop", (0.42, 0.74, 0.36), 0.74)
mat_side = get_mat("MAT_Rock_Dark", "StoneDark", "MountainDark") or ensure_mat("IslandSide", (0.55, 0.52, 0.58), 0.82)
mat_dirt = get_mat("MAT_Dirt", "Dirt") or ensure_mat("IslandDirt", (0.90, 0.78, 0.58), 0.85)
mat_moss = get_mat("MAT_Foliage_Dark", "LeafDark", "MossDeep") or ensure_mat("IslandMoss", (0.22, 0.55, 0.38), 0.8)
mat_vine = get_mat("Vine", "LeafDark", "MAT_Foliage_Dark") or mat_moss


def assign_face_mats(obj, top, side, dirt=None):
    obj.data.materials.clear()
    obj.data.materials.append(top)
    obj.data.materials.append(side)
    if dirt:
        obj.data.materials.append(dirt)
    for p in obj.data.polygons:
        n = p.normal
        if n.z > 0.55:
            p.material_index = 0  # top grass
        elif n.z < -0.55:
            p.material_index = 2 if dirt and len(obj.data.materials) > 2 else 1
        else:
            p.material_index = 1  # dark cliff side


def bevel_smooth(obj, width=0.12, segs=3):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bev = obj.modifiers.new("Bevel", "BEVEL")
    bev.width = width
    bev.segments = segs
    bev.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier="Bevel")
    bpy.ops.object.shade_smooth()
    obj.select_set(False)


# Remove previous Stage6 objects
for o in list(bpy.data.objects):
    if o.name.startswith("IslandCliff_") or o.name.startswith("IslandHang_"):
        bpy.data.objects.remove(o, do_unlink=True)

col = ensure_col("16_IslandEdge")

# --- Main cliff ring: thick beveled segments (toy blocks, not rocky noise) ---
height = TOP_Z - (LAKE_Z + 0.15)
mid_z = (TOP_Z + LAKE_Z + 0.15) * 0.5
depth = OUTER_R - INNER_R
arc = (2 * math.pi) / SEGMENTS

for i in range(SEGMENTS):
    a0 = i * arc
    a_mid = a0 + arc * 0.5
    # radial center of segment
    r_mid = (INNER_R + OUTER_R) * 0.5
    x = math.cos(a_mid) * r_mid
    y = math.sin(a_mid) * r_mid
    # chord width
    chord = 2 * r_mid * math.sin(arc * 0.48)
    # slight thickness jitter for toy silhouette (not noise detail)
    h = height * rnd.uniform(0.92, 1.08)
    d = depth * rnd.uniform(0.9, 1.15)
    w = chord * rnd.uniform(0.92, 1.05)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, mid_z + rnd.uniform(-0.08, 0.08)))
    seg = bpy.context.active_object
    seg.name = f"IslandCliff_Seg_{i:02d}"
    seg.scale = (d, w, h)
    bpy.ops.object.transform_apply(scale=True)
    # face outward
    seg.rotation_euler.z = a_mid
    bpy.ops.object.transform_apply(rotation=True)
    bevel_smooth(seg, width=0.14, segs=3)
    assign_face_mats(seg, mat_top, mat_side, mat_dirt)
    link_col(seg, "16_IslandEdge")

# --- Wider footing lip near water (reads as thick island base) ---
for i in range(SEGMENTS):
    a_mid = i * arc + arc * 0.5
    r_mid = (OUTER_R + BASE_OUTER) * 0.5
    x = math.cos(a_mid) * r_mid
    y = math.sin(a_mid) * r_mid
    chord = 2 * r_mid * math.sin(arc * 0.48)
    bpy.ops.mesh.primitive_cube_add(
        size=1,
        location=(x, y, LAKE_Z + 0.35 + rnd.uniform(-0.05, 0.08)),
    )
    lip = bpy.context.active_object
    lip.name = f"IslandCliff_Lip_{i:02d}"
    lip.scale = ((BASE_OUTER - OUTER_R) * rnd.uniform(0.9, 1.2), chord * 0.95, 0.55)
    bpy.ops.object.transform_apply(scale=True)
    lip.rotation_euler.z = a_mid
    bpy.ops.object.transform_apply(rotation=True)
    bevel_smooth(lip, width=0.1, segs=2)
    assign_face_mats(lip, mat_dirt, mat_side, mat_moss)
    link_col(lip, "16_IslandEdge")

# --- Soft top cap ring (reads continuous island deck under floating tiles) ---
bpy.ops.mesh.primitive_torus_add(
    major_radius=(INNER_R + OUTER_R) * 0.5,
    minor_radius=(OUTER_R - INNER_R) * 0.42,
    major_segments=SEGMENTS * 2,
    minor_segments=8,
    location=(0, 0, TOP_Z - 0.05),
)
cap = bpy.context.active_object
cap.name = "IslandCliff_TopCap"
cap.scale = (1.0, 1.0, 0.35)
bpy.ops.object.transform_apply(scale=True)
bevel_smooth(cap, width=0.08, segs=2)
assign_face_mats(cap, mat_top, mat_moss, mat_dirt)
link_col(cap, "16_IslandEdge")

# --- Hanging plants on a few cliff faces ---
vine_tpl = bpy.data.objects.get("Kit_Vine_A") or bpy.data.objects.get("Tpl_vine_plant_flatTall")
grass_tpl = bpy.data.objects.get("Kit_Grass_B") or bpy.data.objects.get("Tpl_grass_leafsLarge")
hang_n = 0
for i in range(0, SEGMENTS, 2):
    a_mid = i * arc + arc * 0.5
    # mid cliff face
    r = OUTER_R - 0.15
    x = math.cos(a_mid) * r
    y = math.sin(a_mid) * r
    z = mid_z - height * 0.15
    src = vine_tpl if (i // 2) % 2 == 0 else grass_tpl
    if not src:
        # procedural hanging blob
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.35, location=(x, y, z))
        hang = bpy.context.active_object
        hang.scale = (0.45, 0.45, 1.4)
        bpy.ops.object.transform_apply(scale=True)
    else:
        hang = src.copy()
        hang.data = src.data
        bpy.context.scene.collection.objects.link(hang)
        hang.location = (x, y, z - 0.4)
        hang.rotation_euler = (0.35, 0, a_mid + math.pi)
        s = rnd.uniform(0.7, 1.15)
        hang.scale = (s * 0.7, s * 0.7, s * 1.2)
    hang.name = f"IslandHang_{hang_n:02d}"
    hang.hide_render = False
    hang.hide_set(False)
    if hang.data and hang.type == "MESH":
        hang.data.materials.clear()
        hang.data.materials.append(mat_vine)
    link_col(hang, "16_IslandEdge")
    hang_n += 1

# Hide Arena_Plinth in review (replaced by thicker exported cliff) — keep object
plinth = bpy.data.objects.get("Arena_Plinth")
if plinth:
    plinth.hide_viewport = True
    plinth.hide_render = True

bpy.ops.wm.save_mainfile(filepath=BLEND)

# --- Export ---
skip_prefixes = (
    "Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review",
    "VisCell_", "MatSwatch_", "Kit_",
)
skip_cols = {
    "01_ArenaProxy", "15_ObstacleTemplates",
    "05_PalmTemplates", "12_BushTemplates", "GRAPHICS_UPGRADE",
}
bpy.ops.object.select_all(action="DESELECT")
count = 0
cliff_n = 0
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
    if o.name.startswith("IslandCliff_") or o.name.startswith("IslandHang_"):
        cliff_n += 1
print("EXPORT_SELECT", count, "island", cliff_n)
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
print("STAGE6_OK segs", SEGMENTS, "hangs", hang_n)
