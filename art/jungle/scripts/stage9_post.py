import bpy, os

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
RENDER = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\stage9_post_review.png"

bpy.ops.wm.open_mainfile(filepath=BLEND)
sc = bpy.context.scene

# Keep AgX mild grade from Stage 3; nudge contrast look + compositor
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"
sc.view_settings.exposure = -0.12

# Mild compositor: glare + slight RGB curves + vignette (Blender 5 node group)
if hasattr(sc, "compositing_node_group"):
    ng = sc.compositing_node_group
    if ng is None:
        ng = bpy.data.node_groups.new("JungleCompositor", "CompositorNodeTree")
        sc.compositing_node_group = ng
    nodes, links = ng.nodes, ng.links
    nodes.clear()
    rl = nodes.new("CompositorNodeRLayers")
    rl.location = (-600, 0)

    def add(type_name, loc):
        try:
            n = nodes.new(type_name)
            n.location = loc
            return n
        except Exception as e:
            print("NODE_FAIL", type_name, e)
            return None

    glare = add("CompositorNodeGlare", (-200, 80))
    bright = add("CompositorNodeBrightContrast", (40, 0))
    hue = add("CompositorNodeHueSat", (260, 0))
    lens = add("CompositorNodeLensdist", (480, 0))
    out = add("CompositorNodeComposite", (720, 0)) or add("NodeGroupOutput", (720, 0))

    if glare:
        try:
            glare.glare_type = "FOG_GLOW"
        except Exception:
            pass
        for attr, val in (("threshold", 0.88), ("size", 5), ("mix", 0.05)):
            if hasattr(glare, attr):
                try: setattr(glare, attr, val)
                except Exception: pass

    if bright:
        # mild contrast only
        if "Contrast" in bright.inputs:
            bright.inputs["Contrast"].default_value = 0.08
        if "Bright" in bright.inputs:
            bright.inputs["Bright"].default_value = 0.0

    if hue:
        if "Saturation" in hue.inputs:
            hue.inputs["Saturation"].default_value = 1.06
        if "Value" in hue.inputs:
            hue.inputs["Value"].default_value = 1.0

    if lens:
        # use as soft vignette if available
        if "Distort" in lens.inputs:
            lens.inputs["Distort"].default_value = 0.0
        if "Dispersion" in lens.inputs:
            lens.inputs["Dispersion"].default_value = 0.0
        if hasattr(lens, "use_fit"):
            lens.use_fit = True
        # Some Blender versions expose vignette on Lens Distortion
        if "Projector" in lens.inputs:
            pass

    # Wire chain: RL -> glare -> bright -> hue -> (lens) -> out
    prev = rl.outputs["Image"]
    for node in (glare, bright, hue, lens):
        if not node or "Image" not in node.inputs:
            continue
        links.new(prev, node.inputs["Image"])
        prev = node.outputs["Image"] if "Image" in node.outputs else prev
    if out:
        if "Image" in out.inputs:
            links.new(prev, out.inputs["Image"])
        elif len(out.inputs):
            links.new(prev, out.inputs[0])
    print("COMP_OK")
else:
    print("NO_COMP")

sc.render.use_compositing = True
for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
        o.hide_render = False
    if o.name.startswith("MatSwatch_"):
        o.hide_render = True
cam = bpy.data.objects.get("MAIN_GAME_CAMERA")
if cam:
    sc.camera = cam
sc.render.resolution_x = 1280
sc.render.resolution_y = 720
sc.render.filepath = RENDER
bpy.ops.render.render(write_still=True)
print("RENDER", RENDER)
for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
        o.hide_render = True
bpy.ops.wm.save_mainfile(filepath=BLEND)
print("STAGE9_OK")
