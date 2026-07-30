"""Helpers for dressing the jungle arena map with kits already present in the scene.

Run inside Blender:
    exec(open(r'<repo>/art/jungle/scripts/jungle_dress.py', encoding='utf-8').read())

Terrain type is read from the GROUND_LakeTerrain vertex mask 'Col':
    R -> sand, B -> lake basin, otherwise grass.
"""

import math
import random

import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

PARENT_COLLECTION = 'MAP_JUNGLE_UPGRADE'
VEG_COLLECTION = 'JUNGLE_VEG'
TERRAIN_NAME = 'GROUND_LakeTerrain'
CLIFF_PREFIX = 'NatureKit_M_Cliff'


def veg_collection():
    col = bpy.data.collections.get(VEG_COLLECTION)
    if col is None:
        col = bpy.data.collections.new(VEG_COLLECTION)
        parent = bpy.data.collections.get(PARENT_COLLECTION) or bpy.context.scene.collection
        parent.children.link(col)
    return col


def clear(prefix):
    """Remove previously generated objects so phases stay idempotent."""
    removed = 0
    for obj in list(bpy.data.objects):
        if obj.name.startswith(prefix):
            bpy.data.objects.remove(obj, do_unlink=True)
            removed += 1
    return removed


def base_offset(obj):
    """World-space distance from the object origin down to its lowest point.

    Kit sources are parented to scaled *_Root empties, so world space is the
    only reliable frame here.
    """
    zs = [(obj.matrix_world @ Vector(c)).z for c in obj.bound_box]
    return min(zs) - obj.matrix_world.translation.z


class Terrain:
    """Height / normal / paint-mask sampler for the ground mesh."""

    def __init__(self, name=TERRAIN_NAME):
        self.obj = bpy.data.objects[name]
        self.mw = self.obj.matrix_world
        self.inv = self.mw.inverted()
        self.mesh = self.obj.data
        self.mask = self.mesh.color_attributes.get('Col')

    def sample(self, x, y):
        origin = self.inv @ Vector((x, y, 400.0))
        direction = (self.inv.to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()
        hit, loc, nor, index = self.obj.ray_cast(origin, direction)
        if not hit:
            return None
        world_loc = self.mw @ loc
        normal = (self.mw.to_3x3() @ nor).normalized()
        sand = basin = 0.0
        if self.mask is not None and index < len(self.mesh.polygons):
            loops = self.mesh.polygons[index].loop_indices
            cols = [self.mask.data[i].color for i in loops]
            sand = sum(c[0] for c in cols) / len(cols)
            basin = sum(c[2] for c in cols) / len(cols)
        return {
            'z': world_loc.z,
            'normal': normal,
            'sand': sand,
            'basin': basin,
            'slope': math.degrees(math.acos(max(-1.0, min(1.0, normal.z)))),
        }


class CliffBounds:
    """2D footprints of the rock wall slabs.

    A distance-to-surface test cannot tell 'in front of the wall' from 'buried
    inside it', so the footprints are used as keep-out areas instead.
    """

    def __init__(self, prefix=CLIFF_PREFIX):
        self.boxes = []
        for obj in bpy.context.scene.objects:
            if obj.type != 'MESH' or not obj.name.startswith(prefix):
                continue
            pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
            self.boxes.append((
                min(p.x for p in pts), max(p.x for p in pts),
                min(p.y for p in pts), max(p.y for p in pts),
            ))

    def blocked(self, x, y, pad=0.0):
        for x0, x1, y0, y1 in self.boxes:
            if x0 - pad <= x <= x1 + pad and y0 - pad <= y <= y1 + pad:
                return True
        return False

    def interior(self):
        """Axis-aligned free area enclosed by the wall."""
        x0, x1, y0, y1 = -1e9, 1e9, -1e9, 1e9
        for bx0, bx1, by0, by1 in self.boxes:
            if bx1 - bx0 > by1 - by0:  # wall running along X -> limits Y
                if by0 > 0:
                    y1 = min(y1, by0)
                else:
                    y0 = max(y0, by1)
            else:  # wall running along Y -> limits X
                if bx0 > 0:
                    x1 = min(x1, bx0)
                else:
                    x0 = max(x0, bx1)
        return x0, x1, y0, y1


def cliff_bvh():
    """Single BVH tree over the rock wall, for clearance tests."""
    verts, polys = [], []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or not obj.name.startswith(CLIFF_PREFIX):
            continue
        mesh = obj.data
        offset = len(verts)
        verts.extend((obj.matrix_world @ v.co) for v in mesh.vertices)
        polys.extend([i + offset for i in p.vertices] for p in mesh.polygons)
    if not polys:
        return None
    return BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)


def cliff_distance(bvh, x, y, z):
    if bvh is None:
        return 1e9
    hit = bvh.find_nearest(Vector((x, y, z)))
    if hit is None or hit[0] is None:
        return 1e9
    return (Vector((x, y, z)) - hit[0]).length


class Placer:
    """Tracks footprints so generated props do not visibly intersect."""

    def __init__(self, seed=0):
        self.rng = random.Random(seed)
        self.terrain = Terrain()
        self.walls = CliffBounds()
        self.collection = veg_collection()
        self.taken = []  # (x, y, radius)

    def ground(self, x, y, kind='grass', max_slope=26.0, pad=0.0):
        """Sample the terrain and confirm the spot matches the wanted surface."""
        if self.walls.blocked(x, y, pad):
            return None
        info = self.terrain.sample(x, y)
        if info is None or info['slope'] > max_slope:
            return None
        if kind == 'grass' and (info['sand'] > 0.25 or info['basin'] > 0.01):
            return None
        if kind == 'sand' and (info['sand'] < 0.5 or info['basin'] > 0.01):
            return None
        if kind == 'shore' and info['basin'] > 0.01:
            return None
        return info

    def free(self, x, y, radius):
        for ox, oy, orad in self.taken:
            if (x - ox) ** 2 + (y - oy) ** 2 < (radius + orad) ** 2:
                return False
        return True

    def reserve(self, x, y, radius):
        self.taken.append((x, y, radius))

    def add_existing(self, objects, pad=0.0):
        """Reserve space already used by objects placed in earlier phases."""
        for obj in objects:
            radius = max(obj.dimensions.x, obj.dimensions.y) * 0.5 + pad
            self.taken.append((obj.location.x, obj.location.y, radius))

    def spawn(self, source, name, x, y, scale=1.0, rot_z=None, sink=0.0,
              align=0.0, tilt=0.0, info=None):
        """Drop a linked duplicate of `source` on the terrain at (x, y).

        The copy is detached from the kit root and placed in world space, so the
        source's own orientation and size are preserved exactly.
        """
        if info is None:
            info = self.terrain.sample(x, y)
        if info is None:
            return None

        obj = source.copy()  # linked duplicate: shares mesh data
        obj.data = source.data
        obj.name = name
        obj.parent = None
        obj.matrix_parent_inverse.identity()
        self.collection.objects.link(obj)

        _, src_quat, src_scale = source.matrix_world.decompose()
        rot_z = self.rng.uniform(0.0, math.tau) if rot_z is None else rot_z
        tilt_x = tilt_y = 0.0
        if align > 0.0:
            normal = info['normal']
            tilt_x += align * normal.y
            tilt_y += -align * normal.x
        if tilt > 0.0:
            tilt_x += self.rng.uniform(-tilt, tilt)
            tilt_y += self.rng.uniform(-tilt, tilt)
        extra = Euler((tilt_x, tilt_y, rot_z), 'XYZ').to_quaternion()

        z = info['z'] - base_offset(source) * scale - sink
        obj.matrix_world = Matrix.LocRotScale(
            Vector((x, y, z)), extra @ src_quat, src_scale * scale)
        return obj


def jittered_grid(x0, x1, y0, y1, step, jitter, rng):
    """Even coverage sampling: grid cells with a random offset inside each cell.

    Pure random sampling leaves visible holes in a narrow band; this does not.
    """
    pts = []
    y = y0
    while y <= y1:
        x = x0
        while x <= x1:
            pts.append((x + rng.uniform(-jitter, jitter), y + rng.uniform(-jitter, jitter)))
            x += step
        y += step
    rng.shuffle(pts)
    return pts


def report(prefix):
    objs = [o for o in bpy.data.objects if o.name.startswith(prefix)]
    tris = 0
    for o in objs:
        if o.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f'{prefix}: {len(objs)} objects, ~{tris} tris (instanced meshes shared)')
    return objs
