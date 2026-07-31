"""Render die_hero preview (no hat — focus on die/hands/sword)."""
import bpy
from mathutils import Euler
from math import radians
from pathlib import Path

BLEND = Path(r"C:/Users/Антон/Desktop/threejs__journey/art/character/die_hero.blend")
OUT = Path(r"C:/Users/Антон/Desktop/threejs__journey/art/character/die_hero_preview.png")

bpy.ops.wm.open_mainfile(filepath=str(BLEND))

cam_data = bpy.data.cameras.new("PreviewCam")
cam = bpy.data.objects.new("PreviewCam", cam_data)
bpy.context.scene.collection.objects.link(cam)
# High 3/4 like the game screenshot
cam.location = (2.2, -3.2, 2.1)
cam.rotation_euler = Euler((radians(52), 0, radians(28)), "XYZ")
cam.data.lens = 40
bpy.context.scene.camera = cam

sun = bpy.data.lights.new("Sun", "SUN")
sun.energy = 4.0
sun_obj = bpy.data.objects.new("Sun", sun)
bpy.context.scene.collection.objects.link(sun_obj)
sun_obj.rotation_euler = Euler((radians(48), radians(10), radians(35)), "XYZ")

fill = bpy.data.lights.new("Fill", "AREA")
fill.energy = 120
fill.size = 3
fill_obj = bpy.data.objects.new("Fill", fill)
bpy.context.scene.collection.objects.link(fill_obj)
fill_obj.location = (-2.2, -1.5, 2.8)

mat = bpy.data.materials.new("Ground")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.52, 0.26, 1)
bpy.ops.mesh.primitive_grid_add(x_subdivisions=10, y_subdivisions=10, size=8, location=(0, 0, 0))
ground = bpy.context.active_object
ground.data.materials.append(mat)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1100
scene.render.resolution_y = 900
scene.render.filepath = str(OUT)
scene.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("wrote", OUT)
