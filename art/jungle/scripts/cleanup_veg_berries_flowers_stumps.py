"""Replace berry bushes, remove daisy flowers and decorative stump/trunk props.

Source of truth: dressed backup (has JUNGLE_VEG). Writes cleaned blend to the
main review file and re-exports public scene.glb.
"""

import os
import random
import shutil
from datetime import datetime

import bpy

ROOT = r"C:\Users\Антон\Desktop\threejs__journey"
DRESSED = os.path.join(
    ROOT, "art", "jungle", "backups",
    "jungle_backdrop_review_dressed_2026-07-30_140746.blend",
)
MAIN = os.path.join(ROOT, "art", "jungle", "jungle_backdrop_review.blend")
BACKUP_DIR = os.path.join(ROOT, "art", "jungle", "backups")
OUT_GLB = os.path.join(ROOT, "public", "assets", "maps", "jungle", "backdrop", "scene.glb")
RENDER = os.path.join(ROOT, "art", "jungle", "refs", "veg_cleanup_review.png")

BERRY_MESHES = {"Icosphere.013", "Icosphere.024"}  # BerryBush1 / BerryBush2
PLAIN_BUSH_MASTERS = [
    "NatureKit_M_Bush1",
    "NatureKit_M_Bush2",
    "NatureKit_M_Bush3",
    "NatureKit_M_BushHigh1",
    "NatureKit_M_BushHigh2",
]
STUMP_PREFIXES = ("VEG_Log_", "VEG_Drift_")
FLOWER_PREFIX = "VEG_Flower_"

KIT_COLS = {
    "MAP_NATURE_KIT",
    "MAP_DESERT_KIT",
    "MAP_CLIFF_KIT",
    "MAP_LAKE",  # kit shelf only if present as masters; lake water is elsewhere
}


def timestamp():
    return datetime.now().strftime("%Y-%m-%d_%H%M%S")


def backup_main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if os.path.isfile(MAIN):
        dst = os.path.join(BACKUP_DIR, f"jungle_backdrop_review_pre_veg_cleanup_{timestamp()}.blend")
        shutil.copy2(MAIN, dst)
        print("BACKUP_MAIN", dst)


def replace_berry_bushes(rng):
    plain = []
    for name in PLAIN_BUSH_MASTERS:
        src = bpy.data.objects.get(name)
        if src and src.type == "MESH" and src.data:
            plain.append(src.data)
    if not plain:
        raise RuntimeError("No plain bush masters found")

    replaced = 0
    for obj in list(bpy.data.objects):
        if not obj.name.startswith("VEG_Bush"):
            continue
        if obj.type != "MESH" or not obj.data:
            continue
        if obj.data.name not in BERRY_MESHES:
            continue
        # Keep object-level material override; only swap mesh datablock.
        obj.data = rng.choice(plain)
        replaced += 1
    return replaced


def remove_by_prefix(prefix):
    n = 0
    for obj in list(bpy.data.objects):
        if obj.name.startswith(prefix):
            bpy.data.objects.remove(obj, do_unlink=True)
            n += 1
    return n


def hide_kit_shelf():
    """Keep masters out of viewport/render/export without deleting kits."""
    n = 0
    for obj in bpy.data.objects:
        cols = {c.name for c in obj.users_collection}
        if cols & {"MAP_NATURE_KIT", "MAP_DESERT_KIT", "MAP_CLIFF_KIT"}:
            # Don't hide cliff wall pieces that live in MAP_CLIFF_KIT but are
            # the ring itself — only masters far from origin (kit shelf).
            if abs(obj.location.y) > 60 or abs(obj.location.x) > 60:
                obj.hide_render = True
                obj.hide_viewport = True
                n += 1
    return n


def export_glb():
    skip_prefixes = (
        "Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review",
        "VisCell_", "MatSwatch_", "Kit_", "IslandCliff_", "IslandHang_",
        "NatureKit_M_", "NatureKit_G_", "DesertKit_", "PalmKit_", "PalmPrefab_",
        "CliffKit_",
    )
    skip_cols = {
        "01_ArenaProxy", "15_ObstacleTemplates",
        "05_PalmTemplates", "12_BushTemplates", "GRAPHICS_UPGRADE",
        "MAP_NATURE_KIT", "MAP_DESERT_KIT",
    }

    bpy.ops.object.select_all(action="DESELECT")
    count = 0
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if any(o.name.startswith(p) for p in skip_prefixes):
            continue
        if any(c.name in skip_cols for c in o.users_collection):
            continue
        if o.hide_render:
            continue
        # Cliff wall pieces may still be NatureKit_M_Cliff* — keep those
        if o.name.startswith("NatureKit_M_Cliff") or o.name.startswith("NatureKit_Cliff"):
            o.hide_set(False)
            o.select_set(True)
            count += 1
            continue
        if o.name.startswith(("NatureKit_", "DesertKit_", "PalmKit_")):
            continue
        o.hide_set(False)
        o.select_set(True)
        count += 1

    # Explicitly include cliff ring even if in MAP_CLIFF_KIT
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.name.startswith("NatureKit_M_Cliff"):
            o.hide_render = False
            o.hide_set(False)
            o.select_set(True)
            count += 1

    print("EXPORT_SELECT", count)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB, use_selection=True, export_format="GLB", export_apply=True,
        export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_image_format="AUTO",
    )
    print("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))


def review_render():
    cam = bpy.data.objects.get("MAIN_GAME_CAMERA")
    if not cam:
        print("NO_CAMERA")
        return
    bpy.context.scene.camera = cam
    sc = bpy.context.scene
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 720
    sc.render.filepath = RENDER
    bpy.ops.render.render(write_still=True)
    print("RENDER", RENDER)


def main():
    backup_main()
    bpy.ops.wm.open_mainfile(filepath=DRESSED)

    rng = random.Random(20260730)
    n_berry = replace_berry_bushes(rng)
    n_flower = remove_by_prefix(FLOWER_PREFIX)
    n_stump = 0
    for pref in STUMP_PREFIXES:
        n_stump += remove_by_prefix(pref)
    n_hide = hide_kit_shelf()

    # Sanity: berry mesh must no longer be used by VEG_Bush*
    leftover = [
        o.name for o in bpy.data.objects
        if o.name.startswith("VEG_Bush") and o.data and o.data.name in BERRY_MESHES
    ]
    left_flowers = [o.name for o in bpy.data.objects if o.name.startswith(FLOWER_PREFIX)]
    left_stumps = [
        o.name for o in bpy.data.objects
        if any(o.name.startswith(p) for p in STUMP_PREFIXES)
    ]

    print(
        "CLEANUP",
        "berry_replaced", n_berry,
        "flowers_removed", n_flower,
        "stumps_removed", n_stump,
        "kit_hidden", n_hide,
        "leftover_berry", leftover,
        "leftover_flower", left_flowers,
        "leftover_stump", left_stumps,
    )
    if leftover or left_flowers or left_stumps:
        raise RuntimeError("Cleanup incomplete")

    bpy.ops.wm.save_as_mainfile(filepath=MAIN)
    print("SAVED", MAIN)

    export_glb()
    review_render()
    bpy.ops.wm.save_mainfile(filepath=MAIN)
    print("DONE")


if __name__ == "__main__":
    main()
