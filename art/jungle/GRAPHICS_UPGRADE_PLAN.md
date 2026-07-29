# Jungle graphics upgrade — agent plan

Source art direction: stylized arcade low-poly (Fall Guys / party-game), not photoreal.
Blend: `art/jungle/jungle_backdrop_review.blend`
Backup: `art/jungle/backups/jungle_backdrop_review_backup_2026-07-29.blend`
Runtime: `public/assets/maps/jungle/` + `src/game/themes/jungle.js`

## Self-instructions

1. Never one-shot the whole scene.
2. Stage N only after user signs off stage N−1 (except Stage 0 diagnose + backup).
3. No deletes of gameplay objects; decorate only in `GRAPHICS_UPGRADE` / `FOLIAGE_KIT`.
4. After each stage: check duplicates, normals, origins, poly budget, collections; screenshot/render; report deltas.
5. Prefer modular instances over 50 unique plants.
6. Keep board center readable; exaggerate silhouettes, not noise.
7. Export to game only after a stage that changes exported meshes.

## Stage checklist

### Stage 0 — Diagnose + backup (DONE 2026-07-29)

**Backup:** `art/jungle/backups/jungle_backdrop_review_backup_2026-07-29.blend`

**Snapshot**
| Item | Value |
|------|--------|
| Engine | Eevee (`BLENDER_EEVEE`), 1920×1080 |
| Objects | 399 mesh, 2 lights, 1 cam, 37 empty |
| Tris (approx) | ~115k |
| Lights | `Sun` warm 2.5, `HemiFill` Area energy 350 cool-green |
| Camera | `ReviewCam` (11, -13, 9) lens 35 |
| World | strength 1.0, mint green `(0.49, 0.78, 0.63)` |
| Lake | `LakeSurface` / `LakeDeep` / `LakeBank` + 60 WaterFX (foam/sparkle) |
| Arena (Blender) | PlaySurface + Rim + Plinth in `01_ArenaProxy` (review only; game L0 is procedural) |

**Findings (priority)**
1. **Zero Bevel modifiers** on scene — edges read hard vs reference toy look.
2. **~258 meshes fully flat-shaded** — needs selective Shade Smooth / Auto Smooth.
3. **Playfield too flat** — `Arena_PlaySurface` is a thin slab; reference wants beveled convex cells + island cliff thickness (`Arena_Plinth` exists but game does not use authored arena).
4. **Yellow canopy mats still yellow in Blender** — `PalmLeafYellow` / `LeafYellow` diffuse ≈ `(0.94, 0.91, 0.42)`; runtime remaps green, Blender review does not.
5. **Heavy insects** — caterpillars 5×5760 tris, bees 8×2904; fine for now, optimize later if needed.
6. **34 Orphan Nodes collections** — clutter only; safe to ignore or purge in cleanup pass.
7. **No `GRAPHICS_UPGRADE` / `FOLIAGE_KIT` yet** — create on Stage 1+.
8. **Composition gap vs reference** — island cliff+vines into water, water ripples/pads, denser shore palms, soft AO/bloom balance.

**Stage order confirmed**
1 playfield visual → 2 materials → 3 light → 4 water → 5 foliage kit → 6 island edge → 7 GOLDIE → 8 depth → 9 post → 10 runtime export

**Note for Stage 1:** In-game board = `platforms.js` tiles (not Blender Arena). Do **1a runtime tiles** + **1b Blender review PlaySurface visual double** in `GRAPHICS_UPGRADE` without touching `Col_*` / `Obs_*`.


### Stage 1 — Playfield visual only (DONE 2026-07-29)

**1a Runtime (`platforms.js` + `jungle.js` surface)**
- Theme: `tileC`/`tileD`, `tileBevel: 0.11`, `tileBevelSegs: 3`, `tileHeightJitter: 0.022`
- Shared `RoundedBoxGeometry` when bevel differs from default; 4-way grass pick

**1b Blender review double (`GRAPHICS_UPGRADE`)**
- 81× `VisCell_*` beveled toy cells; `Arena_PlaySurface` hidden in review
- Mats: `MAT_Grass_A/B/C/D` + `MAT_Grass_Side`; Shade Smooth
- `VisCell_*` `hide_render=True` (viewport only) — not shipped in `scene.glb`
- Canopy mats forced green in Blend (`LeafYellow` / `PalmLeafYellow` → green)
- Review still: `art/jungle/refs/stage1_playfield_review.png`
- Preview: `/preview.html?map=jungle&day=1&level=0`

### Stage 2 — Material kit (DONE 2026-07-29)

**Blender kit** (`MAT_*`, Principled + soft large Noise mix ≤0.18 Fac)
- Grass A/B/C/D/Side · Rock / Rock_Dark · Wood / Wood_Dark
- Foliage Light/Mid/Dark · Dirt · Water / Deep / Foam · Goldie
- Scene mats remapped onto kit roles (names kept for runtime palette keys)
- Photo albedo links stripped from remapped Principled Base Color
- Swatches: `MatSwatch_*` in `GRAPHICS_UPGRADE` (export-skipped)

**Runtime sync** (`jungle.js`)
- Constants + `DAY_PALETTE` aligned to kit hex
- Board tiles use Grass A–D; canopy cooler mid/dark; stone soft lilac-gray; Goldie candy gold

**Review:** `art/jungle/refs/stage2_materials_review.png`
**Preview:** `/preview.html?map=jungle&day=1&level=0`

### Stage 3 — Lighting (DONE 2026-07-29)

**Blender**
- Sun warm `(1.0, 0.94, 0.82)` energy `2.05`, soft `angle` 0.045
- `HemiFill` cool Area disk energy `220`, no shadow; soft `GroundBounce` green Area
- World cool blue `(0.52, 0.70, 0.88)` strength `0.55`
- AgX + `AgX - Medium High Contrast`, exposure `-0.15`
- Mild compositor Fog Glow (threshold high / mix low)
- EEVEE soft shadows + Fast GI

**Runtime** (`jungle.js` day)
- Cooler sky/hemi fill, warmer softer sun, bloom `0.035`, exposure `0.92`

**Review:** `art/jungle/refs/stage3_lighting_review.png`
**Preview:** `/preview.html?map=jungle&day=1&level=0`

### Stage 4 — Water (DONE 2026-07-29)

**Blender**
- `LakeSurface` / `LakeDeep`: mid roughness + large soft bump (toy, not ocean)
- Layers in `14_WaterFX`: Foam×16, Ripple×8, ShoreRing×3, Sparkle×28, LilyPad×10
- Mats: Water / WaterDeep / WaterFoam / WaterSpark / WaterRipple / WaterShoreRing / WaterPad

**Runtime** (`jungle.js`)
- Palette keys for new water mats; soft opacity on foam/ripple/sparkle
- Idle bob/pulse/blink for Ripple / ShoreRing / Sparkle / Foam / LilyPad

**Note on shadows/shaders (plan):** soft EEVEE shadows = Stage 3; GOLDIE contact shadow = Stage 7; mild post grade = Stage 9. No custom GLSL water shaders — mesh planes + materials only.

**Review:** `art/jungle/refs/stage4_water_review.png`
**Preview:** `/preview.html?map=jungle&day=1&level=0`

### Stage 5 — FOLIAGE_KIT + placement (DONE 2026-07-29)

**Kit masters** (`FOLIAGE_KIT`, export-skipped):
- Bush A/B/C · Grass A/B/C · TreeSmall A/B · Palm A/B · Flower A/B · Vine A/B
- From Kenney templates; Stage-2 leaf/wood/flower mats

**Placement**
- 11 clusters (3–7 props), denser toward +Y (back of ReviewCam)
- Board clear `|x|,|y| < 6.2` — no kit plants on play cells
- +10 shore palms ring
- Fixed broken `Fern_*` / `VineBridge_*` / `VineDrape_*` stacked at origin → shore/trees
- Exported `KitInst_*` ×65 into `scene.glb`

**Review:** `art/jungle/refs/stage5_foliage_review.png`
**Preview:** `/preview.html?map=jungle&day=1&level=0`

### Stage 6 — Island edge (REVERTED 2026-07-29)

User rejected the green ring + supporting cliff “rocks”. Removed all `IslandCliff_*` / `IslandHang_*` / `16_IslandEdge` from blend + `scene.glb`. Revisit later with a different silhouette if needed.

### Stage 7 — GOLDIE visual mesh (SKIPPED 2026-07-29)

Runtime die already exists in `src/game/dice.js` (`RoundedBoxGeometry` + pips). Keep size/origin/collision as-is; no separate GOLDIE rebuild this pass.

### Stage 8 — Depth composition (DONE 2026-07-29)

**Blender**
- Cooler far mats: Mountain / MountainDark / Snow; `FarLeaf*` on `JungleTreeFar_*`
- Soft world mist (start 28 / depth 55) + cooler world blue
- Foreground `FrameLeaf_*` ×8 near ReviewCam (`17_DepthFrame`)
- Soft `DepthHaze_Far` card behind board

**Runtime**
- Day fog `36→118`; cooler Mountain palette; FarLeaf / FrameLeaf / DepthHaze keys

**Review:** `art/jungle/refs/stage8_depth_review.png`
**Preview:** `/preview.html?map=jungle&day=1&level=0`

### Stage 9 — Post (subtle) (DONE 2026-07-29)

**Runtime** (jungle only via `theme.post`; UI untouched)
- Mild `ShaderPass`: vignette / contrast / saturation / tiny sharpen
- Day: vignette `0.22`, contrast `1.05`, sat `1.07`, bloom `0.045`
- Night: slightly stronger vignette

**Blender**
- Compositor: Fog Glow + Bright/Contrast + HueSat (AgX Medium High)
- Review: `art/jungle/refs/stage9_post_review.png`

**Preview:** `/preview.html?map=jungle&day=1&level=0`

### Stage 10 — Runtime sync (DONE 2026-07-29)

**Export**
- Fresh `public/assets/maps/jungle/backdrop/scene.glb` (407 meshes)
- Skip: Arena/Obs/Col/Tpl/VisCell/MatSwatch/Kit masters / GRAPHICS_UPGRADE
- Confirmed **0** `IslandCliff_*` (reverted Stage 6)
- Present: KitInst×65, FrameLeaf×8, Ripple×8, LilyPad×10, water FX

**Runtime align**
- Candy palette + Stage 1 tiles + lake FX + Stage 8 fog/depth + Stage 9 grade
- Scene cache-bust `?v=gfx10`
- Props unchanged: tree/stump/fern/vine/piranha GLBs

**Review:** `art/jungle/refs/stage10_final_review.png`
**Preview:** `/preview.html?map=jungle&day=1&level=0`

## Plan status

| Stage | Status |
|------|--------|
| 0 Diagnose | DONE |
| 1 Playfield | DONE |
| 2 Materials | DONE |
| 3 Lighting | DONE |
| 4 Water | DONE |
| 5 Foliage | DONE |
| 6 Island edge | REVERTED (user) |
| 7 GOLDIE | SKIPPED |
| 8 Depth | DONE |
| 9 Post | DONE |
| 10 Runtime sync | DONE |
