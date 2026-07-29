import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
sc = bpy.context.scene
print("view_transform", sc.view_settings.view_transform)
print("look", getattr(sc.view_settings, "look", None))
print("exposure", sc.view_settings.exposure)
# try set AgX Medium High
for vt in ["AgX", "Filmic", "Standard", "Khronos PBR Neutral"]:
    try:
        sc.view_settings.view_transform = vt
        print("SET_VT_OK", vt, "->", sc.view_settings.view_transform)
    except Exception as e:
        print("SET_VT_FAIL", vt, e)
for look in ["None", "Medium High Contrast", "Medium Contrast", "High Contrast", "AgX - Medium High Contrast"]:
    try:
        sc.view_settings.look = look
        print("SET_LOOK_OK", look, "->", sc.view_settings.look)
    except Exception as e:
        print("SET_LOOK_FAIL", look, type(e).__name__, e)
# compositor
print("use_nodes", sc.use_nodes)
print("use_compositing", getattr(sc.render, "use_compositing", None))
if sc.node_tree:
    for n in sc.node_tree.nodes:
        print("COMP_NODE", n.type, n.name)
# sun soft shadow attrs
sun = bpy.data.objects.get("Sun")
if sun:
    L = sun.data
    for a in sorted(dir(L)):
        if "shadow" in a.lower() or "angle" in a.lower() or "contact" in a.lower():
            try:
                print("SUN", a, getattr(L, a))
            except: pass
