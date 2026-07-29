import bpy, os

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"

bpy.ops.wm.open_mainfile(filepath=BLEND)

removed = []
for o in list(bpy.data.objects):
    if o.name.startswith("IslandCliff_") or o.name.startswith("IslandHang_"):
        removed.append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)

# Drop empty collection if present
col = bpy.data.collections.get("16_IslandEdge")
if col and len(col.objects) == 0:
    bpy.data.collections.remove(col)

print("REMOVED", len(removed), removed[:8], "...")
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
print("LEFT_ISLAND", sum(1 for o in bpy.data.objects if o.name.startswith("Island")))
