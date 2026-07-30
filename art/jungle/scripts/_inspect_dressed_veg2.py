import bpy
path = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\backups\jungle_backdrop_review_dressed_2026-07-30_140746.blend"
bpy.ops.wm.open_mainfile(filepath=path)

print("=== NatureKit names with stump/log/cut/dead ===")
for o in sorted(bpy.data.objects, key=lambda x:x.name):
    if not o.name.startswith("NatureKit"): continue
    n=o.name.lower()
    if any(k in n for k in ("stump","log","dead","cut","trunk","wood","branch","fallen")):
        print(f"  {o.name} mesh={o.data.name if o.data else None}")

print("=== VEG prefixes ===")
from collections import Counter
c=Counter()
for o in bpy.data.objects:
    if o.name.startswith("VEG_"):
        pref=o.name.rsplit("_",1)[0]
        c[pref]+=1
for k,v in c.most_common():
    print(f"  {v:3d} {k}")

# berry bush instance names
berry_meshes={"Icosphere.013","Icosphere.024"}
berries=[o.name for o in bpy.data.objects if o.name.startswith("VEG_Bush") and o.data and o.data.name in berry_meshes]
print("berry count", len(berries), "sample", berries[:5], "...", berries[-3:])

# flower2 = daisy?
print("Flower2 users", [o.name for o in bpy.data.objects if o.data and o.data.name=="Cylinder.025"][:10])
print("Flower1 users count", sum(1 for o in bpy.data.objects if o.data and o.data.name=="Cylinder.020"))
