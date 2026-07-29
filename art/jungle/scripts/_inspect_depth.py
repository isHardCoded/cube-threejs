import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
# far mountains / hills / framing
for prefix in ("Mountain_", "Foothill_", "Hill_", "JungleTreeFar_", "Frame_"):
    objs = [o for o in bpy.data.objects if o.name.startswith(prefix)]
    print(prefix, len(objs))
    for o in objs[:3]:
        print(" ", o.name, tuple(round(v,2) for v in o.matrix_world.translation), "mats", [m.name for m in o.data.materials] if o.type=="MESH" else [])
# world fog?
sc = bpy.context.scene
print("mist", getattr(sc.world, "mist_settings", None))
if hasattr(sc.eevee, "use_volumetric"):
    print("vol", sc.eevee.use_volumetric)
