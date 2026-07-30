import bpy
from collections import Counter
# check current + dressed backup
files = [
 r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend",
 r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\backups\jungle_backdrop_review_dressed_2026-07-30_140746.blend",
]
for path in files:
    bpy.ops.wm.open_mainfile(filepath=path)
    veg=[o.name for o in bpy.data.objects if "VEG" in o.name or "068" in o.name or "031" in o.name]
    print("FILE", path.split("jungle")[-1])
    print("  objs", len(bpy.data.objects), "VEG_hits", len(veg))
    for n in sorted(veg)[:30]:
        print(" ", n)
    # stump deco
    st=[o.name for o in bpy.data.objects if "stump" in o.name.lower() or "Stump" in o.name]
    print("  stumpish", len(st), st[:15])
    # flower kit
    fl=[o.name for o in bpy.data.objects if "Flower" in o.name]
    print("  flower", len(fl), fl[:15])
    # collections
    cols=[c.name for c in bpy.data.collections if "VEG" in c.name or "MAP" in c.name or "dress" in c.name.lower() or "Vegetation" in c.name]
    print("  cols", cols)
