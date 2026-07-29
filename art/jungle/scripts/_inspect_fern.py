import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
for o in bpy.data.objects:
    if o.name.startswith("Fern_"):
        print(o.name, "parent", o.parent.name if o.parent else None, "mw", tuple(round(v,2) for v in o.matrix_world.translation), "loc", tuple(round(v,2) for v in o.location))
# vines
for o in bpy.data.objects:
    if "ine" in o.name or o.name.startswith("Vine"):
        if o.type=="MESH":
            print("V", o.name, tuple(round(v,2) for v in o.matrix_world.translation))
