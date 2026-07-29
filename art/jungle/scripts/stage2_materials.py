import bpy, math, os
from mathutils import Vector

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
RENDER = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\stage2_materials_review.png"

bpy.ops.wm.open_mainfile(filepath=BLEND)

# Stage 2 candy kit (sRGB linear-ish floats Blender expects in Principled)
KIT = {
    "MAT_Grass_A":      ((0.55, 0.86, 0.40), 0.70),
    "MAT_Grass_B":      ((0.42, 0.74, 0.36), 0.74),
    "MAT_Grass_C":      ((0.62, 0.90, 0.48), 0.68),
    "MAT_Grass_D":      ((0.32, 0.64, 0.30), 0.76),
    "MAT_Grass_Side":   ((0.26, 0.50, 0.24), 0.82),
    "MAT_Rock":         ((0.86, 0.84, 0.88), 0.78),
    "MAT_Rock_Dark":    ((0.68, 0.66, 0.74), 0.82),
    "MAT_Wood":         ((0.90, 0.62, 0.42), 0.72),
    "MAT_Wood_Dark":    ((0.78, 0.50, 0.34), 0.78),
    "MAT_Foliage_Light":((0.48, 0.84, 0.58), 0.70),  # cool distant
    "MAT_Foliage_Mid":  ((0.36, 0.74, 0.48), 0.74),
    "MAT_Foliage_Dark": ((0.22, 0.58, 0.42), 0.80),
    "MAT_Dirt":         ((0.94, 0.82, 0.62), 0.85),
    "MAT_Water":        ((0.30, 0.78, 0.88), 0.28),
    "MAT_Water_Deep":   ((0.18, 0.62, 0.78), 0.35),
    "MAT_Water_Foam":   ((0.90, 0.97, 0.98), 0.45),
    "MAT_Goldie":       ((0.95, 0.78, 0.28), 0.42),
}

# Existing scene materials remapped onto kit roles (warm board / mid bush / cool far)
REMAP = {
    "Moss": "MAT_Grass_A", "ArenaMoss": "MAT_Grass_A", "ArenaTileA": "MAT_Grass_A",
    "MossDeep": "MAT_Grass_B", "ArenaTileB": "MAT_Grass_B", "ArenaPad": "MAT_Grass_B",
    "ArenaPadLine": "MAT_Grass_C",
    "Leaf": "MAT_Foliage_Mid", "BushLeaf": "MAT_Foliage_Mid",
    "PalmLeafYellow": "MAT_Foliage_Mid", "LeafYellow": "MAT_Foliage_Mid",
    "PalmLeaf": "MAT_Foliage_Mid",
    "LeafDark": "MAT_Foliage_Dark", "ObsLeafYellow": "MAT_Foliage_Dark", "Vine": "MAT_Foliage_Dark",
    "Hill": "MAT_Foliage_Light", "HillDark": "MAT_Foliage_Dark",
    "Wood": "MAT_Wood", "PalmWood": "MAT_Wood", "ArenaWood": "MAT_Wood", "ArenaRoot": "MAT_Wood_Dark",
    "WoodDark": "MAT_Wood_Dark",
    "Stone": "MAT_Rock", "Mountain": "MAT_Rock", "ArenaStone": "MAT_Rock", "ObsStone": "MAT_Rock",
    "StoneDark": "MAT_Rock_Dark", "MountainDark": "MAT_Rock_Dark", "ArenaStoneDark": "MAT_Rock_Dark",
    "Dirt": "MAT_Dirt", "ArenaSoil": "MAT_Dirt", "RiverBank": "MAT_Dirt",
    "Water": "MAT_Water", "WaterDeep": "MAT_Water_Deep", "WaterFoam": "MAT_Water_Foam",
    "WaterSpark": "MAT_Water_Foam",
    "ArenaGold": "MAT_Goldie", "TempleGold": "MAT_Goldie", "RuneGlow": "MAT_Goldie",
}


def ensure_col(name):
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def build_kit_mat(name, color, rough):
    """Principled + very soft large-scale procedural tint (Eevee-safe)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (700, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (420, 0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    # Soft macro variation only — Fall Guys candy, not photo noise
    tex_coord = nodes.new("ShaderNodeTexCoord")
    tex_coord.location = (-680, 40)
    mapping = nodes.new("ShaderNodeMapping")
    mapping.location = (-500, 40)
    mapping.inputs["Scale"].default_value = (0.35, 0.35, 0.35)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.location = (-320, 40)
    noise.inputs["Scale"].default_value = 2.2
    noise.inputs["Detail"].default_value = 2.0
    noise.inputs["Roughness"].default_value = 0.45
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-120, 40)
    # Keep both stops close to base hue — tiny value shift only
    r, g, b = color
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (r * 0.92, g * 0.92, b * 0.92, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (min(1, r * 1.06), min(1, g * 1.06), min(1, b * 1.06), 1)

    mix = nodes.new("ShaderNodeMixRGB")
    mix.location = (160, 40)
    mix.blend_type = "MIX"
    # Water / goldie keep flatter plastic; rock/wood get a bit more soft variation
    fac = 0.10 if "Water" in name or "Goldie" in name else 0.16
    if "Rock" in name:
        fac = 0.18
    mix.inputs["Fac"].default_value = fac
    mix.inputs["Color1"].default_value = (*color, 1.0)

    links.new(tex_coord.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], mix.inputs["Color2"])
    links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])

    bsdf.inputs["Roughness"].default_value = rough
    if "Water" in name and "Foam" not in name:
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 0.12
        elif "Transmission" in bsdf.inputs:
            bsdf.inputs["Transmission"].default_value = 0.12
        bsdf.inputs["Specular IOR Level"].default_value = 0.35 if "Specular IOR Level" in bsdf.inputs else 0.5
    if "Goldie" in name:
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.18
        bsdf.inputs["Roughness"].default_value = rough

    m.diffuse_color = (*color, 1.0)
    return m


def set_mat_color(mat_name, color, rough=None):
    m = bpy.data.materials.get(mat_name)
    if not m:
        return False
    m.diffuse_color = (*color, 1.0)
    if not m.use_nodes:
        m.use_nodes = True
    bsdf = None
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            bsdf = n
            break
    if not bsdf:
        return False
    # If Image Texture feeds Base Color, disconnect photo maps (Stage 2: flat candy)
    for link in list(m.node_tree.links):
        if link.to_node == bsdf and link.to_socket.name == "Base Color":
            m.node_tree.links.remove(link)
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    if rough is not None:
        bsdf.inputs["Roughness"].default_value = rough
    return True


# --- Build kit ---
for name, (col, rough) in KIT.items():
    build_kit_mat(name, col, rough)

# --- Remap scene materials onto kit colors (keep material names for game palette keys) ---
for src, kit_name in REMAP.items():
    col, rough = KIT[kit_name]
    set_mat_color(src, col, rough)

# Also push kit colors onto Stage 1 grass mats already on VisCells
for name in ("MAT_Grass_A", "MAT_Grass_B", "MAT_Grass_C", "MAT_Grass_D", "MAT_Grass_Side"):
    if name in KIT:
        # VisCells already use these names — rebuild ensures procedural nodes exist
        pass

# --- Swatch board for review (GRAPHICS_UPGRADE) ---
gcol = ensure_col("GRAPHICS_UPGRADE")
for o in list(bpy.data.objects):
    if o.name.startswith("MatSwatch_"):
        bpy.data.objects.remove(o, do_unlink=True)

order = list(KIT.keys())
cols = 6
for i, name in enumerate(order):
    x = (i % cols) * 1.15 - 12.5
    y = -(i // cols) * 1.15 - 10.5
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, 0.4))
    sw = bpy.context.active_object
    sw.name = f"MatSwatch_{name}"
    sw.scale = (0.95, 0.95, 0.18)
    bpy.ops.object.transform_apply(scale=True)
    bev = sw.modifiers.new("Bevel", "BEVEL")
    bev.width = 0.04
    bev.segments = 2
    bpy.ops.object.modifier_apply(modifier="Bevel")
    bpy.ops.object.shade_smooth()
    sw.data.materials.clear()
    sw.data.materials.append(bpy.data.materials[name])
    sw.hide_render = True  # review viewport / optional render pass
    sw.hide_viewport = False
    link(sw, gcol)

# VisCells stay review-only
for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
        o.hide_render = True
        o.hide_viewport = False

bpy.ops.wm.save_mainfile(filepath=BLEND)

# --- Export (no VisCell / swatches / gameplay proxies) ---
skip_prefixes = (
    "Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review", "VisCell_", "MatSwatch_",
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

# Review render: show VisCells + swatches briefly
for o in bpy.data.objects:
    if o.name.startswith("VisCell_") or o.name.startswith("MatSwatch_"):
        o.hide_render = False
cam = bpy.data.objects.get("MAIN_GAME_CAMERA")
if cam:
    bpy.context.scene.camera = cam
scene = bpy.context.scene
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.filepath = RENDER
bpy.ops.render.render(write_still=True)
print("RENDER", RENDER)
for o in bpy.data.objects:
    if o.name.startswith("VisCell_") or o.name.startswith("MatSwatch_"):
        o.hide_render = True
bpy.ops.wm.save_mainfile(filepath=BLEND)
print("STAGE2_OK", "kit", len(KIT), "remap", len(REMAP))
