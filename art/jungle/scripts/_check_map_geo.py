import bpy
from collections import Counter
path = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\backups\jungle_backdrop_review_dressed_2026-07-30_140746.blend"
bpy.ops.wm.open_mainfile(filepath=path)

# objects near origin (map)
near=[]
for o in bpy.data.objects:
    if o.type!="MESH": continue
    x,y,z=o.location
    if abs(x)<80 and abs(y)<80:
        near.append(o)
print("near meshes", len(near))
prefs=Counter()
for o in near:
    p=o.name.split("_")[0] if "_" in o.name else o.name[:12]
    prefs[p]+=1
print("prefixes", prefs.most_common(25))

# wall / rock ring
for o in sorted(bpy.data.objects, key=lambda x:x.name):
    n=o.name.lower()
    if any(k in n for k in ("wall","ring","cliff","rockpack","slab","basin","terrain","water","sand")):
        if o.type=="MESH":
            print(o.name, tuple(round(v,1) for v in o.location), [c.name for c in o.users_collection][:2])
