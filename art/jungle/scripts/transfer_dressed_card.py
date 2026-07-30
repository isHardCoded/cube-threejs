"""Transfer the dressed lake card from LowPolyRockPack_WORK.blend into
jungle_backdrop_review.blend, keeping the existing Arena_* / Col_* / Obs_* platform.

Steps:
1. Backup jungle blend
2. From WORK, build a clean transfer pack (unparented, world transforms baked)
3. Open jungle, hide old backdrop, append pack into MAP_JUNGLE_UPGRADE
4. Shift so water sits at runtime LAKE_Y (-3.15)
5. Rename water materials to Water / WaterDeep
6. Export scene.glb + MAIN_GAME_CAMERA review render
"""

from __future__ import annotations

import datetime
import os
import shutil

import bpy
from mathutils import Vector

ROOT = r"C:\Users\Антон\Desktop\threejs__journey"
WORK = r"C:\Users\Антон\Downloads\LowPolyRockPack_WORK.blend"
JUNGLE = os.path.join(ROOT, r"art\jungle\jungle_backdrop_review.blend")
BACKUP_DIR = os.path.join(ROOT, r"art\jungle\backups")
PACK = os.path.join(ROOT, r"art\jungle\backups\_transfer_pack_dressed_card.blend")
OUT_GLB = os.path.join(ROOT, r"public\assets\maps\jungle\backdrop\scene.glb")
OUT_RENDER = os.path.join(ROOT, r"art\jungle\refs\transfer_dressed_card.png")

LAKE_Y = -3.15

APPEND_EXACT = {
    "GROUND_LakeTerrain",
    "LakeWater_Surface",
    "LakeWater_Volume",
}
APPEND_PREFIXES = (
    "VEG_",
    "NatureKit_M_Cliff",
)


def log(msg: str) -> None:
    print(msg, flush=True)


def backup_jungle() -> str:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    path = os.path.join(BACKUP_DIR, f"jungle_backdrop_review_pre_transfer_{stamp}.blend")
    shutil.copy2(JUNGLE, path)
    log(f"BACKUP {path}")
    return path


def should_take(name: str) -> bool:
    if name.startswith(("PalmPrefab_", "PalmKit_", "GROUND_Arena", "GROUND_Sun",
                        "GROUND_Fill", "GROUND_Review", "JUNGLE_Concept")):
        return False
    if name in APPEND_EXACT:
        return True
    return any(name.startswith(p) for p in APPEND_PREFIXES)


def build_transfer_pack() -> int:
    """Open WORK and save a minimal blend of unparented mesh copies."""
    bpy.ops.wm.open_mainfile(filepath=WORK)

    # Drop everything else from the pack scene by saving only selected new objects
    # into a fresh file via copy + purge workflow.
    src_objs = [o for o in bpy.data.objects if should_take(o.name) and o.type == "MESH"]
    log(f"PACK_SOURCES {len(src_objs)}")

    # Create clean copies with baked world matrices, linked meshes (share data).
    pack_col = bpy.data.collections.new("TRANSFER_PACK")
    bpy.context.scene.collection.children.link(pack_col)

    copies = []
    for src in src_objs:
        c = src.copy()
        c.data = src.data  # keep linked mesh / materials
        c.name = src.name  # may get .001 if collision; fine inside temp
        c.parent = None
        c.matrix_parent_inverse.identity()
        mw = src.matrix_world.copy()
        pack_col.objects.link(c)
        c.matrix_world = mw
        copies.append(c)

    # Rename copies back when Blender added .001 because original still exists
    # Prefer exact names by renaming originals out of the way first.
    for src in src_objs:
        src.name = f"_SRC_{src.name}"
    for c, src in zip(copies, src_objs):
        desired = src.name[len("_SRC_"):]
        c.name = desired

    # Remove non-pack objects from the file before save-as
    keep = set(copies)
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)

    # Purge unused
    for _ in range(3):
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

    os.makedirs(os.path.dirname(PACK), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=PACK, copy=True)
    log(f"PACK_SAVED {PACK} objects={len(bpy.data.objects)}")
    return len(bpy.data.objects)


def ensure_collection(name: str, parent_name: str | None = None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        parent = bpy.data.collections.get(parent_name) if parent_name else None
        if parent is not None:
            parent.children.link(col)
        else:
            bpy.context.scene.collection.children.link(col)
    return col


def hide_old_backdrop() -> int:
    hide_exact = {"LakeSurface", "LakeDeep", "LakeBank", "BO_Lake"}
    hide_prefixes = (
        "LakeShore_", "Mountain_", "Hill_", "Palm_", "Rock_",
        "Ripple_", "ShoreRing_", "Sparkle_", "Foam_", "LilyPad_",
    )
    n = 0
    for obj in bpy.data.objects:
        if obj.name.startswith(("Arena_", "Col_", "Obs_", "MAIN_GAME")):
            continue
        if obj.name in hide_exact or any(obj.name.startswith(p) for p in hide_prefixes):
            # Prefer collection/object flags — hide_set fails for objects not in the View Layer.
            obj.hide_viewport = True
            obj.hide_render = True
            try:
                obj.hide_set(True)
            except RuntimeError:
                pass
            n += 1
    log(f"HIDE_OLD {n}")
    return n


def append_pack() -> list:
    with bpy.data.libraries.load(PACK, link=False) as (data_from, data_to):
        data_to.objects = list(data_from.objects)
        log(f"APPEND_REQUEST {len(data_to.objects)}")

    upgrade = ensure_collection("MAP_JUNGLE_UPGRADE")
    veg = ensure_collection("JUNGLE_VEG", "MAP_JUNGLE_UPGRADE")
    brought = []
    for obj in data_to.objects:
        if obj is None:
            continue
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        if obj.name.startswith("VEG_"):
            veg.objects.link(obj)
        else:
            upgrade.objects.link(obj)
        brought.append(obj)
    log(f"APPEND_LINKED {len(brought)}")
    return brought


def water_surface_z() -> float:
    water = bpy.data.objects.get("LakeWater_Surface")
    if water is None:
        raise RuntimeError("LakeWater_Surface missing")
    pts = [water.matrix_world @ Vector(c) for c in water.bound_box]
    return max(p.z for p in pts)


def align_to_lake_y(brought: list) -> float:
    current = water_surface_z()
    delta = LAKE_Y - current
    log(f"ALIGN water_z={current:.3f} target={LAKE_Y} delta={delta:.3f}")
    for obj in brought:
        obj.location.z += delta
    bpy.context.view_layer.update()
    log(f"ALIGN_DONE water_z={water_surface_z():.3f}")
    return delta


def rename_water_materials() -> None:
    mapping = {"MAT_LakeWater": "Water", "MAT_LakeDeep": "WaterDeep"}
    for old, new in mapping.items():
        mat = bpy.data.materials.get(old)
        if mat is None:
            log(f"MAT_MISSING {old}")
            continue
        existing = bpy.data.materials.get(new)
        if existing and existing != mat:
            mat.user_remap(existing)
            bpy.data.materials.remove(mat)
            log(f"MAT_REMAP {old} -> {new}")
        else:
            mat.name = new
            log(f"MAT_RENAME {old} -> {mat.name}")


def export_glb() -> int:
    skip_prefixes = (
        "Arena_", "Obs_", "Col_", "Tpl_", "Template_", "Review",
        "VisCell_", "MatSwatch_", "Kit_", "IslandCliff_", "IslandHang_",
        "GROUND_Arena", "GROUND_Sun", "GROUND_Fill", "GROUND_Review",
        "JUNGLE_Concept", "PalmPrefab_", "PalmKit_", "DesertKit_",
        "Rock Type", "LakeFish_", "MAIN_GAME", "_SRC_",
    )
    # Nature kit sources stay out; wall cliffs are allowed
    allow_prefixes = ("NatureKit_M_Cliff", "VEG_", "GROUND_Lake", "LakeWater_")

    bpy.ops.object.select_all(action="DESELECT")
    count = 0
    selected = []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        if obj.name.startswith(("Arena_", "Obs_", "Col_", "VisCell_")):
            continue
        cols = {c.name for c in obj.users_collection}
        in_upgrade = bool(cols & {"MAP_JUNGLE_UPGRADE", "JUNGLE_VEG"})
        allowed = any(obj.name.startswith(a) for a in allow_prefixes)
        if not (in_upgrade and allowed):
            # also skip if matches hard skip
            if any(obj.name.startswith(p) for p in skip_prefixes):
                continue
            if not in_upgrade:
                continue
        if any(obj.name.startswith(p) for p in skip_prefixes) and not allowed:
            continue
        obj.hide_set(False)
        obj.select_set(True)
        selected.append(obj.name)
        count += 1

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        use_selection=True,
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    log(f"EXPORT {OUT_GLB} meshes={count} bytes={os.path.getsize(OUT_GLB)}")
    log(f"EXPORT_SAMPLE {selected[:12]}")
    return count


def review_render() -> None:
    cam = bpy.data.objects.get("MAIN_GAME_CAMERA")
    if not cam:
        log("NO MAIN_GAME_CAMERA")
        return
    bpy.context.scene.camera = cam
    sc = bpy.context.scene
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 720
    sc.render.filepath = OUT_RENDER
    bpy.ops.render.render(write_still=True)
    log(f"RENDER {OUT_RENDER}")


def main() -> None:
    if not os.path.isfile(WORK):
        raise SystemExit(f"missing work blend: {WORK}")
    if not os.path.isfile(JUNGLE):
        raise SystemExit(f"missing jungle blend: {JUNGLE}")

    backup_jungle()
    build_transfer_pack()

    bpy.ops.wm.open_mainfile(filepath=JUNGLE)
    hide_old_backdrop()
    brought = append_pack()
    if not brought:
        raise SystemExit("nothing appended")
    align_to_lake_y(brought)
    rename_water_materials()

    export_glb()
    review_render()
    bpy.ops.wm.save_mainfile(filepath=JUNGLE)
    log(f"SAVED {JUNGLE}")
    log("TRANSFER_OK")


if __name__ == "__main__":
    main()
