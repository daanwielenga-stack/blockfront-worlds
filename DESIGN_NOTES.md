# Blockfront Worlds V2 design notes

## Product direction

V1 established the fast browser-arena core. V2 turns it into an original multi-world product rather than a single-game clone.

Shared across every world:

- click-to-play browser FPS;
- WASD + mouse controls;
- slide/bunny-hop movement;
- class weapons, ADS, reloads and melee;
- FFA/TDM/Hardpoint;
- 4-minute match timer;
- killfeed, scoreboard, HP/ammo HUD;
- private rooms/invite URLs;
- WebSocket multiplayer.

World-specific systems sit on top of this common layer so a new world can be added without rewriting the shooter.

## World architecture

`app.py` owns canonical world metadata in `WORLDS`. Each world defines:

- `boxes` — static collision / line-of-sight geometry;
- `spawns`;
- `hardpoints`;
- `bounds`;
- sky/fog/ground colors;
- feature flags such as `build`, `day_night`, and `mobs`.

`static/game.js` reads that configuration and adds the richer decorative geometry for each theme.

Multiplayer rooms are keyed by `(room_code, world)`. This prevents a Classic Arena player and Voxel Frontier player using the same code from being accidentally synchronized into incompatible maps.

## Voxel Frontier special systems

Voxel gameplay is synchronized by the Python server:

- mutable block dictionary per room;
- block-place and block-break validation;
- maximum build distance;
- maximum block count;
- seven block types;
- simple lever/redstone/lamp propagation;
- server-controlled mob HP/movement/attacks;
- mob score rewards;
- synchronized block updates to all players;
- day/night phase derived from server room time.

The client provides immediate visuals and controls; health, scores, mobs and block edits are decided by the server.

## Public-product decisions

The shipped world names/assets are original on purpose. The development concepts reference well-known game genres, but the public build does not redistribute third-party maps, textures, logos, character models, music, source code or branded UI.

That gives Blockfront room to become its own recognizable game and avoids making future monetization dependent on unlicensed crossover assets.

## Monetization decisions

`static/ads.js` is kept separate from `game.js`.

- Ads default OFF.
- No ad unit exists in active FPS gameplay.
- A menu surface is reserved away from the central Play interaction.
- A round-complete surface is reserved for a natural break.
- Provider/account details are environment variables, not hard-coded.

## Current technical ceiling

The public alpha intentionally uses one in-memory FastAPI process. That keeps deployment and iteration simple, but means multiple Render instances must not be enabled until room state is moved to shared infrastructure such as Redis.

See `ROADMAP.md` for the scaling path.
