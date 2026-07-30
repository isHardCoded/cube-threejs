import bpy
path = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\backups\jungle_backdrop_review_dressed_2026-07-30_140746.blend"
bpy.ops.wm.open_mainfile(filepath=path)

# OuterBush sources
from collections import Counter
outer = [o for o in bpy.data.objects if o.name.startswith("VEG_OuterBush") or o.name.startswith("VEG_BushFill")]
print("outer/fill", [(o.name, o.data.name if o.data else None) for o in outer])

# Drift
for o in bpy.data.objects:
    if o.name.startswith("VEG_Drift") or o.name.startswith("VEG_Log"):
        print(o.name, o.data.name, [round(d,2) for d in o.dimensions], tuple(round(x,2) for x in o.location))

# NatureKit masters collection / hide / location
for n in ["NatureKit_M_BerryBush1","NatureKit_M_BerryBush2","NatureKit_M_Bush1","NatureKit_M_Flower1","NatureKit_M_Flower2","NatureKit_M_Treetrunk","NatureKit_M_Log"]:
    o=bpy.data.objects.get(n)
    if not o: print("missing", n); continue
    print(n, "loc", tuple(round(x,1) for x in o.location), "hide_r", o.hide_render, "cols", [c.name for c in o.users_collection])

# Mush - user said пеньки not mushrooms but list them
print("mush count", sum(1 for o in bpy.data.objects if o.name.startswith("VEG_Mush")))
