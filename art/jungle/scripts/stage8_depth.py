import bpy, math, os, random
from mathutils import Vector

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
RENDER = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\stage8_depth_review.png"

bpy.ops.wm.open_mainfile(filepath=BLEND)
rnd = random.Random(88)


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


def set_mat_color(name, color, rough=None):
    m = bpy.data.materials.get(name)
    if not m:
        return False
    m.diffuse_color = (*color, 1.0)
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                # disconnect image maps feeding base if any (keep candy flat)
                for link in list(m.node_tree.links):
                    if link.to_node == n and link.to_socket.name == "Base Color":
                        from_node = link.from_node
                        if from_node.type in ("TEX_IMAGE", "MIX_RGB", "VALTORGB"):
                            # only clear photo; keep simple solid if already solid
                            pass
                n.inputs["Base Color"].default_value = (*color, 1.0)
                if rough is not None:
                    n.inputs["Roughness"].default_value = rough
    return True


def ensure_mat(name, color, rough=0.78):
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
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*color, 1)
    return m


# --- Cooler FAR materials (depth plane 3) ---
# Soft blue-gray mountains / cooler distant foliage
set_mat_color("Mountain", (0.72, 0.78, 0.88), 0.85)
set_mat_color("MountainDark", (0.52, 0.58, 0.70), 0.88)
set_mat_color("Snow", (0.88, 0.92, 0.98), 0.7)
# Keep mid foliage warmer; far trees get dedicated mat
mat_far_leaf = ensure_mat("FarLeaf", (0.38, 0.62, 0.58), 0.82)  # cool mint-teal
mat_far_leaf_d = ensure_mat("FarLeafDark", (0.28, 0.48, 0.50), 0.85)
mat_frame = ensure_mat("FrameLeaf", (0.32, 0.72, 0.42), 0.74)  # mid-warm for near frame
mat_frame_d = ensure_mat("FrameLeafDark", (0.22, 0.55, 0.34), 0.8)

# Retint far trees cooler
for o in bpy.data.objects:
    if not o.name.startswith("JungleTreeFar_"):
        continue
    if o.type != "MESH":
        continue
    # Replace leaf slots with FarLeaf*
    names = [m.name if m else "" for m in o.data.materials]
    o.data.materials.clear()
    wood = bpy.data.materials.get("Wood") or bpy.data.materials.get("MAT_Wood")
    if wood:
        o.data.materials.append(wood)
    o.data.materials.append(mat_far_leaf)
    o.data.materials.append(mat_far_leaf_d)
    me = o.data
    if me.polygons:
        zs = [p.center.z for p in me.polygons]
        zmin, zmax = min(zs), max(zs)
        span = max(0.001, zmax - zmin)
        for p in me.polygons:
            t = (p.center.z - zmin) / span
            p.material_index = 0 if t < 0.3 else (2 if (p.index % 5 == 0) else 1)

# Cool foothills slightly (already Mountain mats — now cooler)

# --- Soft far mist ---
world = bpy.context.scene.world
if world:
    mist = world.mist_settings
    mist.use_mist = True
    mist.start = 28.0
    mist.depth = 55.0
    mist.falloff = "QUADRATIC"
# Cool world slightly more atmospheric
if world and world.use_nodes:
    for n in world.node_tree.nodes:
        if n.type == "BACKGROUND":
            n.inputs["Color"].default_value = (0.55, 0.70, 0.86, 1.0)
            n.inputs["Strength"].default_value = 0.52

# --- Framing leaves (foreground, near MAIN_GAME_CAMERA) ---
# Camera ~ (11, -13, 9); frame left/right/bottom of view toward board
for o in list(bpy.data.objects):
    if o.name.startswith("FrameLeaf_"):
        bpy.data.objects.remove(o, do_unlink=True)

src_leaf = (
    bpy.data.objects.get("Kit_Grass_B")
    or bpy.data.objects.get("Tpl_grass_leafsLarge")
    or bpy.data.objects.get("Kit_Bush_A")
)
frames = [
    # left frame
    (6.5, -9.5, 1.2, 1.8, 0.4),
    (5.2, -10.8, 2.5, 2.2, -0.3),
    (7.8, -8.2, 0.6, 1.5, 0.8),
    # right frame
    (14.5, -9.0, 1.5, 2.0, -0.5),
    (15.8, -10.5, 2.8, 2.4, 0.2),
    (13.2, -8.0, 0.8, 1.6, -0.9),
    # low foreground
    (10.0, -11.5, 0.2, 1.3, 0.0),
    (8.5, -12.0, 0.4, 1.5, 0.5),
]
for i, (x, y, z, sc, yaw) in enumerate(frames):
    if src_leaf:
        o = src_leaf.copy()
        o.data = src_leaf.data
        bpy.context.scene.collection.objects.link(o)
    else:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.6, location=(x, y, z))
        o = bpy.context.active_object
        o.scale = (1.2, 0.5, 1.6)
        bpy.ops.object.transform_apply(scale=True)
    o.name = f"FrameLeaf_{i:02d}"
    o.location = (x, y, z)
    o.rotation_euler = (rnd.uniform(0.1, 0.5), rnd.uniform(-0.2, 0.2), yaw + rnd.uniform(-0.3, 0.3))
    s = sc * rnd.uniform(0.9, 1.15)
    o.scale = (s, s * 0.85, s)
    o.hide_render = False
    o.hide_set(False)
    o.data.materials.clear()
    o.data.materials.append(mat_frame if i % 2 == 0 else mat_frame_d)
    link_col(o, "17_DepthFrame")

# Soft mid haze card behind board (very transparent cool plane) — optional read of depth
for o in list(bpy.data.objects):
    if o.name.startswith("DepthHaze_"):
        bpy.data.objects.remove(o, do_unlink=True)

haze_mat = ensure_mat("DepthHaze", (0.55, 0.72, 0.82), 1.0)
haze_mat.blend_method = "BLEND" if hasattr(haze_mat, "blend_method") else getattr(haze_mat, "blend_method", "OPAQUE")
if hasattr(haze_mat, "surface_render_method"):
    try:
        haze_mat.surface_render_method = "BLENDED"
    except Exception:
        pass
if haze_mat.use_nodes:
    for n in haze_mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED" and "Alpha" in n.inputs:
            n.inputs["Alpha"].default_value = 0.12

bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 18, 2.5))
haze = bpy.context.active_object
haze.name = "DepthHaze_Far"
haze.rotation_euler.x = math.radians(78)
haze.data.materials.clear()
haze.data.materials.append(haze_mat)
link_col(haze, "17_DepthFrame")

bpy.ops.wm.save_mainfile(filepath=BLEND)

# Export
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
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT, use_selection=True, export_format="GLB", export_apply=True,
    export_texcoords=True, export_normals=True, export_materials="EXPORT",
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
print("STAGE8_OK frames", sum(1 for o in bpy.data.objects if o.name.startswith("FrameLeaf_")))
