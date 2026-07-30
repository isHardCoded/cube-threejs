import bpy
path = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\backups\jungle_backdrop_review_dressed_2026-07-30_140746.blend"
bpy.ops.wm.open_mainfile(filepath=path)
cliffs=[o for o in bpy.data.objects if "Cliff" in o.name and o.type=="MESH"]
print("cliffs", len(cliffs))
for o in cliffs[:8]:
    print(o.name, [c.name for c in o.users_collection], tuple(round(x,1) for x in o.location))
# water / ground
for n in ["GROUND_LakeTerrain","WATER_LakeSurface","LakeWater","GROUND_Arena"]:
    o=bpy.data.objects.get(n)
    print(n, "FOUND" if o else "MISS", [c.name for c in o.users_collection] if o else None)
# MAP_LAKE contents sample
col=bpy.data.collections.get("MAP_LAKE")
if col:
    print("MAP_LAKE", [o.name for o in col.objects][:20], "n", len(col.objects))
