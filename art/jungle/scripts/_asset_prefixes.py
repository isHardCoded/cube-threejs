import bpy
BLEND = r"C:\Users\Антон\Desktop\threejs__journey\art\jungle\jungle_backdrop_review.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
# meaningful unique mesh name prefixes in exportable scene
from collections import Counter
c = Counter()
for o in bpy.data.objects:
    if o.type != "MESH": continue
    if o.hide_render: continue
    cols = {x.name for x in o.users_collection}
    if cols & {"01_ArenaProxy","15_ObstacleTemplates","05_PalmTemplates","12_BushTemplates","GRAPHICS_UPGRADE"}: continue
    if o.name.startswith(("Arena_","Obs_","Col_","Tpl_","Template_","Review","VisCell_","MatSwatch_","Kit_")): continue
    prefix = o.name.split("_")[0] if "_" in o.name else o.name
    c[prefix] += 1
for k,v in c.most_common(40):
    print(f"{k}\t{v}")
