import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
for o in sorted(bpy.data.objects, key=lambda x: x.name):
    n = o.name
    if any(k in n for k in ("Lake", "Water", "Foam", "Spark", "Ripple", "Pad", "Ring")):
        cols = [c.name for c in o.users_collection]
        loc = tuple(round(v,2) for v in o.location)
        print(f"{n}\ttype={o.type}\thide_r={o.hide_render}\tloc={loc}\tcols={cols}")
