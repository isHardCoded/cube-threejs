import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
sc = bpy.context.scene
ee = sc.eevee
print("EEVEE_ATTRS")
for a in sorted(dir(ee)):
    if a.startswith("_"): continue
    try:
        v = getattr(ee, a)
        if callable(v): continue
        print(a, "=", v)
    except Exception as e:
        print(a, "ERR", e)
vs = sc.view_settings
print("LOOKS", [i.identifier for i in vs.bl_rna.properties["look"].enum_items] if "look" in vs.bl_rna.properties else "no look")
print("VT", [i.identifier for i in vs.bl_rna.properties["view_transform"].enum_items])
