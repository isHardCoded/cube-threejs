import bpy
from mathutils import Vector
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
for name in ("Arena_Plinth", "LakeBank", "LakeShore_00", "DirtRing", "Hill_00", "Foothill_00"):
    o = bpy.data.objects.get(name)
    if not o: continue
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    xs = [v.x for v in bb]; ys=[v.y for v in bb]; zs=[v.z for v in bb]
    print(name, "bbox", (round(min(xs),2), round(max(xs),2)), (round(min(ys),2), round(max(ys),2)), (round(min(zs),2), round(max(zs),2)))
