from pathlib import Path
p = Path(r"c:\Users\Антон\Desktop\threejs__journey\src\game\themes\jungle.js")
t = p.read_text(encoding="utf-8")
# Normalize for match
if "bloom: 0.035, exposure: 0.92," not in t:
    raise SystemExit("day bloom line missing")
t = t.replace(
    "bloom: 0.18, exposure: 1.05,\n  },",
    "bloom: 0.18, exposure: 1.05,\n"
    "    post: { vignette: 0.32, contrast: 1.04, saturation: 1.04, sharpen: 0.04 },\n  },",
    1,
)
t = t.replace(
    "    // Stage 3: warm sun + cool fill, mild exposure (no blown candy)\n"
    "    sky: '#7EB8D0', fogNear: 36, fogFar: 118,\n"
    "    hemiSky: '#C8DCE8', hemiGround: '#7AA868', hemiIntensity: 1.28,\n"
    "    sunColor: '#FFE8C4', sunIntensity: 1.35,\n"
    "    accentIntensity: 1.05,\n"
    "    underGlow: '#78B860', underGlowIntensity: 0.55,\n"
    "    spot: '#fff4e8', spotIntensity: 2.4,\n"
    "    bloom: 0.035, exposure: 0.92,\n  },",
    "    // Stage 8 fog + Stage 9 mild grade\n"
    "    sky: '#7EB8D0', fogNear: 36, fogFar: 118,\n"
    "    hemiSky: '#C8DCE8', hemiGround: '#7AA868', hemiIntensity: 1.28,\n"
    "    sunColor: '#FFE8C4', sunIntensity: 1.35,\n"
    "    accentIntensity: 1.05,\n"
    "    underGlow: '#78B860', underGlowIntensity: 0.55,\n"
    "    spot: '#fff4e8', spotIntensity: 2.4,\n"
    "    bloom: 0.045, exposure: 0.92,\n"
    "    post: { vignette: 0.22, contrast: 1.05, saturation: 1.07, sharpen: 0.06 },\n  },",
    1,
)
needle = "  createBackdrop,\n  createProps,\n\n  // Softer multi-band toon"
if needle not in t:
    raise SystemExit("createBackdrop block missing")
t = t.replace(
    needle,
    "  createBackdrop,\n  createProps,\n\n"
    "  // Stage 9: opt-in canvas grade (UI untouched).\n"
    "  post: { vignette: 0.28, contrast: 1.04, saturation: 1.05, sharpen: 0.05 },\n\n"
    "  // Softer multi-band toon",
    1,
)
p.write_text(t, encoding="utf-8")
print("OK")
