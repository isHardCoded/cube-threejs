import bpy, math
from mathutils import Vector

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

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

def mat(name, color, rough=0.72):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*color, 1.0)
    return m

# --- Stage 1b: visual board only ---
gcol = ensure_col("GRAPHICS_UPGRADE")

# Remove previous stage1 cells if re-run
for o in list(bpy.data.objects):
    if o.name.startswith("VisCell_"):
        bpy.data.objects.remove(o, do_unlink=True)

grass = [
    mat("MAT_Grass_A", (0.53, 0.85, 0.39), 0.70),
    mat("MAT_Grass_B", (0.38, 0.72, 0.33), 0.74),
    mat("MAT_Grass_C", (0.60, 0.88, 0.44), 0.68),
    mat("MAT_Grass_D", (0.35, 0.66, 0.28), 0.76),
]
side = mat("MAT_Grass_Side", (0.28, 0.52, 0.24), 0.82)

# Hide flat play surface in review (game already ignores it) — keep object
ps = bpy.data.objects.get("Arena_PlaySurface")
if ps:
    ps.hide_viewport = True
    ps.hide_render = True

HALF = 4  # 9x9
for x in range(-HALF, HALF + 1):
    for z in range(-HALF, HALF + 1):
        # Beveled toy cell
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, z, 0.32))
        cell = bpy.context.active_object
        cell.name = f"VisCell_{x}_{z}"
        cell.scale = (0.92, 0.92, 0.28)
        bpy.ops.object.transform_apply(scale=True)
        # slight dome / height jitter ≤ 2.5%
        jitter = (((x * 12.9898 + z * 78.233) % 1)) * 0.024 - 0.012
        cell.location.z = 0.28 + jitter
        # bevel
        bev = cell.modifiers.new("Bevel", "BEVEL")
        bev.width = 0.045
        bev.segments = 3
        bev.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier="Bevel")
        # shade smooth
        bpy.ops.object.shade_smooth()
        if hasattr(cell.data, "use_auto_smooth"):
            cell.data.use_auto_smooth = True
            cell.data.auto_smooth_angle = math.radians(60)
        # materials: top variants + darker sides via 2 slots by face normal
        checker = (x + z) & 1
        variant = (x * 3 + z * 7) % 2
        top = grass[checker + variant * 2]
        cell.data.materials.clear()
        cell.data.materials.append(top)
        cell.data.materials.append(side)
        for p in cell.data.polygons:
            # world normal approx: local after no rot — z-up faces are top
            p.material_index = 0 if abs(p.normal.z) > 0.6 else 1
        # Review-only double: keep visible in viewport, never export to game GLB.
        cell.hide_render = True
        cell.hide_viewport = False
        link(cell, gcol)

# Force green canopy in Blender too (audit found yellow again)
for name, col in [
    ("Leaf", (0.47, 0.85, 0.37)),
    ("LeafDark", (0.28, 0.70, 0.31)),
    ("LeafYellow", (0.47, 0.85, 0.37)),
    ("PalmLeafYellow", (0.47, 0.85, 0.37)),
    ("BushLeaf", (0.47, 0.85, 0.37)),
]:
    m = bpy.data.materials.get(name)
    if not m:
        continue
    m.diffuse_color = (*col, 1)
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Base Color"].default_value = (*col, 1)

bpy.ops.wm.save_mainfile(filepath=BLEND)
cells = [o for o in bpy.data.objects if o.name.startswith("VisCell_")]
print("STAGE1_CELLS", len(cells), "GRAPHICS_UPGRADE ok")
print("PlaySurface hidden", ps.hide_render if ps else None)
