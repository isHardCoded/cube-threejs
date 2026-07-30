import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

# search all object names, mesh names, and parent
hits = []
for o in bpy.data.objects:
    blob = o.name
    if o.data and hasattr(o.data, "name"):
        blob += " |mesh=" + o.data.name
    if "068" in blob or "031" in blob or "VEG" in blob or "Berry" in blob.lower() or "daisy" in blob.lower():
        hits.append(blob)
print("HITS", len(hits))
for h in hits[:50]:
    print(h)

# list unique bush mesh datablock names
bush_meshes = set()
for o in bpy.data.objects:
    if o.type=="MESH" and ("Bush" in o.name or "bush" in o.name):
        bush_meshes.add(o.data.name if o.data else "?")
print("BUSH_MESHES", sorted(bush_meshes)[:40])

# flower objects
for o in bpy.data.objects:
    if "Flower" in o.name or "flower" in o.name:
        print("FLOWER_OBJ", o.name, "mesh", o.data.name if o.data else None, "hide", o.hide_render)

# KitInst with Flower
for o in bpy.data.objects:
    if "Flower" in o.name:
        print("F", o.name, tuple(round(v,2) for v in o.matrix_world.translation))

# stump decorative (not Obs/Col)
for o in bpy.data.objects:
    if "stump" in o.name.lower() and not o.name.startswith(("Obs_","Col_","Tpl_")):
        print("STUMP_DECO", o.name)
