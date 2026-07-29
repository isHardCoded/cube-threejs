import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
mats = sorted(m.name for m in bpy.data.materials)
print("MAT_COUNT", len(mats))
for n in mats:
    m = bpy.data.materials[n]
    col = tuple(round(c,3) for c in m.diffuse_color[:3])
    print(f"{n}\t{col}")
