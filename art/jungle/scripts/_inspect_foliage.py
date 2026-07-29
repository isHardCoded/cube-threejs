import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
cols = sorted(c.name for c in bpy.data.collections)
print("COLS", cols)
# count foliage-ish
keys = ("Tree", "Palm", "Bush", "Fern", "Grass", "Flower", "Vine", "Jungle", "Plant", "Leaf")
counts = {k: 0 for k in keys}
names = []
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    for k in keys:
        if k.lower() in o.name.lower():
            counts[k] += 1
            if len(names) < 40:
                names.append(o.name)
            break
print("COUNTS", counts)
print("SAMPLE", names[:40])
# templates
for cname in ("05_PalmTemplates", "12_BushTemplates", "FOLIAGE_KIT"):
    c = bpy.data.collections.get(cname)
    if not c:
        print("MISSING", cname)
        continue
    objs = [o.name for o in c.objects]
    print(cname, len(objs), objs[:20])
