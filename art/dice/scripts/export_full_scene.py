"""Export full dice scene (platforms + ENV_DICE_WORLD) to public GLB."""
from __future__ import annotations

import os

import bpy

OUT = r"c:\Users\Антон\Desktop\threejs__journey\public\assets\dice\scene.glb"
KEEP_COLS = {"DICE_TABLE_PLATFORMS", "ENV_DICE_WORLD"}


def main() -> None:
    # Hide everything outside the two content collections
    keep: set[str] = set()
    for col in bpy.data.collections:
        if col.name in KEEP_COLS:
            for obj in col.all_objects:
                keep.add(obj.name)

    bpy.ops.object.select_all(action="DESELECT")
    selected = 0
    for obj in bpy.data.objects:
        if obj.name not in keep:
            obj.hide_render = True
            obj.hide_viewport = True
            continue
        if obj.type != "MESH":
            continue
        obj.hide_render = False
        obj.hide_viewport = False
        obj.hide_set(False)
        obj.select_set(True)
        selected += 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        use_selection=True,
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_yup=True,
        export_lights=False,
        export_cameras=False,
    )
    print(f"EXPORTED {OUT} meshes={selected} bytes={os.path.getsize(OUT)}")


if __name__ == "__main__":
    main()
