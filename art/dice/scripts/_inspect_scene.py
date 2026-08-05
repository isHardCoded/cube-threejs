import bpy
from mathutils import Vector

# Collections / platform names
for c in bpy.data.collections:
    objs = [o.name for o in c.objects if o.type == "MESH"]
    print(f"COL {c.name}: {len(objs)} meshes")
    if "PLAT" in c.name.upper() or c.name == "Collection":
        print("  ", objs[:80])

# Camera
cam = bpy.data.objects.get("Camera")
if cam:
    print("CAM loc", list(cam.location))
    print("CAM rot", list(cam.rotation_euler))
    print("CAM lens", cam.data.lens)
    # look target approximate from matrix
    print("CAM matrix_world", [list(v) for v in cam.matrix_world])

# Pedestal-like objects
for o in bpy.data.objects:
    n = o.name.lower()
    if any(k in n for k in ("ped", "plat", "hex", "you", "rival", "deck", "main")):
        print(f"KEY {o.name} loc={list(o.location)} dim={list(o.dimensions)}")

# Lights summary
for o in bpy.data.objects:
    if o.type == "LIGHT":
        print(f"LIGHT {o.name} type={o.data.type} loc={list(o.location)} energy={getattr(o.data,'energy',None)} color={list(o.data.color)}")
