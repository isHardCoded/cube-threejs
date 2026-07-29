import bpy, os

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"

bpy.ops.wm.open_mainfile(filepath=BLEND)

# Remove the obvious green torus ring around the arena
removed = []
for o in list(bpy.data.objects):
    if o.name == "IslandCliff_TopCap" or o.name.startswith("IslandCliff_TopCap"):
        removed.append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)

# Cliff segment tops were grass → read as green circle; use dirt/rock instead
mat_top = bpy.data.materials.get("MAT_Dirt") or bpy.data.materials.get("Dirt")
mat_side = bpy.data.materials.get("MAT_Rock_Dark") or bpy.data.materials.get("StoneDark")
mat_under = bpy.data.materials.get("MAT_Rock") or bpy.data.materials.get("Stone") or mat_side

for o in bpy.data.objects:
    if not (o.name.startswith("IslandCliff_Seg_") or o.name.startswith("IslandCliff_Lip_")):
        continue
    if o.type != "MESH" or not mat_top:
        continue
    o.data.materials.clear()
    o.data.materials.append(mat_top)
    if mat_side:
        o.data.materials.append(mat_side)
    if mat_under:
        o.data.materials.append(mat_under)
    for p in o.data.polygons:
        n = p.normal
        if n.z > 0.55:
            p.material_index = 0  # dirt top, not grass
        elif n.z < -0.55:
            p.material_index = 2 if len(o.data.materials) > 2 else 1
        else:
            p.material_index = 1

print("REMOVED", removed)

bpy.ops.wm.save_mainfile(filepath=BLEND)

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
bpy.ops.export_scene.gltf(
    filepath=OUT, use_selection=True, export_format="GLB", export_apply=True,
    export_texcoords=True, export_normals=True, export_materials="EXPORT",
    export_image_format="AUTO",
)
print("WROTE", OUT, os.path.getsize(OUT))
