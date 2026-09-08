# Blockfront Worlds — Version 2

A browser-based multiplayer FPS with a Python/FastAPI WebSocket server and five original game worlds. The core is a fast arena shooter (slide hopping, ADS, classes, short respawns, FFA/TDM/Hardpoint), but each world has its own visual language and, where useful, extra mechanics.

This repository is designed to be:

- opened and edited directly in VS Code;
- run locally on Windows/macOS/Linux;
- pushed to GitHub;
- deployed as one public Render Web Service;
- updated later by pushing new commits;
- monetization-ready without showing ads during active FPS gameplay.

## The five worlds

| World | Development concept | Shipped identity | Gameplay additions |
|---|---|---|---|
| 1 | fast block arena shooter | **Classic Arena** | original compact arena, slide-hop routes |
| 2 | voxel survival sandbox | **Voxel Frontier** | mining, block placement, simple redstone-style circuit, day/night, mobs, Block Sword |
| 3 | football videogame stadium | **Stadium Clash** | full pitch, goals, stands, floodlights, football prop |
| 4 | colorful battle-island shooter | **Battle Isles** | saturated low-poly island, ramps, stylized pines, storm perimeter |
| 5 | 3D clan-raiding village | **Clan Kingdom** | walls, keep, towers, storages, cannons, flags |

The production build intentionally uses **original/procedural geometry, colors, UI and code**, not copied assets, logos, maps, textures, sounds or source code from Minecraft, FIFA/EA Sports FC, Fortnite, Clash of Clans, Krunker, or any other game.

## Core gameplay

- Browser-rendered 3D FPS with Three.js.
- Python/FastAPI WebSocket multiplayer.
- FFA, TDM and Hardpoint.
- 10 class archetypes.
- ADS, recoil, reloads, range, spread, headshots, server-side damage and respawning.
- Slide hopping, bunny hopping and wall jumps for mobility classes.
- Private room codes and shareable invite URLs.
- Live room browser.
- Chat, scoreboard, killfeed and match timer.
- Rooms are isolated by **room code + world**, allowing every world to run simultaneously.
- Up to 16 players per room by default (`MAX_PLAYERS_PER_ROOM`).

## Voxel Frontier controls

Voxel Frontier keeps the shooter intact. Press **B** to swap between gun combat and build/mining mode.

| Action | Control |
|---|---|
| Move | W A S D |
| Look | Mouse |
| Fire | Left mouse |
| ADS | Right mouse |
| Jump / bunny hop | Space |
| Slide / crouch | Shift |
| Reload | R |
| Quick melee / Block Sword | Q |
| Toggle build/mining mode | B |
| Mine selected block | Left mouse in build mode |
| Place block | Right mouse in build mode |
| Cycle block | V |
| Select block 1–7 | Number keys 1–7 |
| Use lever | E in build mode |
| Scoreboard | Hold Tab |
| Chat | Enter |
| Menu | Esc |

## Run locally on Windows

Open this folder in VS Code and run:

```powershell
.\run_windows.bat
```

Then visit:

```text
http://127.0.0.1:8000
```

Do **not** browse to `http://0.0.0.0:8000`; `0.0.0.0` is only the address the server listens on.

Manual setup:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

## Run the tests

```powershell
pytest -q
```

The current automated suite covers health/config endpoints, all five world definitions, ray hit helpers, world-separated rooms, the voxel redstone-style network, ad defaults and the room browser.

## Deploy it publicly

See **[DEPLOY_RENDER.md](DEPLOY_RENDER.md)** for the exact GitHub + Render steps.

The included deployment files are:

- `Dockerfile`
- `render.yaml`
- `.dockerignore`
- `/health` endpoint
- automatic `ws://` locally / `wss://` over HTTPS in the browser

A Render Free web service is suitable for an alpha. For a more serious public launch, switch to an always-on paid instance so the first visitor after an idle period does not wait for a cold start.

## Editing after deployment

The normal workflow is:

```text
VS Code -> edit files -> git commit -> git push -> Render auto-deploys the new version
```

You do **not** edit files on the Render server. Your GitHub repository remains the source of truth, so future changes are straightforward.

## Monetization architecture

Ads are intentionally **disabled by default**. The app already contains provider-independent menu and natural-round-break ad surfaces in `static/ads.js`.

Environment variables:

```text
ADS_ENABLED=0
ADS_PROVIDER=placeholder
ADSENSE_CLIENT=
ADSENSE_MENU_SLOT=
ADSENSE_BREAK_SLOT=
```

When an ad account is approved, see **[MONETIZATION.md](MONETIZATION.md)** before enabling them. In particular, active gameplay contains no ad unit; advertising is reserved for the menu and natural breaks.

## Public-alpha limitations

This is now a real deployable multiplayer alpha, but it is not yet a large-scale competitive backend. Current room state lives in one Python process. That means:

- use one Render instance for now;
- restarting/deploying the service resets live rooms;
- there are no persistent user accounts/XP yet;
- horizontal scaling would require shared state (typically Redis) and persistent accounts/stats would require a database such as PostgreSQL;
- movement is client-predicted and sanity-clamped rather than fully server-authoritative.

These are deliberate alpha tradeoffs and are documented in `ROADMAP.md`.

## Main files

- `app.py` — world data, rooms, WebSockets, hit detection, mobs, voxel blocks/redstone, server APIs.
- `static/game.js` — Three.js worlds, FPS controller, networking, guns, building/mining and UI behavior.
- `static/index.html` — menu/HUD/modals/world selector.
- `static/style.css` — complete styling.
- `static/ads.js` — disabled-by-default monetization adapter.
- `static/privacy.html` / `static/terms.html` — launch placeholders to be reviewed before commercial use.
- `tests/test_server.py` — automated server tests.
- `DEPLOY_RENDER.md` — public hosting walkthrough.
- `MONETIZATION.md` — ad architecture and launch checklist.
- `WORLD_DESIGN.md` — world-specific mechanics and safe asset strategy.
