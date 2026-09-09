from __future__ import annotations

import asyncio
import math
import os
import random
import logging
import re
import string
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"

logger = logging.getLogger("blockfront")

app = FastAPI(title="Blockfront Worlds", version="2.1.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    return response

# ---------------------------------------------------------------------------
# Combat classes. Original data tuned for a fast browser arena FPS.
# ---------------------------------------------------------------------------
CLASSES = {
    "Triggerman": {"weapon": "Assault Rifle", "hp": 100, "speed": 1.00, "damage": 27, "rpm": 650, "mag": 30, "reload": 1.35, "spread": 0.006, "range": 85, "wall_jump": False, "color": "#f2c14e"},
    "Run N Gun": {"weapon": "SMG", "hp": 100, "speed": 1.12, "damage": 19, "rpm": 850, "mag": 34, "reload": 1.20, "spread": 0.010, "range": 58, "wall_jump": True, "color": "#42d392"},
    "Hunter": {"weapon": "Sniper Rifle", "hp": 60, "speed": 1.02, "damage": 105, "rpm": 55, "mag": 3, "reload": 1.65, "spread": 0.0015, "range": 150, "wall_jump": False, "color": "#9b8cff"},
    "Spray N Pray": {"weapon": "LMG", "hp": 170, "speed": 0.86, "damage": 23, "rpm": 600, "mag": 60, "reload": 2.20, "spread": 0.014, "range": 80, "wall_jump": False, "color": "#ef476f"},
    "Vince": {"weapon": "Shotgun", "hp": 100, "speed": 1.04, "damage": 16, "rpm": 115, "mag": 5, "reload": 1.70, "spread": 0.065, "range": 24, "wall_jump": False, "pellets": 7, "color": "#ff7b54"},
    "Detective": {"weapon": "Revolver", "hp": 100, "speed": 1.00, "damage": 56, "rpm": 210, "mag": 6, "reload": 1.45, "spread": 0.004, "range": 95, "wall_jump": False, "color": "#ffd166"},
    "Marksman": {"weapon": "Semi Auto", "hp": 90, "speed": 1.00, "damage": 35, "rpm": 360, "mag": 12, "reload": 1.35, "spread": 0.003, "range": 100, "wall_jump": False, "color": "#06d6a0"},
    "Rocketeer": {"weapon": "Launcher", "hp": 130, "speed": 0.92, "damage": 82, "rpm": 70, "mag": 2, "reload": 1.95, "spread": 0.008, "range": 75, "wall_jump": False, "splash": 5.2, "color": "#ff9f1c"},
    "Agent": {"weapon": "Dual Uzis", "hp": 100, "speed": 1.10, "damage": 15, "rpm": 960, "mag": 36, "reload": 1.28, "spread": 0.020, "range": 48, "wall_jump": True, "color": "#00b4d8"},
    "Runner": {"weapon": "Combat Blade", "hp": 120, "speed": 1.22, "damage": 100, "rpm": 130, "mag": 1, "reload": 0.35, "spread": 0.0, "range": 3.0, "wall_jump": True, "melee": True, "color": "#e9ecef"},
}


def box(x, y, z, w, h, d, c="#666666", tag="solid", removable=False):
    return {"x": x, "y": y, "z": z, "w": w, "h": h, "d": d, "c": c, "tag": tag, "removable": removable}


# ---------------------------------------------------------------------------
# Five original world themes. The production names deliberately avoid third-
# party branding while preserving the concepts the project was designed for.
# ---------------------------------------------------------------------------
def classic_world():
    boxes = [
        box(0, 2.5, -40, 82, 5, 2, "#303238", "wall"), box(0, 2.5, 40, 82, 5, 2, "#303238", "wall"),
        box(-40, 2.5, 0, 2, 5, 82, "#303238", "wall"), box(40, 2.5, 0, 2, 5, 82, "#303238", "wall"),
        box(-23, 5, -18, 14, 10, 18, "#59636f", "building"), box(23, 4, -20, 15, 8, 14, "#6d5f55", "building"),
        box(-22, 4, 20, 16, 8, 15, "#516a58", "building"), box(23, 5.5, 20, 17, 11, 17, "#62606d", "building"),
        box(0, 2.25, 0, 10, 4.5, 10, "#4d565f", "cover"), box(-11, 1.5, -5, 5, 3, 5, "#2f80ed", "cover"),
        box(12, 1.5, 7, 5, 3, 5, "#8e44ad", "cover"), box(3, 1.25, -17, 4, 2.5, 8, "#b87333", "crate"),
        box(-3, 1.25, 17, 4, 2.5, 8, "#b87333", "crate"), box(-12, 2.1, 9, 2, 4.2, 13, "#3f444a", "wall"),
        box(13, 2.1, -8, 2, 4.2, 13, "#3f444a", "wall"), box(-30, 1, 2, 5, 2, 8, "#66717e", "cover"),
        box(30, 1, -2, 5, 2, 8, "#66717e", "cover"), box(-3, 1, 30, 9, 2, 4, "#7a6b4f", "cover"),
        box(4, 1, -30, 9, 2, 4, "#7a6b4f", "cover"),
    ]
    return {
        "id": "classic", "name": "Classic Arena", "short": "Arena", "theme": "classic",
        "description": "The fast original Blockfront arena: compact lanes, cover and slide-hop routes.",
        "boxes": boxes,
        "spawns": [(-33, 0, -32), (33, 0, 32), (-33, 0, 32), (33, 0, -32), (-8, 0, -31), (8, 0, 31), (-31, 0, 7), (31, 0, -8)],
        "hardpoints": [(-8, 0, -8), (21, 0, 2), (-20, 0, 4), (0, 0, 25)],
        "bounds": [-200000, 200000, -200000, 200000], "ground": "#71915c", "sky": "#78c8ec", "fog": "#78c8ec",
        "build": False, "day_night": False, "mobs": False, "infinite": True,
    }


def voxel_world():
    boxes = [
        # Central handcrafted landmarks; the wider terrain now streams outward through
        # procedural chunk generation so the world can continue effectively forever.
        box(-3, 2, -24, 2, 4, 10, "#777777", "stone"), box(5, 2, -24, 2, 4, 10, "#777777", "stone"),
        box(1, 4.5, -24, 10, 1, 10, "#676767", "stone"),
        box(-8, .6, 3, 18, 1.2, 3, "#9b7042", "wood"), box(13, .6, -2, 12, 1.2, 3, "#9b7042", "wood"),
        box(23, 2, -21, 10, 4, 1, "#a97848", "wood"), box(23, 2, -13, 10, 4, 1, "#a97848", "wood"),
        box(18.5, 2, -17, 1, 4, 9, "#a97848", "wood"), box(27.5, 2, -17, 1, 4, 9, "#a97848", "wood"),
        box(23, 4.5, -17, 10, 1, 9, "#7e5632", "wood"),
    ]
    return {
        "id": "voxel", "name": "Voxel Frontier", "short": "Voxel", "theme": "voxel",
        "description": "Infinite voxel survival meets arena FPS: mine anywhere, dig underground, build, power lamps and fight mobs.",
        "boxes": boxes,
        "spawns": [(-27, 5, -27), (27, 5, 27), (-27, 5, 27), (27, 5, -27), (0, 5, 25), (0, 5, -12), (-25, 5, 0), (25, 5, 2)],
        "hardpoints": [(-15, 5, -15), (16, 5, 14), (0, 5, -6), (0, 5, 21)],
        "bounds": [-200000, 200000, -200000, 200000], "ground": "#75a84b", "sky": "#7ec8ff", "fog": "#9ed6ff",
        "build": True, "day_night": True, "mobs": True, "grid": 2, "infinite": True,
    }


def stadium_world():
    boxes = [
        # Stadium bowl / stands.
        box(0, 2.5, -31, 78, 5, 4, "#334155", "stand"), box(0, 2.5, 31, 78, 5, 4, "#334155", "stand"),
        box(-39, 2.5, 0, 4, 5, 66, "#334155", "stand"), box(39, 2.5, 0, 4, 5, 66, "#334155", "stand"),
        box(0, 5.0, -35, 82, 5, 4, "#475569", "stand"), box(0, 5.0, 35, 82, 5, 4, "#475569", "stand"),
        # Dugouts / cover.
        box(-20, 1.25, -25, 10, 2.5, 3, "#1f2937", "dugout"), box(20, 1.25, 25, 10, 2.5, 3, "#1f2937", "dugout"),
        box(-8, 1, 0, 4, 2, 4, "#e5e7eb", "cover"), box(8, 1, 0, 4, 2, 4, "#e5e7eb", "cover"),
        # Goal frames are solid enough to create vertical routes.
        box(-34, 1.5, -5, .6, 3, 10, "#f8fafc", "goal"), box(34, 1.5, 5, .6, 3, 10, "#f8fafc", "goal"),
        box(-32, 3.1, -5, 4, .4, 10, "#f8fafc", "goal"), box(32, 3.1, 5, 4, .4, 10, "#f8fafc", "goal"),
    ]
    return {
        "id": "stadium", "name": "Stadium Clash", "short": "Stadium", "theme": "stadium",
        "description": "A floodlit football arena built for long sightlines, goalmouth fights and midfield chaos.",
        "boxes": boxes,
        "spawns": [(-31, 0, -20), (31, 0, 20), (-31, 0, 20), (31, 0, -20), (-18, 0, 0), (18, 0, 0), (0, 0, -24), (0, 0, 24)],
        "hardpoints": [(0, 0, 0), (-25, 0, 0), (25, 0, 0), (0, 0, 20)],
        "bounds": [-200000, 200000, -200000, 200000], "ground": "#2e8b57", "sky": "#89c7ff", "fog": "#89c7ff",
        "build": False, "day_night": False, "mobs": False, "infinite": True,
    }


def battle_world():
    boxes = [
        box(0, 2.5, -40, 84, 5, 2, "#6f7db8", "stormwall"), box(0, 2.5, 40, 84, 5, 2, "#6f7db8", "stormwall"),
        box(-40, 2.5, 0, 2, 5, 84, "#6f7db8", "stormwall"), box(40, 2.5, 0, 2, 5, 84, "#6f7db8", "stormwall"),
        # Cartoon houses.
        box(-22, 3, -18, 11, 6, 10, "#ff8a65", "house"), box(20, 2.5, -20, 10, 5, 9, "#64b5f6", "house"),
        box(-22, 2.5, 20, 10, 5, 9, "#ffd54f", "house"), box(21, 3.5, 20, 12, 7, 11, "#9575cd", "house"),
        # Ramps / battle-built cover represented as stepped solids.
        box(-6, .6, -7, 7, 1.2, 4, "#c58a4c", "ramp"), box(-6, 1.6, -10, 7, 1.2, 4, "#c58a4c", "ramp"), box(-6, 2.6, -13, 7, 1.2, 4, "#c58a4c", "ramp"),
        box(11, .6, 5, 6, 1.2, 4, "#b88658", "ramp"), box(11, 1.6, 8, 6, 1.2, 4, "#b88658", "ramp"),
        box(0, 1.5, 21, 4, 3, 9, "#5c6bc0", "cover"), box(2, 1.25, -25, 8, 2.5, 4, "#26a69a", "cover"),
        box(-29, 1.4, 2, 5, 2.8, 8, "#ab47bc", "cover"), box(30, 1.4, -2, 5, 2.8, 8, "#42a5f5", "cover"),
    ]
    return {
        "id": "battle", "name": "Battle Isles", "short": "Isles", "theme": "battle",
        "description": "Bright battle-island terrain with stylized homes, ramps, pines and a glowing storm perimeter.",
        "boxes": boxes,
        "spawns": [(-33, 0, -33), (33, 0, 33), (-33, 0, 33), (33, 0, -33), (-8, 0, -31), (8, 0, 31), (-31, 0, 8), (31, 0, -8)],
        "hardpoints": [(0, 0, 0), (-22, 0, 9), (23, 0, -8), (0, 0, 26)],
        "bounds": [-200000, 200000, -200000, 200000], "ground": "#63b75d", "sky": "#7dc7ff", "fog": "#a6d9ff",
        "build": False, "day_night": False, "mobs": False, "infinite": True,
    }


def clan_world():
    boxes = [
        # outer village wall ring
        box(0, 1.1, -22, 34, 2.2, 2, "#8c8f93", "clanwall"), box(0, 1.1, 22, 34, 2.2, 2, "#8c8f93", "clanwall"),
        box(-22, 1.1, 0, 2, 2.2, 34, "#8c8f93", "clanwall"), box(22, 1.1, 0, 2, 2.2, 34, "#8c8f93", "clanwall"),
        # inner compartment walls
        box(0, 1.1, -10, 22, 2.2, 2, "#8c8f93", "clanwall"), box(0, 1.1, 10, 22, 2.2, 2, "#8c8f93", "clanwall"),
        box(-10, 1.1, 0, 2, 2.2, 22, "#8c8f93", "clanwall"), box(10, 1.1, 0, 2, 2.2, 22, "#8c8f93", "clanwall"),
        # town hall core
        box(0, 2.8, 0, 12, 5.6, 12, "#c1703d", "townhall"), box(0, 5.9, 0, 9, 1.2, 9, "#e08a48", "roofbase"),
        box(0, 7.1, 0, 6, 1.2, 6, "#f0a24d", "rooftop"),
        # storages
        box(-15, 2.2, -15, 8, 4.4, 8, "#d0a23d", "goldstorage"), box(15, 2.2, 15, 8, 4.4, 8, "#d0a23d", "goldstorage"),
        box(-15, 2.2, 15, 8, 4.4, 8, "#a257d8", "elixirstorage"), box(15, 2.2, -15, 8, 4.4, 8, "#a257d8", "elixirstorage"),
        # huts and defenses
        box(-30, 2.2, -24, 8, 4.4, 8, "#9e5b3b", "hut"), box(30, 2.2, 24, 8, 4.4, 8, "#9e5b3b", "hut"),
        box(30, 2.2, -24, 8, 4.4, 8, "#9e5b3b", "hut"), box(-30, 2.2, 24, 8, 4.4, 8, "#9e5b3b", "hut"),
        box(-28, 2.0, 0, 5, 4.0, 5, "#81644f", "tower"), box(28, 2.0, 0, 5, 4.0, 5, "#81644f", "tower"),
        box(0, 2.0, -28, 5, 4.0, 5, "#81644f", "tower"), box(0, 2.0, 28, 5, 4.0, 5, "#81644f", "tower"),
        box(-30, 1.0, -8, 5, 2.0, 5, "#6f7376", "cannon"), box(30, 1.0, 8, 5, 2.0, 5, "#6f7376", "cannon"),
        box(-8, 1.0, 30, 5, 2.0, 5, "#6f7376", "cannon"), box(8, 1.0, -30, 5, 2.0, 5, "#6f7376", "cannon"),
        # army camps / collectors / path markers
        box(-34, 1.0, 12, 7, 2.0, 7, "#8b6c4f", "camp"), box(34, 1.0, -12, 7, 2.0, 7, "#8b6c4f", "camp"),
        box(-34, 1.0, -12, 6, 2.0, 6, "#b98945", "collector"), box(34, 1.0, 12, 6, 2.0, 6, "#a757d6", "collector"),
        # extra familiar village silhouettes: mortar, barracks, clan castle and wizard towers
        box(-16, 1.4, 0, 6, 2.8, 6, "#5b5e63", "mortar"), box(16, 1.4, 0, 6, 2.8, 6, "#5b5e63", "mortar"),
        box(0, 2.0, -16, 7, 4.0, 7, "#8d5b42", "barracks"), box(0, 2.0, 16, 7, 4.0, 7, "#8d5b42", "barracks"),
        box(-8, 2.4, 8, 7, 4.8, 7, "#6f7784", "clancastle"), box(8, 2.4, -8, 7, 4.8, 7, "#6f7784", "clancastle"),
        box(-24, 2.1, 14, 5, 4.2, 5, "#6f4b8e", "wizardtower"), box(24, 2.1, -14, 5, 4.2, 5, "#6f4b8e", "wizardtower"),
        box(0, 0.15, -16, 8, 0.3, 20, "#c4b49b", "path"), box(-16, 0.15, 0, 20, 0.3, 8, "#c4b49b", "path"),
        box(16, 0.15, 0, 20, 0.3, 8, "#c4b49b", "path"), box(0, 0.15, 16, 8, 0.3, 20, "#c4b49b", "path"),
    ]
    return {
        "id": "clan", "name": "Clash of Clans", "short": "Clans", "theme": "clan",
        "description": "A brighter 3D village raid map with compartment walls, a central town hall, storages and defenses.",
        "boxes": boxes,
        "spawns": [(-39, 0, -39), (39, 0, 39), (-39, 0, 39), (39, 0, -39), (-34, 0, 8), (34, 0, -8), (-8, 0, -34), (8, 0, 34)],
        "hardpoints": [(0, 0, 0), (-16, 0, -16), (16, 0, 16), (0, 0, 28)],
        "bounds": [-200000, 200000, -200000, 200000], "ground": "#90cf67", "sky": "#8fd4ff", "fog": "#ccecff",
        "build": False, "day_night": False, "mobs": False, "infinite": True,
    }


WORLDS = {w["id"]: w for w in (classic_world(), voxel_world(), stadium_world(), battle_world(), clan_world())}
WORLD_ORDER = ["classic", "voxel", "stadium", "battle", "clan"]
MODES = {"FFA", "TDM", "HARDPOINT"}
MAX_PLAYERS_PER_ROOM = int(os.getenv("MAX_PLAYERS_PER_ROOM", "16"))
BLOCK_TYPES = {"dirt", "stone", "wood", "glass", "redstone", "lamp", "lever"}
BLOCK_COLORS = {
    "grass": "#6fb24c", "dirt": "#8a5a32", "stone": "#777777", "wood": "#9b6b3f", "glass": "#9ed7e5",
    "redstone": "#8f1d1d", "lamp": "#d7a632", "lever": "#74604b",
}
VOXEL_GRID = 2
VOXEL_CHUNK_CELLS = 8
VOXEL_CHUNK_RADIUS = 1
VOXEL_MIN_Y = -15
VOXEL_MAX_Y = 31


def uid(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def norm(v):
    x, y, z = v
    m = math.sqrt(x * x + y * y + z * z) or 1.0
    return (x / m, y / m, z / m)


def ray_sphere(origin, direction, center, radius):
    ox, oy, oz = origin
    dx, dy, dz = direction
    cx, cy, cz = center
    lx, ly, lz = cx - ox, cy - oy, cz - oz
    tca = lx * dx + ly * dy + lz * dz
    if tca < 0:
        return None
    d2 = lx * lx + ly * ly + lz * lz - tca * tca
    r2 = radius * radius
    if d2 > r2:
        return None
    thc = math.sqrt(max(0.0, r2 - d2))
    t0 = tca - thc
    return t0 if t0 >= 0 else tca + thc


def ray_aabb(origin, direction, b):
    mins = (b["x"] - b["w"] / 2, b["y"] - b["h"] / 2, b["z"] - b["d"] / 2)
    maxs = (b["x"] + b["w"] / 2, b["y"] + b["h"] / 2, b["z"] + b["d"] / 2)
    tmin, tmax = -1e9, 1e9
    for i in range(3):
        o, d = origin[i], direction[i]
        if abs(d) < 1e-8:
            if o < mins[i] or o > maxs[i]:
                return None
            continue
        t1, t2 = (mins[i] - o) / d, (maxs[i] - o) / d
        if t1 > t2:
            t1, t2 = t2, t1
        tmin, tmax = max(tmin, t1), min(tmax, t2)
        if tmin > tmax:
            return None
    if tmax < 0:
        return None
    return tmin if tmin >= 0 else tmax


def safe_name(raw: str) -> str:
    raw = re.sub(r"[^A-Za-z0-9 _\-\.]+", "", raw or "")
    return (raw.strip() or f"Guest_{random.randint(10, 999)}")[:18]


def grid_round(v: float, grid: int = 2) -> int:
    return int(round(v / grid) * grid)


def chunk_coord(v: float, span: int) -> int:
    return math.floor(v / span)


@dataclass
class Block:
    key: str
    x: int
    y: int
    z: int
    type: str
    owner: str = "world"
    powered: bool = False

    def public(self):
        return asdict(self)

    def box(self):
        return box(self.x, self.y, self.z, 2, 2, 2, BLOCK_COLORS.get(self.type, "#777"), self.type, True)


@dataclass
class Mob:
    id: str
    kind: str
    x: float
    y: float
    z: float
    hp: int
    alive: bool = True
    respawn_at: float = 0.0
    attack_at: float = 0.0

    def public(self):
        return asdict(self)


@dataclass
class Player:
    id: str
    name: str
    klass: str
    team: str
    x: float
    y: float
    z: float
    yaw: float = 0
    pitch: float = 0
    vx: float = 0
    vy: float = 0
    vz: float = 0
    hp: int = 100
    alive: bool = True
    score: int = 0
    kills: int = 0
    deaths: int = 0
    streak: int = 0
    last_fire: float = 0.0
    last_edit: float = 0.0
    last_chat: float = 0.0
    respawn_at: float = 0.0

    def public(self):
        d = asdict(self)
        d.pop("last_fire", None)
        d.pop("last_edit", None)
        d.pop("last_chat", None)
        return d


@dataclass
class Room:
    code: str
    mode: str = "FFA"
    world: str = "classic"
    players: Dict[str, Player] = field(default_factory=dict)
    sockets: Dict[str, WebSocket] = field(default_factory=dict)
    blocks: Dict[str, Block] = field(default_factory=dict)
    mobs: Dict[str, Mob] = field(default_factory=dict)
    generated_chunks: set = field(default_factory=set)
    started_at: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)
    match_length: float = 240.0
    team_scores: Dict[str, int] = field(default_factory=lambda: {"Alpha": 0, "Bravo": 0})
    hardpoint_index: int = 0
    hardpoint_changed_at: float = field(default_factory=time.time)
    hardpoint_score_tick: float = field(default_factory=time.time)
    task: Optional[asyncio.Task] = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def __post_init__(self):
        if self.world == "voxel" and not self.blocks:
            self.seed_voxel_world()
            self.seed_mobs()

    @property
    def world_cfg(self):
        return WORLDS[self.world]

    @property
    def remaining(self):
        return max(0.0, self.match_length - (time.time() - self.started_at))

    @property
    def world_time(self):
        # 120-second day/night cycle. 0 = sunrise, .5 = sunset.
        return ((time.time() - self.created_at) % 120.0) / 120.0

    def seed_voxel_world(self):
        self.ensure_voxel_area(0, 0, VOXEL_CHUNK_RADIUS)
        self.seed_redstone_demo()

    def column_surface_y(self, x: int, z: int) -> int:
        ys = [b.y for b in self.blocks.values() if b.x == x and b.z == z]
        return max(ys) if ys else -1

    def seed_redstone_demo(self):
        base_y = self.column_surface_y(-6, 8)
        demo_y = max(1, base_y + 2)
        for x in (-6, -4, -2, 0, 2, 4):
            self.blocks.pop(f"{x}:{demo_y}:{8}", None)
        for x in (-4, -2, 0, 2):
            self.add_block(x, demo_y, 8, "redstone", "world")
        self.add_block(-6, demo_y, 8, "lever", "world")
        self.add_block(4, demo_y, 8, "lamp", "world")

    def ensure_voxel_area(self, x: float, z: float, radius: int = VOXEL_CHUNK_RADIUS):
        span = VOXEL_CHUNK_CELLS * VOXEL_GRID
        cx = chunk_coord(x, span)
        cz = chunk_coord(z, span)
        created = False
        for dx in range(-radius, radius + 1):
            for dz in range(-radius, radius + 1):
                key = (cx + dx, cz + dz)
                if key not in self.generated_chunks:
                    self.generate_voxel_chunk(*key)
                    self.generated_chunks.add(key)
                    created = True
        return created

    def voxel_surface_spawn(self, sx: int, sz: int, search_radius: int = 3):
        self.ensure_voxel_area(sx, sz, VOXEL_CHUNK_RADIUS)
        best = None
        for dz in range(-search_radius, search_radius + 1):
            for dx in range(-search_radius, search_radius + 1):
                x = grid_round(sx + dx * VOXEL_GRID, VOXEL_GRID)
                z = grid_round(sz + dz * VOXEL_GRID, VOXEL_GRID)
                col = [b for b in self.blocks.values() if b.x == x and b.z == z and b.type != "lever"]
                if not col:
                    continue
                top = max(col, key=lambda b: b.y)
                top_surface = top.y + 1
                penalty = abs(dx) + abs(dz)
                score = top_surface - penalty * 0.35
                if best is None or score > best[0]:
                    best = (score, x, top_surface, z)
        if best is None:
            return sx, 10, sz
        return best[1], best[2], best[3]

    def generate_voxel_chunk(self, cx: int, cz: int):
        for lx in range(VOXEL_CHUNK_CELLS):
            for lz in range(VOXEL_CHUNK_CELLS):
                wx = (cx * VOXEL_CHUNK_CELLS + lx) * VOXEL_GRID
                wz = (cz * VOXEL_CHUNK_CELLS + lz) * VOXEL_GRID
                n = (
                    math.sin((wx + 11) * 0.11)
                    + math.cos((wz - 7) * 0.10)
                    + 0.7 * math.sin((wx + wz) * 0.045)
                    + 0.35 * math.cos((wx - wz) * 0.06)
                )
                layers = int(clamp(round(4 + n * 1.3), 2, 7))
                bottom_index = -4
                for idx in range(bottom_index, layers):
                    y = 1 + idx * 2
                    cave_score = math.sin(wx * 0.18 + y * 0.55) + math.cos(wz * 0.22 - y * 0.41)
                    if idx < layers - 1 and idx > bottom_index and cave_score > 1.1:
                        continue
                    key = f"{wx}:{y}:{wz}"
                    if key in self.blocks:
                        continue
                    typ = "stone" if idx < layers - 2 else "dirt"
                    if idx == layers - 1:
                        typ = "grass"
                    self.blocks[key] = Block(key, wx, y, wz, typ, "world")
                spawn_clear = any(abs(wx - sp[0]) <= 4 and abs(wz - sp[2]) <= 4 for sp in self.world_cfg["spawns"]) or (abs(wx) <= 8 and abs(wz) <= 8)
                if spawn_clear:
                    for y in range(7, 15, 2):
                        self.blocks.pop(f"{wx}:{y}:{wz}", None)
                tree_score = math.sin(wx * 0.27) + math.cos(wz * 0.23)
                if layers >= 4 and not spawn_clear and abs(wx) + abs(wz) > 8 and tree_score > 1.25:
                    top = 1 + (layers - 1) * 2
                    for oy in (2, 4, 6):
                        self.add_block(wx, top + oy, wz, "wood", "world")
                    leaf_y = top + 8
                    for dx2 in (-2, 0, 2):
                        for dz2 in (-2, 0, 2):
                            if abs(dx2) + abs(dz2) <= 2:
                                self.add_block(wx + dx2, leaf_y, wz + dz2, "grass", "world")
                    self.add_block(wx, leaf_y + 2, wz, "grass", "world")

    def seed_mobs(self):
        for kind, pos in [
            ("Zombie", (-20, 0, 8)), ("Zombie", (18, 0, -8)),
            ("Slime", (-8, 0, -18)), ("Slime", (12, 0, 20)),
        ]:
            hp = 80 if kind == "Zombie" else 55
            m = Mob(uid(6), kind, pos[0], pos[1], pos[2], hp)
            self.mobs[m.id] = m

    def add_block(self, x: int, y: int, z: int, typ: str, owner: str):
        key = f"{x}:{y}:{z}"
        self.blocks[key] = Block(key, x, y, z, typ, owner)
        return self.blocks[key]

    def all_collision_boxes(self) -> Iterable[dict]:
        yield from self.world_cfg["boxes"]
        for b in self.blocks.values():
            yield b.box()

    def reset_match(self):
        self.started_at = time.time()
        self.team_scores = {"Alpha": 0, "Bravo": 0}
        self.hardpoint_index = (self.hardpoint_index + 1) % len(self.world_cfg["hardpoints"])
        self.hardpoint_changed_at = time.time()
        for p in self.players.values():
            p.score = p.kills = p.deaths = p.streak = 0
            self.spawn(p)

    def spawn(self, p: Player):
        candidates = list(self.world_cfg["spawns"])
        random.shuffle(candidates)

        def min_enemy_dist(sp):
            ds = []
            for q in self.players.values():
                if q.id != p.id and q.alive and (self.mode == "FFA" or q.team != p.team):
                    ds.append((q.x - sp[0]) ** 2 + (q.z - sp[2]) ** 2)
            return min(ds) if ds else 99999

        sx, sy, sz = max(candidates, key=min_enemy_dist)
        if self.world == "voxel":
            sx, sy, sz = self.voxel_surface_spawn(int(sx), int(sz))
            sy = max(sy, 10)
        p.x, p.y, p.z = sx, sy, sz
        p.vx = p.vy = p.vz = 0
        p.hp = CLASSES[p.klass]["hp"]
        p.alive = True
        p.respawn_at = 0

    async def emit(self, payload, only: Optional[str] = None):
        dead = []
        for pid, ws in list(self.sockets.items()):
            if only is not None and pid != only:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(pid)
        for pid in dead:
            self.sockets.pop(pid, None)

    async def emit_blocks(self):
        await self.emit({"t": "blocks", "blocks": [b.public() for b in self.blocks.values()]})

    def recompute_power(self):
        # Simple grid circuit: powered lever spreads through touching redstone blocks;
        # a touching lamp becomes powered. This is intentionally lightweight rather
        # than a full electrical simulator.
        for b in self.blocks.values():
            if b.type in {"redstone", "lamp"}:
                b.powered = False
        frontier = [b for b in self.blocks.values() if b.type == "lever" and b.powered]
        seen = {b.key for b in frontier}
        while frontier:
            cur = frontier.pop(0)
            for other in self.blocks.values():
                if other.key in seen or other.type not in {"redstone", "lamp"}:
                    continue
                dist = abs(other.x - cur.x) + abs(other.y - cur.y) + abs(other.z - cur.z)
                if dist <= 2.1:
                    other.powered = True
                    seen.add(other.key)
                    if other.type == "redstone":
                        frontier.append(other)

    def nearest_alive_player(self, mob: Mob):
        alive = [p for p in self.players.values() if p.alive]
        if not alive:
            return None
        return min(alive, key=lambda p: (p.x - mob.x) ** 2 + (p.z - mob.z) ** 2)

    def respawn_mob(self, mob: Mob):
        sx, sy, sz = random.choice(self.world_cfg["spawns"])
        mob.x, mob.y, mob.z = sx * .7, sy, sz * .7
        mob.hp = 80 if mob.kind == "Zombie" else 55
        mob.alive = True
        mob.respawn_at = 0

    async def tick_mobs(self, dt: float, now: float):
        if self.world != "voxel":
            return
        night = .48 < self.world_time < .94
        # At night the hostile mobs are faster; during day they still exist as
        # gameplay targets but move more slowly.
        for m in self.mobs.values():
            if not m.alive:
                if now >= m.respawn_at:
                    self.respawn_mob(m)
                continue
            p = self.nearest_alive_player(m)
            if not p:
                continue
            dx, dz = p.x - m.x, p.z - m.z
            dist = math.hypot(dx, dz) or 1.0
            speed = (2.0 if m.kind == "Zombie" else 1.4) * (1.25 if night else .72)
            if dist > 1.25:
                m.x += dx / dist * speed * dt
                m.z += dz / dist * speed * dt
            elif now >= m.attack_at:
                m.attack_at = now + (1.0 if m.kind == "Zombie" else 1.4)
                p.hp -= 12 if m.kind == "Zombie" else 8
                await self.emit({"t": "mob_attack", "mob": m.kind, "victim": p.id, "hp": max(0, p.hp)})
                if p.hp <= 0:
                    p.hp = 0
                    p.alive = False
                    p.deaths += 1
                    p.streak = 0
                    p.respawn_at = now + 1.35
                    await self.emit({"t": "kill", "killer": m.kind, "killer_id": "mob", "victim": p.name, "victim_id": p.id, "weapon": "Mob", "streak": 0})

    async def loop(self):
        last = time.time()
        while self.sockets:
            now = time.time()
            dt = min(0.1, now - last)
            last = now
            if self.remaining <= 0:
                winners = sorted(self.players.values(), key=lambda p: p.score, reverse=True)[:3]
                await self.emit({"t": "match_end", "winners": [{"name": p.name, "score": p.score} for p in winners]})
                self.reset_match()
                for pid, p in list(self.players.items()):
                    await self.emit({"t": "respawn", "player": p.public()}, only=pid)
            if self.mode == "HARDPOINT":
                if now - self.hardpoint_changed_at >= 40:
                    self.hardpoint_index = (self.hardpoint_index + 1) % len(self.world_cfg["hardpoints"])
                    self.hardpoint_changed_at = now
                    await self.emit({"t": "hardpoint", "index": self.hardpoint_index})
                hx, _, hz = self.world_cfg["hardpoints"][self.hardpoint_index]
                counts = {"Alpha": 0, "Bravo": 0}
                for p in self.players.values():
                    if p.alive and (p.x - hx) ** 2 + (p.z - hz) ** 2 <= 36:
                        counts[p.team] += 1
                if counts["Alpha"] != counts["Bravo"] and now - self.hardpoint_score_tick >= 1.0:
                    leader = "Alpha" if counts["Alpha"] > counts["Bravo"] else "Bravo"
                    self.team_scores[leader] += 1
                    self.hardpoint_score_tick = now
            await self.tick_mobs(dt, now)
            snap = {
                "t": "snapshot", "mode": self.mode, "world": self.world, "remaining": self.remaining,
                "players": [p.public() for p in self.players.values()], "team_scores": self.team_scores,
                "hardpoint": self.hardpoint_index, "world_time": self.world_time,
                "mobs": [m.public() for m in self.mobs.values()] if self.world == "voxel" else [],
            }
            await self.emit(snap)
            await asyncio.sleep(0.05)


rooms: Dict[Tuple[str, str], Room] = {}


def choose_team(room: Room):
    a = sum(1 for p in room.players.values() if p.team == "Alpha")
    b = sum(1 for p in room.players.values() if p.team == "Bravo")
    return "Alpha" if a <= b else "Bravo"


def get_room(code: str, mode: str = "FFA", world: str = "classic"):
    code = re.sub(r"[^A-Za-z0-9_-]", "", code or "PUBLIC").upper()[:12] or "PUBLIC"
    world = world if world in WORLDS else "classic"
    key = (code, world)
    if key not in rooms:
        room_mode = mode if mode in MODES else "FFA"
        rooms[key] = Room(code=code, mode=room_mode, world=world)
    return rooms[key]


def public_worlds():
    result = {}
    for wid in WORLD_ORDER:
        w = WORLDS[wid]
        result[wid] = {k: v for k, v in w.items() if k not in {}}
    return result


def ad_config():
    return {
        "enabled": os.getenv("ADS_ENABLED", "0") == "1",
        "provider": os.getenv("ADS_PROVIDER", "placeholder").lower(),
        "adsense_client": os.getenv("ADSENSE_CLIENT", ""),
        "menu_slot": os.getenv("ADSENSE_MENU_SLOT", ""),
        "break_slot": os.getenv("ADSENSE_BREAK_SLOT", ""),
    }


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/privacy")
async def privacy():
    return FileResponse(STATIC / "privacy.html")


@app.get("/terms")
async def terms():
    return FileResponse(STATIC / "terms.html")


@app.get("/health")
async def health():
    return {
        "ok": True,
        "version": "2.1.0",
        "rooms": len(rooms),
        "players": sum(len(r.players) for r in rooms.values()),
    }


@app.get("/api/config")
async def config():
    return JSONResponse({"classes": CLASSES, "worlds": public_worlds(), "world_order": WORLD_ORDER, "modes": sorted(MODES)})


@app.get("/api/site-config")
async def site_config():
    return JSONResponse({"ads": ad_config(), "version": "2.1.0", "brand": "Blockfront Worlds"})


@app.get("/api/rooms")
async def room_browser():
    listed = []
    for room in rooms.values():
        if room.players:
            listed.append({
                "code": room.code,
                "world": room.world,
                "world_name": room.world_cfg["name"],
                "mode": room.mode,
                "players": len(room.players),
                "remaining": round(room.remaining),
            })
    listed.sort(key=lambda x: (-x["players"], x["world"], x["code"]))
    return JSONResponse({"rooms": listed[:50]})


@app.websocket("/ws/{room_code}")
async def websocket_endpoint(ws: WebSocket, room_code: str):
    await ws.accept()
    qp = ws.query_params
    name = safe_name(qp.get("name") or "")
    klass = qp.get("klass") or "Triggerman"
    if klass not in CLASSES:
        klass = "Triggerman"
    mode = (qp.get("mode") or "FFA").upper()
    world = (qp.get("world") or "classic").lower()
    room = get_room(room_code, mode, world)
    if len(room.players) >= MAX_PLAYERS_PER_ROOM:
        await ws.send_json({"t": "error", "message": "This room is full."})
        await ws.close(code=1008)
        return
    pid = uid()
    team = choose_team(room) if room.mode != "FFA" else "Solo"
    sx, sy, sz = random.choice(room.world_cfg["spawns"])
    p = Player(pid, name, klass, team, sx, sy, sz, hp=CLASSES[klass]["hp"])
    room.players[pid] = p
    room.sockets[pid] = ws
    room.spawn(p)
    # Make the first frame deterministic for clients: welcome always arrives
    # before snapshots/events from the room loop.
    await ws.send_json({
        "t": "welcome", "id": pid, "room": room.code, "mode": room.mode, "world": room.world,
        "player": p.public(), "hardpoint": room.hardpoint_index,
        "blocks": [b.public() for b in room.blocks.values()] if room.world == "voxel" else [],
    })
    if room.task is None or room.task.done():
        room.task = asyncio.create_task(room.loop())
    await room.emit({"t": "event", "kind": "join", "text": f"{name} joined {room.world_cfg['name']}"})

    try:
        while True:
            msg = await ws.receive_json()
            t = msg.get("t")
            if t == "state" and p.alive:
                nx, ny, nz = float(msg.get("x", p.x)), float(msg.get("y", p.y)), float(msg.get("z", p.z))
                dx, dz = nx - p.x, nz - p.z
                generated = False
                if math.hypot(dx, dz) <= 4.5:
                    minx, maxx, minz, maxz = room.world_cfg["bounds"]
                    p.x, p.z = clamp(nx, minx, maxx), clamp(nz, minz, maxz)
                    if room.world == "voxel":
                        p.y = clamp(ny, VOXEL_MIN_Y, 40)
                        generated = room.ensure_voxel_area(p.x, p.z, VOXEL_CHUNK_RADIUS)
                    else:
                        p.y = clamp(ny, 0, 24)
                if generated:
                    await room.emit_blocks()
                p.yaw = float(msg.get("yaw", p.yaw))
                p.pitch = clamp(float(msg.get("pitch", p.pitch)), -1.55, 1.55)
                p.vx = clamp(float(msg.get("vx", 0)), -30, 30)
                p.vy = clamp(float(msg.get("vy", 0)), -30, 30)
                p.vz = clamp(float(msg.get("vz", 0)), -30, 30)

            elif t == "class":
                k = msg.get("klass")
                if k in CLASSES:
                    p.klass = k
                    room.spawn(p)
                    await ws.send_json({"t": "respawn", "player": p.public()})
                    await room.emit({"t": "event", "kind": "class", "text": f"{p.name} switched to {k}"})

            elif t == "respawn":
                if not p.alive and time.time() >= p.respawn_at:
                    room.spawn(p)
                    await ws.send_json({"t": "respawn", "player": p.public()})

            elif t == "chat":
                now = time.time()
                if now - p.last_chat < 0.45:
                    continue
                p.last_chat = now
                text = re.sub(r"[\x00-\x1f\x7f]", "", str(msg.get("text", "")))[:120].strip()
                if text:
                    await room.emit({"t": "chat", "name": p.name, "text": text})

            elif t == "block_break" and p.alive and room.world == "voxel":
                now = time.time()
                if now - p.last_edit < .12:
                    continue
                p.last_edit = now
                key = str(msg.get("key", ""))
                b = room.blocks.get(key)
                if not b:
                    continue
                if math.dist((p.x, p.y + 1.2, p.z), (b.x, b.y, b.z)) > 7.0:
                    continue
                # Protect the demo lever/lamp circuit from being instantly erased
                # only if it was seeded by the world; every other block is mineable.
                room.blocks.pop(key, None)
                room.recompute_power()
                p.score += 5
                await room.emit_blocks()

            elif t == "block_place" and p.alive and room.world == "voxel":
                now = time.time()
                if now - p.last_edit < .12:
                    continue
                p.last_edit = now
                typ = str(msg.get("type", "dirt")).lower()
                if typ not in BLOCK_TYPES:
                    continue
                raw_pos = [float(v) for v in msg.get("pos", [0, 1, 0])[:3]]
                x = grid_round(raw_pos[0], 2)
                z = grid_round(raw_pos[2], 2)
                # Voxel block centers sit at y=1,3,5,... so a cube rests flush
                # on the ground or on the cube below it.
                y = int(round((raw_pos[1] - 1) / 2) * 2 + 1)
                y = int(clamp(y, VOXEL_MIN_Y, VOXEL_MAX_Y))
                room.ensure_voxel_area(x, z, VOXEL_CHUNK_RADIUS)
                if math.dist((p.x, p.y + 1.2, p.z), (x, y, z)) > 7.2:
                    continue
                key = f"{x}:{y}:{z}"
                if key in room.blocks or len(room.blocks) >= 12000:
                    continue
                # Avoid trapping a player inside a new cube.
                if any(abs(q.x - x) < 1.25 and abs((q.y + .9) - y) < 1.7 and abs(q.z - z) < 1.25 for q in room.players.values() if q.alive):
                    continue
                room.add_block(x, y, z, typ, p.id)
                room.recompute_power()
                await room.emit_blocks()

            elif t == "block_use" and p.alive and room.world == "voxel":
                key = str(msg.get("key", ""))
                b = room.blocks.get(key)
                if b and b.type == "lever" and math.dist((p.x, p.y + 1.2, p.z), (b.x, b.y, b.z)) <= 6.0:
                    b.powered = not b.powered
                    room.recompute_power()
                    await room.emit_blocks()

            elif t == "fire" and p.alive:
                cfg = CLASSES[p.klass]
                now = time.time()
                min_interval = 60.0 / cfg["rpm"]
                if now - p.last_fire < min_interval * 0.72:
                    continue
                p.last_fire = now
                origin = tuple(float(v) for v in msg.get("o", [p.x, p.y + 1.4, p.z])[:3])
                direction = norm(tuple(float(v) for v in msg.get("d", [0, 0, -1])[:3]))
                if math.dist(origin, (p.x, p.y + 1.4, p.z)) > 3.0:
                    continue
                pellets = int(cfg.get("pellets", 1))
                player_hits: Dict[str, int] = {}
                mob_hits: Dict[str, int] = {}
                for _ in range(pellets):
                    d = direction
                    if pellets > 1:
                        spread = cfg["spread"]
                        d = norm((direction[0] + random.uniform(-spread, spread), direction[1] + random.uniform(-spread, spread), direction[2] + random.uniform(-spread, spread)))
                    wall_t = cfg["range"]
                    for b in room.all_collision_boxes():
                        wt = ray_aabb(origin, d, b)
                        if wt is not None and wt < wall_t:
                            wall_t = wt
                    best = None
                    for q in room.players.values():
                        if q.id == p.id or not q.alive:
                            continue
                        if room.mode != "FFA" and q.team == p.team:
                            continue
                        for ht, is_head in [
                            (ray_sphere(origin, d, (q.x, q.y + .9, q.z), .56), False),
                            (ray_sphere(origin, d, (q.x, q.y + 1.55, q.z), .35), True),
                        ]:
                            if ht is not None and ht <= wall_t and ht <= cfg["range"] and (best is None or ht < best[0]):
                                best = (ht, "player", q, is_head)
                    if room.world == "voxel":
                        for m in room.mobs.values():
                            if not m.alive:
                                continue
                            mt = ray_sphere(origin, d, (m.x, m.y + .8, m.z), .65)
                            if mt is not None and mt <= wall_t and mt <= cfg["range"] and (best is None or mt < best[0]):
                                best = (mt, "mob", m, False)
                    if best:
                        distance, kind, target, is_head = best
                        damage = cfg["damage"] * (1.5 if is_head else 1.0)
                        if cfg["range"] > 25 and distance > cfg["range"] * .60 and p.klass not in {"Hunter", "Detective", "Marksman"}:
                            damage *= .78
                        amount = int(round(damage))
                        if kind == "player":
                            player_hits[target.id] = player_hits.get(target.id, 0) + amount
                        else:
                            mob_hits[target.id] = mob_hits.get(target.id, 0) + amount
                for qid, damage in player_hits.items():
                    q = room.players.get(qid)
                    if not q or not q.alive:
                        continue
                    q.hp -= damage
                    await room.emit({"t": "hit", "attacker": p.id, "victim": q.id, "damage": damage, "hp": max(0, q.hp)}, only=p.id)
                    if q.hp <= 0:
                        q.hp = 0
                        q.alive = False
                        q.deaths += 1
                        q.streak = 0
                        q.respawn_at = time.time() + 1.35
                        p.kills += 1
                        p.streak += 1
                        p.score += 100
                        if room.mode != "FFA":
                            room.team_scores[p.team] += 1
                        await room.emit({"t": "kill", "killer": p.name, "killer_id": p.id, "victim": q.name, "victim_id": q.id, "weapon": cfg["weapon"], "streak": p.streak})
                for mid, damage in mob_hits.items():
                    m = room.mobs.get(mid)
                    if not m or not m.alive:
                        continue
                    m.hp -= damage
                    await room.emit({"t": "mob_hit", "attacker": p.id, "mob": m.id, "damage": damage}, only=p.id)
                    if m.hp <= 0:
                        m.alive = False
                        m.respawn_at = time.time() + 12.0
                        p.score += 25
                        await room.emit({"t": "mob_kill", "killer": p.name, "kind": m.kind})

            elif t == "melee" and p.alive:
                now = time.time()
                if now - p.last_fire < .35:
                    continue
                p.last_fire = now
                best = None
                for q in room.players.values():
                    if q.id == p.id or not q.alive:
                        continue
                    if room.mode != "FFA" and q.team == p.team:
                        continue
                    d = math.dist((p.x, p.y, p.z), (q.x, q.y, q.z))
                    if d <= 2.5 and (best is None or d < best[0]):
                        best = (d, "player", q)
                if room.world == "voxel":
                    for m in room.mobs.values():
                        if not m.alive:
                            continue
                        d = math.dist((p.x, p.y, p.z), (m.x, m.y, m.z))
                        if d <= 2.7 and (best is None or d < best[0]):
                            best = (d, "mob", m)
                if best:
                    _, kind, target = best
                    damage = 100 if p.klass == "Runner" else 55
                    if kind == "player":
                        target.hp -= damage
                        if target.hp <= 0:
                            target.hp = 0
                            target.alive = False
                            target.deaths += 1
                            target.respawn_at = time.time() + 1.35
                            p.kills += 1
                            p.streak += 1
                            p.score += 100
                            weapon = "Block Sword" if room.world == "voxel" else "Blade"
                            await room.emit({"t": "kill", "killer": p.name, "killer_id": p.id, "victim": target.name, "victim_id": target.id, "weapon": weapon, "streak": p.streak})
                    else:
                        target.hp -= damage
                        if target.hp <= 0:
                            target.alive = False
                            target.respawn_at = time.time() + 12.0
                            p.score += 25
                            await room.emit({"t": "mob_kill", "killer": p.name, "kind": target.kind})

    except WebSocketDisconnect:
        pass
    except Exception:
        # Keep one malformed/disconnected client from crashing the room task,
        # but retain a traceback in host logs for debugging.
        logger.exception("WebSocket client error in room=%s world=%s player=%s", room.code, room.world, name)
    finally:
        room.sockets.pop(pid, None)
        room.players.pop(pid, None)
        await room.emit({"t": "event", "kind": "leave", "text": f"{name} left"})
        if not room.sockets:
            await asyncio.sleep(.05)
            if not room.sockets:
                rooms.pop((room.code, room.world), None)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
