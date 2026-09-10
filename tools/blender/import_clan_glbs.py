from pathlib import Path
import bpy

# Run from Blender's Scripting workspace.
PROJECT_ROOT = Path(bpy.path.abspath("//")).resolve()
# If your .blend is elsewhere, set PROJECT_ROOT manually to the Blockfront repo root.
MODEL_DIR = PROJECT_ROOT / "static" / "assets" / "clan_models"

if not MODEL_DIR.exists():
    raise RuntimeError(f"Clan model directory not found: {MODEL_DIR}")

for glb_path in sorted(MODEL_DIR.glob("*.glb")):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    imported = [obj for obj in bpy.data.objects if obj not in before]
    collection = bpy.data.collections.new(glb_path.stem)
    bpy.context.scene.collection.children.link(collection)
    for obj in imported:
        for old_collection in list(obj.users_collection):
            old_collection.objects.unlink(obj)
        collection.objects.link(obj)
    print(f"Imported {glb_path.name}: {len(imported)} objects")
