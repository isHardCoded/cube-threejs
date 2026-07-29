import bpy, math, os, random
from mathutils import Vector

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
RENDER = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\stage4_water_review.png"

LAKE_Z = -3.15
LAKE_R = 13.5
BANK_R = 15.2

bpy.ops.wm.open_mainfile(filepath=BLEND)
rnd = random.Random(42)


def link_col(obj, colname):
    col = bpy.data.collections.get(colname)
    if not col:
        col = bpy.data.collections.new(colname)
        bpy.context.scene.collection.children.link(col)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def delete_prefix(*prefixes):
    for o in list(bpy.data.objects):
        if any(o.name.startswith(p) for p in prefixes):
            bpy.data.objects.remove(o, do_unlink=True)


def water_mat(name, color, rough, trans=0.0, bump_scale=0.0, bump_str=0.0):
    """Toy lake material: Principled + optional large soft bump (not ocean)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (720, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (420, 0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    if trans > 0:
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = trans
        elif "Transmission" in bsdf.inputs:
            bsdf.inputs["Transmission"].default_value = trans
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.28
    if bump_str > 0:
        tex = nodes.new("ShaderNodeTexCoord")
        tex.location = (-560, -80)
        mapn = nodes.new("ShaderNodeMapping")
        mapn.location = (-380, -80)
        mapn.inputs["Scale"].default_value = (bump_scale, bump_scale, bump_scale)
        noise = nodes.new("ShaderNodeTexNoise")
        noise.location = (-200, -80)
        noise.inputs["Scale"].default_value = 1.4
        noise.inputs["Detail"].default_value = 1.5
        noise.inputs["Roughness"].default_value = 0.35
        bump = nodes.new("ShaderNodeBump")
        bump.location = (160, -80)
        bump.inputs["Strength"].default_value = bump_str
        bump.inputs["Distance"].default_value = 0.35
        links.new(tex.outputs["Object"], mapn.inputs["Vector"])
        links.new(mapn.outputs["Vector"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    m.diffuse_color = (*color, 1.0)
    return m


def foam_mat(name, color, alpha=0.75):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    m.use_nodes = True
    m.blend_method = "BLEND" if hasattr(m, "blend_method") else m.blend_method
    if hasattr(m, "surface_render_method"):
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = alpha
    m.diffuse_color = (*color, alpha)
    return m


# --- Materials ---
mat_surf = water_mat("Water", (0.30, 0.78, 0.88), rough=0.42, trans=0.08, bump_scale=0.22, bump_str=0.18)
mat_deep = water_mat("WaterDeep", (0.16, 0.55, 0.72), rough=0.55, trans=0.04, bump_scale=0.18, bump_str=0.10)
mat_foam = foam_mat("WaterFoam", (0.90, 0.97, 0.98), alpha=0.72)
mat_spark = foam_mat("WaterSpark", (0.75, 0.95, 1.0), alpha=0.55)
mat_ripple = foam_mat("WaterRipple", (0.70, 0.92, 0.98), alpha=0.35)
mat_ring = foam_mat("WaterShoreRing", (0.85, 0.96, 0.98), alpha=0.45)
mat_pad = water_mat("WaterPad", (0.32, 0.72, 0.42), rough=0.78, trans=0.0, bump_scale=0.5, bump_str=0.05)
# darker pad underside tint via second mat if needed
mat_pad_vein = foam_mat("WaterPadVein", (0.22, 0.58, 0.34), alpha=0.9)

# Assign to existing lake meshes
for name, mat in (("LakeSurface", mat_surf), ("LakeDeep", mat_deep), ("LakeBank", bpy.data.materials.get("MAT_Dirt") or bpy.data.materials.get("Dirt"))):
    o = bpy.data.objects.get(name)
    if o and mat:
        o.data.materials.clear()
        o.data.materials.append(mat)

# Soften lake surface shading
for name in ("LakeSurface", "LakeDeep"):
    o = bpy.data.objects.get(name)
    if not o:
        continue
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.shade_smooth()
    o.select_set(False)

# --- Replace WaterFX with Stage 4 layers ---
delete_prefix("Foam_", "Sparkle_", "Ripple_", "ShoreRing_", "LilyPad_")

# Shore foam blobs (fewer, larger, toy)
for i in range(16):
    a = (i / 16) * math.pi * 2 + rnd.uniform(-0.06, 0.06)
    r = LAKE_R * rnd.uniform(0.86, 0.99)
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=10, ring_count=6, radius=0.28,
        location=(math.cos(a) * r, math.sin(a) * r, LAKE_Z + 0.10),
    )
    o = bpy.context.active_object
    o.name = f"Foam_{i:02d}"
    o.scale = (rnd.uniform(1.4, 2.4), rnd.uniform(0.8, 1.3), 0.28)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.shade_smooth()
    o.data.materials.clear()
    o.data.materials.append(mat_foam)
    link_col(o, "14_WaterFX")

# Soft glints (tiny flat discs)
for i in range(28):
    a = rnd.uniform(0, math.pi * 2)
    r = LAKE_R * rnd.uniform(0.25, 0.82)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=10, radius=0.12, depth=0.02,
        location=(math.cos(a) * r, math.sin(a) * r, LAKE_Z + 0.06),
    )
    o = bpy.context.active_object
    o.name = f"Sparkle_{i:02d}"
    o.scale = (rnd.uniform(0.7, 1.6), rnd.uniform(0.7, 1.6), 1.0)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.clear()
    o.data.materials.append(mat_spark)
    link_col(o, "14_WaterFX")

# Large soft ripple rings (separate planes — animated in runtime by name)
for i in range(8):
    a = (i / 8) * math.pi * 2 + 0.2
    r = LAKE_R * rnd.uniform(0.35, 0.75)
    rad = rnd.uniform(0.9, 1.8)
    bpy.ops.mesh.primitive_torus_add(
        major_radius=rad,
        minor_radius=0.06,
        major_segments=28,
        minor_segments=6,
        location=(math.cos(a) * r, math.sin(a) * r, LAKE_Z + 0.08),
    )
    o = bpy.context.active_object
    o.name = f"Ripple_{i:02d}"
    o.scale = (1.0, 1.0, 0.35)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.shade_smooth()
    o.data.materials.clear()
    o.data.materials.append(mat_ripple)
    link_col(o, "14_WaterFX")

# Shore rings (concentric soft foam rings near bank)
for i, rr in enumerate((0.92, 0.96, 1.0)):
    maj = LAKE_R * rr
    bpy.ops.mesh.primitive_torus_add(
        major_radius=maj,
        minor_radius=0.08 + i * 0.02,
        major_segments=64,
        minor_segments=6,
        location=(0, 0, LAKE_Z + 0.05 + i * 0.015),
    )
    o = bpy.context.active_object
    o.name = f"ShoreRing_{i:02d}"
    o.scale = (1.0, 1.02, 0.3)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.shade_smooth()
    o.data.materials.clear()
    o.data.materials.append(mat_ring)
    link_col(o, "14_WaterFX")

# Lily pads (toy disks) — sparse, near shore, clear board center
for i in range(10):
    a = (i / 10) * math.pi * 2 + rnd.uniform(-0.15, 0.15)
    r = LAKE_R * rnd.uniform(0.70, 0.90)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=12, radius=rnd.uniform(0.35, 0.55), depth=0.05,
        location=(math.cos(a) * r, math.sin(a) * r, LAKE_Z + 0.09),
    )
    o = bpy.context.active_object
    o.name = f"LilyPad_{i:02d}"
    o.rotation_euler.z = rnd.uniform(0, math.pi * 2)
    bpy.ops.object.shade_smooth()
    o.data.materials.clear()
    o.data.materials.append(mat_pad)
    link_col(o, "14_WaterFX")

# Keep existing LakeShore_* if present; retint foam-ish
for o in bpy.data.objects:
    if o.name.startswith("LakeShore_"):
        o.data.materials.clear()
        o.data.materials.append(mat_foam)

bpy.ops.wm.save_mainfile(filepath=BLEND)

# --- Export ---
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

# Review render
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
print("STAGE4_OK foam", sum(1 for o in bpy.data.objects if o.name.startswith("Foam_")),
      "ripple", sum(1 for o in bpy.data.objects if o.name.startswith("Ripple_")),
      "ring", sum(1 for o in bpy.data.objects if o.name.startswith("ShoreRing_")),
      "pad", sum(1 for o in bpy.data.objects if o.name.startswith("LilyPad_")))
