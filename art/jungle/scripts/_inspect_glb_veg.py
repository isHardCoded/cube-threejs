import bpy, os
# clear and import glb
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
path = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
bpy.ops.import_scene.gltf(filepath=path)
hits=[]
for o in bpy.data.objects:
    n=o.name
    md=o.data.name if o.type=="MESH" and o.data else ""
    if any(k in n or k in md for k in ("VEG","068","031","Berry","berry","Flower","flower","Stump","stump","Daisy")):
        hits.append((n, md, o.type))
print("HIT_COUNT", len(hits))
for h in hits[:60]:
    print(h[0], "|", h[1])
# unique prefixes with flower/bush berry materials
mats=set()
for o in bpy.data.objects:
    if o.type!="MESH": continue
    for s in o.material_slots:
        if s.material and any(k in s.material.name for k in ("Berry","Flower","Red","Yellow","068","031")):
            mats.add(s.material.name)
            print("OBJ_MAT", o.name, s.material.name)
print("MATS", mats)
# count KitInst Flower
for o in bpy.data.objects:
    if "Flower" in o.name or "flower" in o.name.lower():
        print("FL", o.name)
    if "Stump" in o.name or "stump" in o.name.lower():
        print("ST", o.name)
