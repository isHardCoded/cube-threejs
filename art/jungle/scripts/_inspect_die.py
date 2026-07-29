import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
for o in bpy.data.objects:
    if "Die" in o.name or "Gold" in o.name or "GOLD" in o.name or "Review" in o.name:
        print(o.name, o.type, tuple(round(v,2) for v in o.location), "hide_r", o.hide_render)
