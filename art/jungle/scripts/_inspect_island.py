import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
keys = ("Plinth", "Island", "Cliff", "Bank", "Dirt", "Ground", "Rim", "Arena_", "Hill", "Shore")
for o in sorted(bpy.data.objects, key=lambda x: x.name):
    if o.type != "MESH":
        continue
    if any(k.lower() in o.name.lower() for k in keys):
        cols = [c.name for c in o.users_collection]
        d = tuple(round(v,2) for v in o.dimensions)
        loc = tuple(round(v,2) for v in o.matrix_world.translation)
        print(f"{o.name}\tdims={d}\tloc={loc}\thide_r={o.hide_render}\tcols={cols}")
