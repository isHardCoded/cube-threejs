"""Add facade detail to ENV dice city buildings — fast data-API path (no per-object ops)."""
import bpy
import bmesh
import random
from mathutils import Vector, Matrix

random.seed(77)

BLEND = r"c:\Users\Антон\Desktop\threejs__journey\art\dice\dice_scene_full_v1.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

col = bpy.data.collections.get("ENV_DICE_WORLD")
if col is None:
    raise RuntimeError("ENV_DICE_WORLD missing")


def link(obj):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def mat(name, color, emission=None, emission_strength=0.0, roughness=0.45, metallic=0.2):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None and emission_strength > 0:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


M_WIN_C = mat("Env_WinCyan", (0.02, 0.04, 0.07), emission=(0.3, 0.85, 1.0), emission_strength=9)
M_WIN_P = mat("Env_WinPink", (0.07, 0.01, 0.04), emission=(1.0, 0.25, 0.65), emission_strength=10)
M_WIN_Y = mat("Env_WinYel", (0.07, 0.05, 0.01), emission=(1.0, 0.8, 0.35), emission_strength=7)
M_LEDGE = mat("Env_Ledge", (0.05, 0.045, 0.09), roughness=0.55, metallic=0.35)
M_NEON_V = mat("Env_NeonVert", (0.02, 0.05, 0.06), emission=(0.25, 0.9, 1.0), emission_strength=11)
M_NEON_VP = mat("Env_NeonVertP", (0.06, 0.01, 0.04), emission=(1.0, 0.2, 0.7), emission_strength=12)
M_ANT = mat("Env_Antenna", (0.12, 0.12, 0.14), roughness=0.4, metallic=0.7, emission=(0.8, 0.3, 1.0), emission_strength=3)
M_ROOF = mat("Env_RoofCap", (0.04, 0.035, 0.07), roughness=0.5, metallic=0.4)
M_PANEL = mat("Env_Panel", (0.035, 0.03, 0.06), roughness=0.6, metallic=0.25)

# Cleanup
for o in list(bpy.data.objects):
    if o.name.startswith("Env_Detail_") or o.name.startswith("Env_Win_"):
        bpy.data.objects.remove(o, do_unlink=True)


def bbox_world(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def add_box(name, loc, sx, sy, sz, material):
    """Create axis-aligned box centered at loc with full sizes sx,sy,sz."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((sx, sy, sz)), verts=bm.verts)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    mesh.materials.append(material)
    link(obj)
    return obj


bldgs = [o for o in bpy.data.objects if o.name.startswith("Env_Bldg")]
win_mats = [M_WIN_C, M_WIN_P, M_WIN_Y]
detail_count = 0

for bi, bldg in enumerate(bldgs):
    x0, x1, y0, y1, z0, z1 = bbox_world(bldg)
    w = x1 - x0
    d = y1 - y0
    h = z1 - z0
    if w < 0.2 or h < 0.5:
        continue
    cx = (x0 + x1) * 0.5
    cy = (y0 + y1) * 0.5
    front_y = y0 - 0.03
    accent = M_NEON_V if bi % 2 == 0 else M_NEON_VP

    add_box(f"Env_Detail_Roof_{bi}", (cx, cy, z1 + 0.07), w * 1.06, d * 1.06, 0.12, M_ROOF)
    detail_count += 1

    for band_i, t in enumerate([0.28, 0.52, 0.76]):
        if h < 3.5 and band_i == 1:
            continue
        bz = z0 + h * t
        add_box(f"Env_Detail_Ledge_{bi}_{band_i}", (cx, front_y, bz), w * 1.04, 0.1, 0.07, M_LEDGE)
        detail_count += 1

    for side, sx in enumerate([x0 - 0.04, x1 + 0.04]):
        add_box(f"Env_Detail_NeonV_{bi}_{side}", (sx, front_y, z0 + h * 0.5), 0.055, 0.055, h * 0.9, accent)
        detail_count += 1

    cols = max(2, min(5, int(w / 0.42)))
    rows = max(3, min(9, int(h / 0.5)))
    margin_x = w * 0.14
    margin_z = h * 0.14
    usable_w = max(0.2, w - margin_x * 2)
    usable_h = max(0.3, h - margin_z * 2)
    cell_w = usable_w / cols
    cell_h = usable_h / rows
    pad = 0.07
    for r in range(rows):
        for c in range(cols):
            roll = random.random()
            if roll < 0.15:
                continue
            wx = x0 + margin_x + (c + 0.5) * cell_w
            wz = z0 + margin_z + (r + 0.5) * cell_h
            ww = max(0.1, cell_w - pad)
            wh = max(0.1, cell_h - pad)
            m = M_PANEL if roll < 0.35 else win_mats[(bi + r + c) % 3]
            add_box(f"Env_Detail_Win_{bi}_{r}_{c}", (wx, front_y, wz), ww, 0.045, wh, m)
            detail_count += 1

    if h > 5.2 and bi % 3 == 0:
        add_box(f"Env_Detail_Ant_{bi}", (cx, cy, z1 + 0.5), 0.07, 0.07, 0.85, M_ANT)
        add_box(f"Env_Detail_AntTip_{bi}", (cx, cy, z1 + 0.98), 0.14, 0.14, 0.1, accent)
        detail_count += 2

    if h > 4 and bi % 2 == 0:
        bz = z0 + h * 0.55
        add_box(f"Env_Detail_Balc_{bi}", (cx, front_y - 0.12, bz), w * 0.55, 0.22, 0.08, M_LEDGE)
        detail_count += 1

print(f"Added {detail_count} detail pieces on {len(bldgs)} buildings")
bpy.ops.wm.save_mainfile(filepath=BLEND)
print("Saved", BLEND)
