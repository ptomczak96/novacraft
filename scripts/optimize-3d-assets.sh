#!/bin/zsh
# GEN 8 — 3D Tileset asset pipeline.
#
# Optimizes the raw GLB models in /assets (~40 MB each — far too heavy to
# serve) into the web app's public folder (~0.3 MB each): meshopt compression,
# textures resized to 1K webp, mesh simplification. Tiles get a coarser
# simplify error than units because they're instanced ~400× per board and
# their silhouettes survive it.
#
# Run after adding or re-exporting a model in /assets, then register any NEW
# unit in apps/web/src/render/voxel3d/models/modelAssets.ts (output filename
# must equal the engine unit typeId).
set -u
SRC="$(dirname "$0")/../assets"
OUT="$(dirname "$0")/../apps/web/public/voxel3d/models"
mkdir -p "$OUT/tiles" "$OUT/units"

opt() { # opt <in> <out> <simplify-error>
  npx -y @gltf-transform/cli optimize "$1" "$2" \
    --compress meshopt --texture-compress webp --texture-size 1024 \
    --simplify-error "$3" 2>&1 | tail -1
}

# Tiles (instanced ~400x — aggressive simplify)
opt "$SRC/Tile - Flat.glb"     "$OUT/tiles/flat.glb"     0.005
opt "$SRC/Tile - Forest.glb"   "$OUT/tiles/forest.glb"   0.005
opt "$SRC/Tile - Mountain.glb" "$OUT/tiles/mountain.glb" 0.005
opt "$SRC/Tile - Water.glb"    "$OUT/tiles/water.glb"    0.005

# Units — output name = engine unit typeId
opt "$SRC/Vanguard - Scout.glb"    "$OUT/units/scout.glb"      0.001
opt "$SRC/Vanguard - Warrior.glb"  "$OUT/units/warrior.glb"    0.001
opt "$SRC/Vanguard - Lancer.glb"   "$OUT/units/lancer.glb"     0.001
opt "$SRC/Vanguard - Bulwark.glb"  "$OUT/units/defender.glb"   0.001
opt "$SRC/Vanguard - Stalker.glb"  "$OUT/units/stalker.glb"    0.001
opt "$SRC/Vanguard - Wraith.glb"   "$OUT/units/wraith.glb"     0.001
opt "$SRC/Vanguard - Tank.glb"     "$OUT/units/tank.glb"       0.001
opt "$SRC/Vanguard - Titan.glb"    "$OUT/units/titan.glb"      0.001
opt "$SRC/Vanguard - Sentinel.glb" "$OUT/units/sentinel.glb"   0.001
opt "$SRC/Hive - Scuttling.glb"    "$OUT/units/scuttling.glb"  0.001
opt "$SRC/Hive - Scout.glb"        "$OUT/units/hive_scout.glb" 0.001
opt "$SRC/Hive - Scab.glb"         "$OUT/units/scab.glb"       0.001
opt "$SRC/Hive - Vindrace.glb"     "$OUT/units/vindrace.glb"   0.001
opt "$SRC/Hive - Seercaust.glb"    "$OUT/units/seercaust.glb"  0.001
opt "$SRC/Hive - Wyrm.glb"         "$OUT/units/wyrm.glb"       0.001
opt "$SRC/Hive - Burstling.glb"    "$OUT/units/burstling.glb"  0.001
opt "$SRC/Hive - Behemoth.glb"     "$OUT/units/behemoth.glb"   0.001

echo "=== DONE ==="
du -sh "$OUT"
