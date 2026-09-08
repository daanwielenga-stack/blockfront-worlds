# World design notes

## Why the public names are original

The development brief intentionally combines recognizable game-world concepts. For a public, monetized product, the safer production approach is to reproduce the *mechanical/visual idea* with original procedural geometry rather than distribute another publisher's art, logos, exact maps, branded characters or audio.

The current mapping is:

- block-arena FPS concept -> **Classic Arena**
- Minecraft-like voxel sandbox concept -> **Voxel Frontier**
- FIFA/EA Sports FC-like football venue concept -> **Stadium Clash**
- Fortnite-like colorful battle-island concept -> **Battle Isles**
- Clash of Clans-like 3D village concept -> **Clan Kingdom**

This is also better creatively: the project can evolve into a recognizable Blockfront identity rather than depending on crossover branding it does not control.

## Classic Arena

Compact lanes, block-built architecture, low cover and fast movement lines. This remains the cleanest environment for pure competitive FPS balancing.

## Voxel Frontier

This is the deepest crossover world in V2:

- chunky pixel-like materials;
- block trees and clouds;
- resource blocks;
- synchronized mining and building;
- seven placeable block types;
- server-synchronized simple redstone-style power propagation;
- lever -> wire -> lamp demo circuit;
- two-minute day/night cycle;
- blocky Zombie and Slime-style original mobs;
- mobs chase/attack players and can be shot/meleed for score;
- Runner displays a Block Sword;
- normal guns and match modes continue to function.

The redstone system is deliberately small and editable: `Room.recompute_power()` in `app.py` is the place to expand repeaters, doors, pistons, pressure plates, TNT-like arena mechanics, etc.

## Stadium Clash

A large rectangular football pitch with striped grass, touchlines, halfway line, center circle, penalty-box markings, goals, stands, floodlights, crowd mosaic and a football prop. The longer sightlines make sniper/marksman classes play very differently than on Classic Arena.

Future idea: synchronize the football server-side and add an optional goal-scoring secondary objective.

## Battle Isles

Bright, saturated low-poly terrain, colorful houses, built ramps, stylized pines/rocks and a translucent storm perimeter. It emphasizes vertical sightlines and playful color rather than voxel geometry.

Future idea: add a world-specific limited building resource or slowly moving storm for a special mode without replacing the arena timer.

## Clan Kingdom

A top-down-strategy-inspired environment translated into first-person 3D: wall rings, a central keep, huts, resource storages, cannon towers, flags and exaggerated village colors.

Future idea: allow teams to damage opposing village structures during a timed objective mode.
