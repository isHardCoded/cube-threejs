from pathlib import Path
p = Path(r"c:\Users\Антон\Desktop\threejs__journey\src\game\themes\jungle.js")
t = p.read_text(encoding="utf-8")
old = "fogNear: 45, fogFar: 145,"
new = "fogNear: 36, fogFar: 118,"
if old not in t:
    raise SystemExit("NOT_FOUND fog")
t = t.replace(old, new, 1)
t = t.replace(
    "// Stage 3: warm sun + cool fill, mild exposure (no blown candy)",
    "// Stage 8: softer far fog so board stays focal; cooler sky depth",
    1,
)
p.write_text(t, encoding="utf-8")
print("OK")
