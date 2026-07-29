import bpy, os
from mathutils import Euler

BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
RENDER = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\refs\stage3_lighting_review.png"

bpy.ops.wm.open_mainfile(filepath=BLEND)
sc = bpy.context.scene

# --- Color management ---
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"
sc.view_settings.exposure = -0.15
sc.view_settings.gamma = 1.0

# --- World: soft cool blue ---
world = sc.world or bpy.data.worlds.new("World")
sc.world = world
world.use_nodes = True
nt = world.node_tree
nodes, links = nt.nodes, nt.links
bg = None
for n in nodes:
    if n.type == "BACKGROUND":
        bg = n
        break
if not bg:
    nodes.clear()
    bg = nodes.new("ShaderNodeBackground")
    out = nodes.new("ShaderNodeOutputWorld")
    links.new(bg.outputs["Background"], out.inputs["Surface"])
bg.inputs["Color"].default_value = (0.52, 0.70, 0.88, 1.0)
bg.inputs["Strength"].default_value = 0.55

# --- Warm Sun ---
sun_obj = bpy.data.objects.get("Sun")
if not sun_obj:
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 0))
    sun_obj = bpy.context.active_object
    sun_obj.name = "Sun"
sun = sun_obj.data
sun.color = (1.0, 0.94, 0.82)
sun.energy = 2.05
sun.use_shadow = True
if hasattr(sun, "angle"):
    sun.angle = 0.045
sun_obj.rotation_euler = Euler((0.85, 0.18, 0.55), "XYZ")

# --- Cool Area fill ---
fill_obj = bpy.data.objects.get("HemiFill")
if not fill_obj:
    bpy.ops.object.light_add(type="AREA", location=(0, 0, 18))
    fill_obj = bpy.context.active_object
    fill_obj.name = "HemiFill"
fill = fill_obj.data
fill.type = "AREA"
fill.shape = "DISK"
fill.size = 28.0
fill.color = (0.62, 0.82, 0.98)
fill.energy = 220.0
fill.use_shadow = False
fill_obj.location = (0.0, -2.0, 16.0)
fill_obj.rotation_euler = Euler((0.0, 0.0, 0.0), "XYZ")

# Soft ground bounce
bounce = bpy.data.objects.get("GroundBounce")
if not bounce:
    bpy.ops.object.light_add(type="AREA", location=(0, 0, -2.5))
    bounce = bpy.context.active_object
    bounce.name = "GroundBounce"
bnc = bounce.data
bnc.type = "AREA"
bnc.shape = "DISK"
bnc.size = 22.0
bnc.color = (0.55, 0.78, 0.48)
bnc.energy = 40.0
bnc.use_shadow = False
bounce.location = (0.0, 0.0, -2.2)
bounce.rotation_euler = Euler((3.14159, 0.0, 0.0), "XYZ")

ee = sc.eevee
if hasattr(ee, "use_shadows"):
    ee.use_shadows = True
if hasattr(ee, "shadow_ray_count"):
    ee.shadow_ray_count = 2
if hasattr(ee, "shadow_step_count"):
    ee.shadow_step_count = 8
if hasattr(ee, "use_fast_gi"):
    ee.use_fast_gi = True
if hasattr(ee, "gi_diffuse_bounces"):
    ee.gi_diffuse_bounces = 3

# Mild compositor glare (Blender 5 compositing_node_group)
if hasattr(sc, "compositing_node_group"):
    ng = sc.compositing_node_group
    if ng is None:
        ng = bpy.data.node_groups.new("JungleCompositor", "CompositorNodeTree")
        sc.compositing_node_group = ng
    nodes = ng.nodes
    links = ng.links
    nodes.clear()
    rl = nodes.new("CompositorNodeRLayers")
    rl.location = (-400, 0)
    glare = None
    try:
        glare = nodes.new("CompositorNodeGlare")
    except Exception as e:
        print("GLARE_FAIL", e)
    out = None
    for type_name in ("CompositorNodeComposite", "NodeGroupOutput"):
        try:
            out = nodes.new(type_name)
            break
        except Exception:
            continue
    if glare and out:
        glare.location = (0, 0)
        out.location = (300, 0)
        try:
            glare.glare_type = "FOG_GLOW"
        except Exception:
            pass
        for attr, val in (("threshold", 0.9), ("size", 6), ("mix", 0.06), ("quality", "MEDIUM")):
            if hasattr(glare, attr):
                try:
                    setattr(glare, attr, val)
                except Exception:
                    pass
        links.new(rl.outputs["Image"], glare.inputs["Image"])
        # wire output
        if "Image" in out.inputs:
            links.new(glare.outputs["Image"], out.inputs["Image"])
        else:
            links.new(glare.outputs["Image"], out.inputs[0])
        print("COMP_BLOOM_OK")
    else:
        print("COMP_BLOOM_SKIP")
else:
    print("NO_COMPOSITING_NODE_GROUP")

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
sc.render.use_compositing = True
bpy.ops.render.render(write_still=True)
print("RENDER", RENDER)

for o in bpy.data.objects:
    if o.name.startswith("VisCell_"):
        o.hide_render = True

bpy.ops.wm.save_mainfile(filepath=BLEND)
print(
    "STAGE3_OK",
    "sun", round(sun.energy, 2),
    "fill", round(fill.energy, 1),
    "world_str", round(bg.inputs["Strength"].default_value, 2),
    "exp", sc.view_settings.exposure,
    "look", sc.view_settings.look,
)
