import bpy, os

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
OUT = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
RENDER = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\stage1_playfield_review.png"

bpy.ops.wm.open_mainfile(filepath=BLEND)

# VisCells are Blender-review doubles only — never ship into game GLB
for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
        o.hide_render = True
        o.hide_viewport = False

# Quick export (same rules as lake export + VisCell / GRAPHICS skip)
skip_prefixes = (
    "Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review", "VisCell_",
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

# Review render: show VisCells for screenshot
for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
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

# Restore hide_render so next export stays clean
for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
        o.hide_render = True

bpy.ops.wm.save_mainfile(filepath=BLEND)
print("STAGE1_EXPORT_OK")
