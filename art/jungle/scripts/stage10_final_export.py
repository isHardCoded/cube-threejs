import bpy, os

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
RENDER = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\stage10_final_review.png"

bpy.ops.wm.open_mainfile(filepath=BLEND)

# Ensure review-only / rejected geo stays out of game export
for o in bpy.data.objects:
    if o.name.startswith(("VisCell_", "MatSwatch_", "Kit_")):
        o.hide_render = True
    if o.name.startswith(("IslandCliff_", "IslandHang_")):
        # should already be gone; belt-and-suspenders
        bpy.data.objects.remove(o, do_unlink=True)

skip_prefixes = (
    "Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review",
    "VisCell_", "MatSwatch_", "Kit_", "IslandCliff_", "IslandHang_",
)
skip_cols = {
    "01_ArenaProxy", "15_ObstacleTemplates",
    "05_PalmTemplates", "12_BushTemplates", "GRAPHICS_UPGRADE",
}

bpy.ops.object.select_all(action="DESELECT")
count = 0
bad = []
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    if any(o.name.startswith(p) for p in skip_prefixes):
        continue
    if any(c.name in skip_cols for c in o.users_collection):
        continue
    if o.hide_render:
        continue
    # sanity: never ship proxies
    if o.name.startswith(("Arena_", "Obs_", "Col_", "VisCell_", "IslandCliff_")):
        bad.append(o.name)
        continue
    o.hide_set(False)
    o.select_set(True)
    count += 1

print("EXPORT_SELECT", count, "BAD", bad)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT, use_selection=True, export_format="GLB", export_apply=True,
    export_texcoords=True, export_normals=True, export_materials="EXPORT",
    export_image_format="AUTO",
)
print("WROTE", OUT, os.path.getsize(OUT))

# Final review still
for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
        o.hide_render = False
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

# Counts for report
def n(prefix):
    return sum(1 for o in bpy.data.objects if o.name.startswith(prefix) and o.type == "MESH")
print(
    "STAGE10_OK",
    "KitInst", n("KitInst_"),
    "FrameLeaf", n("FrameLeaf_"),
    "Ripple", n("Ripple_"),
    "LilyPad", n("LilyPad_"),
    "Island", n("Island"),
)
