import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
keys = ("068", "031", "Bush", "Flower", "Stump", "stump", "berry", "VEG")
for o in sorted(bpy.data.objects, key=lambda x: x.name):
    n = o.name
    if any(k in n for k in ("VEG_", "Bush_068", "Flower_031", "Stump", "stump", "Daisy", "berry")):
        print(o.name, o.type, [c.name for c in o.users_collection][:2])
# also material names
for m in bpy.data.materials:
    if any(k in m.name for k in ("068", "031", "Berry", "Flower", "Stump")):
        print("MAT", m.name)
# count name patterns
from collections import Counter
c=Counter()
for o in bpy.data.objects:
    if o.type!="MESH": continue
    if "Bush" in o.name or "Flower" in o.name or "Stump" in o.name or "stump" in o.name.lower() or "VEG" in o.name:
        base = o.name.rsplit(".",1)[0]
        # group by template-ish
        c[base.split("_")[0] if not o.name.startswith("Kit") else o.name.split("_")[2] if "KitInst" in o.name else base] += 1
print("---COUNTS---")
for k,v in c.most_common(30):
    print(k,v)
# KitInst flower/bush/stump
for o in bpy.data.objects:
    if o.name.startswith("KitInst_") and any(x in o.name for x in ("Flower", "Stump", "Bush", "stump")):
        print("KIT", o.name)
