import bpy
from collections import Counter, defaultdict

path = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\backups\jungle_backdrop_review_dressed_2026-07-30_140746.blend"
bpy.ops.wm.open_mainfile(filepath=path)

# Classify VEG_Bush by mesh/source
bush_src = Counter()
bush_mats = defaultdict(Counter)
for o in bpy.data.objects:
    if not o.name.startswith("VEG_Bush"):
        continue
    src = o.data.name if o.data else "?"
    bush_src[src] += 1
    if o.type=="MESH":
        for s in o.material_slots:
            if s.material:
                bush_mats[src][s.material.name] += 1

print("=== BUSH SOURCES ===")
for k,v in bush_src.most_common():
    print(f"  {v:3d} mesh={k} mats={dict(bush_mats[k])}")

# specifically 068
o = bpy.data.objects.get("VEG_Bush_068")
if o:
    print("VEG_Bush_068:", "data", o.data.name if o.data else None, "loc", tuple(round(x,2) for x in o.location))
    if o.type=="MESH":
        print("  mats", [s.material.name if s.material else None for s in o.material_slots])
        # linked masters
        print("  users of mesh", o.data.users if o.data else None)

# NatureKit bush masters
print("=== NATURE BUSH MASTERS ===")
for o in sorted(bpy.data.objects, key=lambda x:x.name):
    n=o.name
    if "NatureKit" in n and ("Bush" in n or "berry" in n.lower() or "Berry" in n or "Flower" in n or "Stump" in n or "stump" in n):
        mats=[s.material.name if s.material else None for s in o.material_slots] if o.type=="MESH" else []
        print(f"  {n} mesh={o.data.name if o.data else None} mats={mats}")

# All VEG flowers
print("=== FLOWERS ===")
fl = [o for o in bpy.data.objects if o.name.startswith("VEG_Flower")]
print("count", len(fl))
fl_src = Counter(o.data.name if o.data else "?" for o in fl)
for k,v in fl_src.most_common():
    print(f"  {v} {k}")
o31 = bpy.data.objects.get("VEG_Flower_031")
if o31:
    print("031 data", o31.data.name, "mats", [s.material.name if s.material else None for s in o31.material_slots])

# stump / log / dead wood
print("=== WOODISH VEG ===")
for o in sorted(bpy.data.objects, key=lambda x:x.name):
    n=o.name.lower()
    if o.name.startswith("VEG_") and any(k in n for k in ("stump","log","dead","trunk","wood","cut")):
        print(f"  {o.name} mesh={o.data.name if o.data else None} dim={[round(d,2) for d in o.dimensions]}")

# NatureKit stump masters anywhere
print("=== ALL STUMP-LIKE OBJECTS ===")
for o in bpy.data.objects:
    n=o.name.lower()
    if "stump" in n or (o.type=="MESH" and o.data and "stump" in o.data.name.lower()):
        print(" ", o.name, "mesh", o.data.name if o.data else None)
