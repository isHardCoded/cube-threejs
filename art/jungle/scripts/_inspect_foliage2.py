import bpy, math
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
# tree positions sample
for prefix in ("JungleTree_", "Palm_", "Bush_", "Fern_", "Vine_"):
    objs = [o for o in bpy.data.objects if o.name.startswith(prefix)]
    if not objs:
        print(prefix, 0)
        continue
    rs = []
    for o in objs[:5]:
        r = math.hypot(o.location.x, o.location.y)
        rs.append((o.name, tuple(round(v,2) for v in o.location), round(r,2)))
    print(prefix, "count", len(objs), "sample", rs)
# template hide
for o in bpy.data.objects:
    if o.name.startswith("Template_") or o.name.startswith("Tpl_"):
        print("TPL", o.name, "hide_r", o.hide_render, "loc", tuple(round(v,2) for v in o.location), "dims", tuple(round(v,2) for v in o.dimensions))
