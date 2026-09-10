# Clan model Blender workflow

The game uses original GLB assets in `static/assets/clan_models/`. They are deliberately original, stylized clan-fantasy models rather than copies of Supercell assets.

To edit them in Blender:

1. Open Blender 4.x.
2. Open the Scripting workspace.
3. Run `import_clan_glbs.py` from this folder.
4. The script imports every GLB from `static/assets/clan_models/` into separate collections.
5. Edit proportions/materials/animation as desired.
6. Export each collection back to GLB using File > Export > glTF 2.0.

The browser loads these models with Three.js GLTFLoader and falls back to procedural geometry if a model is missing.
