import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
sc = bpy.context.scene
print("ENGINE", sc.render.engine)
print("VIEW", sc.display_settings.display_device if hasattr(sc, "display_settings") else "?")
vs = sc.view_settings
print("VIEW_TRANSFORM", vs.view_transform, "LOOK", getattr(vs, "look", None), "EXPOSURE", vs.exposure, "GAMMA", vs.gamma)
w = sc.world
print("WORLD", w.name if w else None)
if w and w.use_nodes:
    for n in w.node_tree.nodes:
        if n.type == "BACKGROUND":
            print("BG_STR", n.inputs["Strength"].default_value, "COL", tuple(round(c,3) for c in n.inputs["Color"].default_value[:3]))
for o in bpy.data.objects:
    if o.type != "LIGHT":
        continue
    L = o.data
    print(f"LIGHT {o.name} type={L.type} energy={L.energy} color={tuple(round(c,3) for c in L.color)} loc={tuple(round(v,2) for v in o.location)} rot={tuple(round(v,2) for v in o.rotation_euler)} shadow={getattr(L, 'use_shadow', None)}")
    if L.type == "AREA":
        print("  size", L.size, "shape", L.shape)
    if hasattr(L, "angle"):
        print("  angle", getattr(L, "angle", None))
# EEVEE settings if present
ee = getattr(sc, "eevee", None)
if ee:
    for attr in ["use_gtao", "gtao_distance", "gtao_factor", "use_bloom", "bloom_intensity", "bloom_threshold", "use_soft_shadows", "shadow_cube_size", "shadow_cascade_size", "use_shadows"]:
        if hasattr(ee, attr):
            print("EEVEE", attr, getattr(ee, attr))
