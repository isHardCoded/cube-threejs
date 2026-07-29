import bpy
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
path = r"C:\Users\Антон\Desktop\threejs__journey\public\assets\maps\jungle\backdrop\scene.glb"
bpy.ops.import_scene.gltf(filepath=path)
arena=[o.name for o in bpy.data.objects if o.name.startswith("Arena_") or "Plinth" in o.name]
rocks=sorted(o.name for o in bpy.data.objects if "rock" in o.name.lower() or o.name.startswith("Rock_") or "stone_" in o.name.lower())
print("ARENA", arena)
print("ROCKISH", rocks)
print("INSECT_Z", [(o.name, round(o.location.z,2)) for o in bpy.data.objects if o.name.startswith("Bee_")][:3])
