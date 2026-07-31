"""
Build game die + levitating hands + sword.
Matches src/game/dice.js: RoundedBoxGeometry(1,1,1,4,0.09) + pip layouts.
Hierarchy uses LOCAL transforms only (no keep_transform tricks).
"""
import bpy
import bmesh
from mathutils import Vector
from math import radians
from pathlib import Path

OUT_DIR = Path(r"C:/Users/Антон/Desktop/threejs__journey/art/character")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


def mat(name, color, roughness=0.55, metalness=0.1):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    key = "Metallic" if "Metallic" in bsdf.inputs else "Metalness"
    if key in bsdf.inputs:
        bsdf.inputs[key].default_value = metalness
    return m


def select_active(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_mods(obj):
    select_active(obj)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def shade(obj, angle=50):
    select_active(obj)
    bpy.ops.object.shade_smooth_by_angle(angle=radians(angle))


def apply_scale(obj):
    select_active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def game_to_blender(v):
    x, y, z = v
    return Vector((x, -z, y))


def add_bevel(obj, width, segs=2, angle=30):
    bev = obj.modifiers.new("Bevel", "BEVEL")
    bev.width = width
    bev.segments = segs
    bev.limit_method = "ANGLE"
    bev.angle_limit = radians(angle)
    apply_mods(obj)


def link_parent(obj, parent):
    """Parent with identity local offset = current world if parent at origin later.
    Call ONLY when parent is already at final world transform and obj is unparented
    at the desired world location — we convert to local manually.
    """
    obj.parent = parent
    # leave loc/rot/scale as currently set IF they were authored as local to parent


def make_die(mat_body, mat_pip, parent):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    die = bpy.context.active_object
    die.name = "DIE_Body"
    die.data.materials.append(mat_body)
    add_bevel(die, 0.09, segs=4, angle=40)
    shade(die, 50)
    die.parent = parent
    die.location = (0, 0, 0)
    die.rotation_euler = (0, 0, 0)

    O = 0.24
    layouts = {
        1: [(0, 0)],
        2: [(-O, -O), (O, O)],
        3: [(-O, -O), (0, 0), (O, O)],
        4: [(-O, -O), (-O, O), (O, -O), (O, O)],
        5: [(-O, -O), (-O, O), (0, 0), (O, -O), (O, O)],
        6: [(-O, -O), (-O, 0), (-O, O), (O, -O), (O, 0), (O, O)],
    }
    faces = [
        (1, Vector((0, 1, 0))),
        (6, Vector((0, -1, 0))),
        (2, Vector((0, 0, 1))),
        (5, Vector((0, 0, -1))),
        (3, Vector((1, 0, 0))),
        (4, Vector((-1, 0, 0))),
    ]
    i = 0
    for value, gnormal in faces:
        q = Vector((0, 1, 0)).rotation_difference(gnormal)
        for u, v in layouts[value]:
            bpos = game_to_blender(q @ Vector((u, 0.495, v)))
            bpy.ops.mesh.primitive_cylinder_add(
                radius=0.075, depth=0.04, vertices=20, location=(0, 0, 0)
            )
            pip = bpy.context.active_object
            pip.name = f"DIE_Pip_{value}_{i}"
            i += 1
            bn = game_to_blender(gnormal).normalized()
            pip.rotation_mode = "QUATERNION"
            pip.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(bn)
            pip.data.materials.append(mat_pip)
            pip.parent = die
            pip.location = bpos
    return die


def make_fist_meshes(name, mat_body, parent_empty, *, mirror=False):
    """Build fist parts as LOCAL children of parent_empty. mirror=True flips for left hand."""
    sx = -1.0 if mirror else 1.0

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    palm = bpy.context.active_object
    palm.name = f"{name}_Palm"
    palm.scale = (0.16, 0.13, 0.18)
    apply_scale(palm)
    palm.data.materials.append(mat_body)
    add_bevel(palm, 0.022, segs=3)
    shade(palm, 45)
    palm.parent = parent_empty
    palm.location = (0, 0, 0)

    for i, x in enumerate((-0.06, -0.02, 0.02, 0.06)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        f = bpy.context.active_object
        f.name = f"{name}_Finger_{i}"
        f.scale = (0.036, 0.08, 0.05)
        apply_scale(f)
        f.rotation_euler = (radians(28), 0, 0)
        select_active(f)
        bpy.ops.object.transform_apply(rotation=True)
        f.data.materials.append(mat_body)
        add_bevel(f, 0.009, segs=2)
        shade(f, 45)
        f.parent = parent_empty
        f.location = (x * sx, -0.08, 0.02)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    thumb = bpy.context.active_object
    thumb.name = f"{name}_Thumb"
    thumb.scale = (0.045, 0.07, 0.04)
    apply_scale(thumb)
    thumb.rotation_euler = (radians(14), radians(-40 * sx), radians(28 * sx))
    select_active(thumb)
    bpy.ops.object.transform_apply(rotation=True)
    thumb.data.materials.append(mat_body)
    add_bevel(thumb, 0.009, segs=2)
    shade(thumb, 45)
    thumb.parent = parent_empty
    thumb.location = (0.09 * sx, -0.02, -0.03)


def make_sword(mat_blade, mat_gold, mat_grip, parent):
    root = bpy.data.objects.new("SWORD", None)
    bpy.context.scene.collection.objects.link(root)
    root.parent = parent
    root.location = (0.0, -0.02, 0.04)
    root.rotation_euler = (radians(-10), radians(15), radians(5))

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    blade = bpy.context.active_object
    blade.name = "SWORD_Blade"
    blade.scale = (0.048, 0.014, 0.44)
    apply_scale(blade)
    bm = bmesh.new()
    bm.from_mesh(blade.data)
    zmax = max(v.co.z for v in bm.verts)
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        t = (v.co.z - zmin) / max(1e-6, (zmax - zmin))
        if t > 0.75:
            k = (t - 0.75) / 0.25
            v.co.x *= 1 - 0.85 * k
            v.co.y *= 1 - 0.7 * k
            if t > 0.95:
                v.co.z += 0.03
    # shift blade so base near z=0.18
    for v in bm.verts:
        v.co.z += 0.40
    bm.to_mesh(blade.data)
    bm.free()
    blade.data.materials.append(mat_blade)
    add_bevel(blade, 0.003, segs=2, angle=20)
    shade(blade, 30)
    blade.parent = root
    blade.location = (0, 0, 0)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    ridge = bpy.context.active_object
    ridge.name = "SWORD_Ridge"
    ridge.scale = (0.007, 0.02, 0.38)
    apply_scale(ridge)
    ridge.data.materials.append(mat_blade)
    ridge.parent = root
    ridge.location = (0, 0, 0.38)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    guard = bpy.context.active_object
    guard.name = "SWORD_Guard"
    guard.scale = (0.15, 0.055, 0.042)
    apply_scale(guard)
    guard.data.materials.append(mat_gold)
    add_bevel(guard, 0.007, segs=2)
    shade(guard, 40)
    guard.parent = root
    guard.location = (0, 0, 0.13)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.17, vertices=12, location=(0, 0, 0))
    grip = bpy.context.active_object
    grip.name = "SWORD_Grip"
    grip.data.materials.append(mat_grip)
    shade(grip, 40)
    grip.parent = root
    grip.location = (0, 0, 0.02)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    pommel = bpy.context.active_object
    pommel.name = "SWORD_Pommel"
    pommel.scale = (0.058, 0.058, 0.038)
    apply_scale(pommel)
    pommel.data.materials.append(mat_gold)
    add_bevel(pommel, 0.007, segs=2)
    shade(pommel, 40)
    pommel.parent = root
    pommel.location = (0, 0, -0.085)
    return root


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    mat_body = mat("DIE_Body", hex_rgb("ffcf3f"), 0.55, 0.1)
    mat_pip = mat("DIE_Pip", hex_rgb("3c3010"), 0.5, 0.0)
    mat_blade = mat("Sword_Blade", hex_rgb("d8dce4"), 0.35, 0.35)
    mat_gold = mat("Sword_Gold", hex_rgb("ffd54a"), 0.35, 0.25)
    mat_grip = mat("Sword_Grip", hex_rgb("5c3a18"), 0.7, 0.0)

    # Hero root: die center at z=0.5 so bottom rests on z=0
    hero = bpy.data.objects.new("DIE_Hero", None)
    bpy.context.scene.collection.objects.link(hero)
    hero.location = (0, 0, 0.5)

    make_die(mat_body, mat_pip, hero)

    # Sword hand on viewer's LEFT (-X) to match reference screenshot
    hand_sword = bpy.data.objects.new("HAND_L", None)
    bpy.context.scene.collection.objects.link(hand_sword)
    hand_sword.parent = hero
    hand_sword.location = (-0.72, -0.16, 0.02)
    hand_sword.rotation_euler = (radians(10), radians(8), radians(-85))
    make_fist_meshes("HAND_L", mat_body, hand_sword, mirror=True)

    # Free fist on viewer's RIGHT (+X)
    hand_free = bpy.data.objects.new("HAND_R", None)
    bpy.context.scene.collection.objects.link(hand_free)
    hand_free.parent = hero
    hand_free.location = (0.72, -0.14, 0.0)
    hand_free.rotation_euler = (radians(8), radians(-8), radians(85))
    make_fist_meshes("HAND_R", mat_body, hand_free, mirror=False)

    make_sword(mat_blade, mat_gold, mat_grip, hand_sword)

    blend = OUT_DIR / "die_hero.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))

    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        p = obj
        while p.parent:
            p = p.parent
        if p == hero or obj == hero:
            obj.select_set(True)

    glb = OUT_DIR / "die_hero.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(glb),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=False,
    )

    # Sanity print
    bpy.context.view_layer.update()
    for name in ("DIE_Body", "HAND_R", "HAND_L", "SWORD", "DIE_Hero", "SWORD_Guard"):
        o = bpy.data.objects.get(name)
        if o:
            mats = []
            if o.type == "MESH":
                mats = [m.name for m in o.data.materials]
            print(name, [round(v, 3) for v in o.matrix_world.translation], mats)
    print("OK", blend, glb)


build()
