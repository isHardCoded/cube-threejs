from pathlib import Path
p = Path(r"c:\Users\Антон\Desktop\threejs__journey\src\game\themes\jungle.js")
t = p.read_text(encoding="utf-8")
old = "const SCENE_URL = assetUrl('jungle', 'backdrop', 'scene')"
new = "const SCENE_URL = assetUrl('jungle', 'backdrop', 'scene') + '?v=gfx10'"
if "?v=gfx10" in t:
    print("ALREADY")
elif old not in t:
    raise SystemExit("NOT_FOUND")
else:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("OK")
