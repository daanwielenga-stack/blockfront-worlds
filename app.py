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

app = FastAPI(title="Blockfront Worlds", version="3.2.0")
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

# Player-selectable guns. Classes now control movement/health while the gun can be
# chosen independently from the loadout menu.
WEAPONS = {
    "Assault Rifle": {"damage": 27, "rpm": 650, "mag": 30, "reload": 1.35, "spread": 0.006, "range": 85, "head_multiplier": 1.5, "color": "#f2c14e"},
    "Sniper Rifle": {"damage": 105, "rpm": 55, "mag": 3, "reload": 1.65, "spread": 0.0015, "range": 150, "head_multiplier": 1.5, "color": "#9b8cff"},
    "Shotgun": {"damage": 16, "rpm": 115, "mag": 5, "reload": 1.70, "spread": 0.065, "range": 24, "pellets": 7, "head_multiplier": 1.25, "color": "#ff7b54"},
    "Machine Gun": {"damage": 22, "rpm": 720, "mag": 60, "reload": 2.20, "spread": 0.013, "range": 82, "head_multiplier": 1.4, "color": "#ef476f"},
    "Milan Gun": {"damage": 0, "rpm": 170, "mag": 12, "reload": 1.10, "spread": 0.010, "range": 55, "head_multiplier": 1.0, "nonlethal": True, "color": "#67d7ff"},
}
DEFAULT_WEAPON = "Assault Rifle"



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
        box(-23, 5, -18, 14, 10, 18, "#59636f", "building"),
        box(23, 5.5, 20, 17, 11, 17, "#62606d", "building"),
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
        "biomes": ["plains", "forest", "taiga", "snowy_plains", "desert", "savanna", "jungle", "swamp", "badlands", "meadow", "mountains"],
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


CLAN_WALL_COUNTS = {
    1: 0, 2: 25, 3: 50, 4: 75, 5: 100, 6: 125, 7: 175, 8: 225, 9: 250,
    10: 275, 11: 300, 12: 300, 13: 300, 14: 325, 15: 325, 16: 325, 17: 325,
}

# Copy counts of permanent Home Village defensive structures by Town Hall.
# Counts intentionally reflect merged defenses at TH16/TH17 (for example,
# some Cannons/Archer Towers are consumed by Ricochet/Multi-Archer merges).
CLAN_DEFENSE_COUNTS = {
    1:  {"cannon": 1},
    2:  {"cannon": 2, "archer": 1},
    3:  {"cannon": 2, "archer": 1, "mortar": 1},
    4:  {"cannon": 2, "archer": 2, "mortar": 1, "air": 1},
    5:  {"cannon": 3, "archer": 3, "mortar": 1, "air": 1, "wizard": 1},
    6:  {"cannon": 3, "archer": 3, "mortar": 2, "air": 2, "wizard": 2, "sweeper": 1},
    7:  {"cannon": 5, "archer": 4, "mortar": 3, "air": 3, "wizard": 2, "sweeper": 1, "tesla": 2},
    8:  {"cannon": 5, "archer": 5, "mortar": 4, "air": 3, "wizard": 3, "sweeper": 1, "tesla": 3, "bomb": 1},
    9:  {"cannon": 5, "archer": 6, "mortar": 4, "air": 4, "wizard": 4, "sweeper": 2, "tesla": 4, "bomb": 1, "xbow": 2},
    10: {"cannon": 6, "archer": 7, "mortar": 4, "air": 4, "wizard": 4, "sweeper": 2, "tesla": 4, "bomb": 2, "xbow": 3, "inferno": 2},
    11: {"cannon": 7, "archer": 8, "mortar": 4, "air": 4, "wizard": 5, "sweeper": 2, "tesla": 4, "bomb": 2, "xbow": 4, "inferno": 2, "eagle": 1},
    12: {"cannon": 7, "archer": 8, "mortar": 4, "air": 4, "wizard": 5, "sweeper": 2, "tesla": 5, "bomb": 2, "xbow": 4, "inferno": 3, "eagle": 1},
    13: {"cannon": 7, "archer": 8, "mortar": 4, "air": 4, "wizard": 5, "sweeper": 2, "tesla": 5, "bomb": 2, "xbow": 4, "inferno": 3, "eagle": 1, "scatter": 2},
    14: {"cannon": 7, "archer": 8, "mortar": 4, "air": 4, "wizard": 5, "sweeper": 2, "tesla": 5, "bomb": 2, "xbow": 4, "inferno": 3, "eagle": 1, "scatter": 2, "builder": 5},
    15: {"cannon": 7, "archer": 8, "mortar": 4, "air": 4, "wizard": 5, "sweeper": 2, "tesla": 5, "bomb": 2, "xbow": 4, "inferno": 3, "eagle": 1, "scatter": 2, "builder": 5, "spell": 2, "monolith": 1},
    16: {"cannon": 3, "archer": 4, "mortar": 4, "air": 4, "wizard": 5, "sweeper": 2, "tesla": 5, "bomb": 2, "xbow": 4, "inferno": 3, "eagle": 1, "scatter": 2, "builder": 5, "spell": 2, "monolith": 1, "multiarcher": 2, "ricochet": 2},
    17: {"archer": 2, "mortar": 4, "air": 4, "wizard": 5, "sweeper": 2, "tesla": 5, "bomb": 2, "xbow": 4, "inferno": 3, "scatter": 2, "builder": 5, "spell": 2, "monolith": 1, "multiarcher": 3, "ricochet": 3, "multigear": 1, "firespitter": 2, "infernoartillery": 1},
}


def clan_world():
    # Compact scattered cluster: each village is still distinct, but neighbouring
    # Town Halls are now close enough to feel like one continuous Clash landscape.
    village_layout = [
        {"th": 1,  "x": 0,    "z": 0},
        {"th": 2,  "x": -42,  "z": -34},
        {"th": 3,  "x": 44,   "z": -32},
        {"th": 4,  "x": -44,  "z": 36},
        {"th": 5,  "x": 46,   "z": 38},
        {"th": 6,  "x": -86,  "z": 0},
        {"th": 7,  "x": 88,   "z": 2},
        {"th": 8,  "x": -2,   "z": -68},
        {"th": 9,  "x": 4,    "z": 72},
        {"th": 10, "x": -84,  "z": 68},
        {"th": 11, "x": 86,   "z": -64},
        {"th": 12, "x": -128, "z": 32},
        {"th": 13, "x": 128,  "z": -28},
        {"th": 14, "x": -44,  "z": 108},
        {"th": 15, "x": 48,   "z": 110},
        {"th": 16, "x": -126, "z": -62},
        {"th": 17, "x": 122,  "z": 86},
    ]

    # Keep server/client collision payload lean: Town Halls get conservative core
    # colliders here. Exact segmented walls and nearby defense colliders are generated
    # client-side only for the currently detailed village, eliminating oversized
    # invisible wall AABBs and reducing per-frame collision work.
    boxes = []
    for village in village_layout:
        th = village["th"]
        cx, cz = village["x"], village["z"]
        hall_w = min(5.6 + th * .10, 7.3)
        hall_h = min(3.5 + th * .12, 5.6)
        boxes.append(box(cx, hall_h / 2, cz, hall_w, hall_h, hall_w, "#a56a40", f"th{th}_townhall"))

    return {
        "id": "clan", "name": "Clash of Clans", "short": "Clans", "theme": "clan",
        "description": "A compact landscape of Town Hall 1–17 villages with level-accurate wall and defense counts.",
        "boxes": boxes,
        "spawns": [(-7, 0, 24), (7, 0, 24), (-11, 0, 18), (11, 0, 18), (-4, 0, 28), (4, 0, 28), (0, 0, 20), (0, 0, 30)],
        "hardpoints": [(0, 0, 0), (-84, 0, 68), (86, 0, -64), (48, 0, 110)],
        "bounds": [-200000, 200000, -200000, 200000], "ground": "#90cf67", "sky": "#8fd4ff", "fog": "#ccecff",
        "build": False, "day_night": False, "mobs": False, "infinite": True,
        "town_hall_count": 17,
        "town_hall_layout": village_layout,
        "wall_counts": CLAN_WALL_COUNTS,
        "defense_counts": CLAN_DEFENSE_COUNTS,
    }

WORLDS = {w["id"]: w for w in (classic_world(), voxel_world(), stadium_world(), battle_world(), clan_world())}
WORLD_ORDER = ["classic", "voxel", "stadium", "battle", "clan"]
MODES = {"FFA", "TDM", "HARDPOINT"}
MAX_PLAYERS_PER_ROOM = int(os.getenv("MAX_PLAYERS_PER_ROOM", "16"))
BLOCK_TYPES = {"dirt", "stone", "wood", "planks", "cobble", "sand", "sandstone", "red_sand", "terracotta", "glass", "redstone", "lamp", "lever", "crafting_table", "furnace", "chest"}
BLOCK_COLORS = {
    "grass": "#6fb24c", "dirt": "#8a5a32", "stone": "#777777", "wood": "#9b6b3f", "glass": "#9ed7e5",
    "redstone": "#8f1d1d", "lamp": "#d7a632", "lever": "#74604b",
    "leaves": "#3f8d35", "spruce": "#60452f", "spruce_leaves": "#315f39", "acacia": "#a85d32", "acacia_leaves": "#6b873a",
    "jungle_wood": "#795634", "jungle_leaves": "#2e8b3f", "sand": "#d9c681", "sandstone": "#c9b26f", "snow": "#f2f6f8",
    "ice": "#91c9e8", "red_sand": "#b75e36", "terracotta": "#a9573b", "podzol": "#72523a", "cobble": "#686868", "planks": "#b58a56",
    "bedrock": "#343434", "deepslate": "#45454a", "coal_ore": "#3b3b3b", "iron_ore": "#8c7568",
    "crafting_table": "#9a6a3b", "furnace": "#676767", "chest": "#9b6b32",
}
VOXEL_GRID = 2
VOXEL_CHUNK_CELLS = 8
VOXEL_CHUNK_RADIUS = 1
VOXEL_STREAM_RADIUS = 44
VOXEL_MIN_Y = -23
VOXEL_MAX_Y = 47
VOXEL_TERRAIN_TYPES = {"grass", "dirt", "stone", "sand", "sandstone", "snow", "red_sand", "terracotta", "podzol", "bedrock", "deepslate", "coal_ore", "iron_ore"}
VILLAGE_BIOMES = {"plains", "savanna", "taiga", "meadow", "snowy_plains", "desert"}


# Lightweight survival inventory/crafting data.  The FPS weapons remain a separate
# Blockfront layer, while the voxel inventory follows Minecraft's familiar progression:
# gather logs -> planks/sticks -> crafting table -> 3x3 tools and utility blocks.
MINECRAFT_ITEMS = {
    "wood": {"label": "Oak Log", "color": "#9a6537", "placeable": True},
    "planks": {"label": "Oak Planks", "color": "#b58a56", "placeable": True},
    "dirt": {"label": "Dirt", "color": "#8a5a32", "placeable": True},
    "cobble": {"label": "Cobblestone", "color": "#686868", "placeable": True},
    "sand": {"label": "Sand", "color": "#d9c681", "placeable": True},
    "sandstone": {"label": "Sandstone", "color": "#c9b26f", "placeable": True},
    "red_sand": {"label": "Red Sand", "color": "#b75e36", "placeable": True},
    "terracotta": {"label": "Terracotta", "color": "#a9573b", "placeable": True},
    "glass": {"label": "Glass", "color": "#9ed7e5", "placeable": True},
    "redstone": {"label": "Redstone", "color": "#8f1d1d", "placeable": True},
    "lamp": {"label": "Redstone Lamp", "color": "#d7a632", "placeable": True},
    "lever": {"label": "Lever", "color": "#74604b", "placeable": True},
    "coal": {"label": "Coal", "color": "#2f2f31", "placeable": False},
    "raw_iron": {"label": "Raw Iron", "color": "#b18470", "placeable": False},
    "sticks": {"label": "Stick", "color": "#a17c52", "placeable": False},
    "crafting_table": {"label": "Crafting Table", "color": "#9a6a3b", "placeable": True},
    "furnace": {"label": "Furnace", "color": "#676767", "placeable": True},
    "chest": {"label": "Chest", "color": "#9b6b32", "placeable": True},
    "wooden_pickaxe": {"label": "Wooden Pickaxe", "color": "#9e7548", "placeable": False, "tool": "pickaxe", "tier": 1},
    "stone_pickaxe": {"label": "Stone Pickaxe", "color": "#777777", "placeable": False, "tool": "pickaxe", "tier": 2},
    "wooden_axe": {"label": "Wooden Axe", "color": "#9e7548", "placeable": False, "tool": "axe", "tier": 1},
    "stone_axe": {"label": "Stone Axe", "color": "#777777", "placeable": False, "tool": "axe", "tier": 2},
    "wooden_shovel": {"label": "Wooden Shovel", "color": "#9e7548", "placeable": False, "tool": "shovel", "tier": 1},
    "stone_shovel": {"label": "Stone Shovel", "color": "#777777", "placeable": False, "tool": "shovel", "tier": 2},
    "wooden_sword": {"label": "Wooden Sword", "color": "#9e7548", "placeable": False, "tool": "sword", "tier": 1},
    "stone_sword": {"label": "Stone Sword", "color": "#777777", "placeable": False, "tool": "sword", "tier": 2},
    "wooden_hoe": {"label": "Wooden Hoe", "color": "#9e7548", "placeable": False, "tool": "hoe", "tier": 1},
    "stone_hoe": {"label": "Stone Hoe", "color": "#777777", "placeable": False, "tool": "hoe", "tier": 2},
    "ladder": {"label": "Ladder", "color": "#b48c5b", "placeable": False},
    "wooden_door": {"label": "Wooden Door", "color": "#a97848", "placeable": False},
    "oak_slab": {"label": "Oak Slab", "color": "#b58a56", "placeable": False},
    "oak_stairs": {"label": "Oak Stairs", "color": "#b58a56", "placeable": False},
    "oak_fence": {"label": "Oak Fence", "color": "#9a6a3b", "placeable": False},
    "oak_fence_gate": {"label": "Oak Fence Gate", "color": "#9a6a3b", "placeable": False},
    "oak_trapdoor": {"label": "Oak Trapdoor", "color": "#a97848", "placeable": False},
    "oak_pressure_plate": {"label": "Oak Pressure Plate", "color": "#b58a56", "placeable": False},
    "oak_button": {"label": "Oak Button", "color": "#b58a56", "placeable": False},
    "stone_slab": {"label": "Cobblestone Slab", "color": "#686868", "placeable": False},
    "stone_stairs": {"label": "Cobblestone Stairs", "color": "#686868", "placeable": False},
    "stone_pressure_plate": {"label": "Stone Pressure Plate", "color": "#777777", "placeable": False},
    "stone_button": {"label": "Stone Button", "color": "#777777", "placeable": False},
    "torch": {"label": "Torch", "color": "#e7b840", "placeable": False},
    "bowl": {"label": "Bowl", "color": "#9e7548", "placeable": False},
    "sign": {"label": "Oak Sign", "color": "#b58a56", "placeable": False},
    "boat": {"label": "Oak Boat", "color": "#9e7548", "placeable": False},
    "coal_block": {"label": "Block of Coal", "color": "#252527", "placeable": False},
    "redstone_block": {"label": "Block of Redstone", "color": "#ad1b13", "placeable": False},
}

CRAFTING_RECIPES = {
    "planks": {"category": "building", "name": "Oak Planks", "size": 2, "pattern": ["wood", None, None, None], "requires": {"wood": 1}, "output": {"item": "planks", "count": 4}},
    "sticks": {"category": "misc", "name": "Sticks", "size": 2, "pattern": ["planks", None, "planks", None], "requires": {"planks": 2}, "output": {"item": "sticks", "count": 4}},
    "crafting_table": {"category": "building", "name": "Crafting Table", "size": 2, "pattern": ["planks", "planks", "planks", "planks"], "requires": {"planks": 4}, "output": {"item": "crafting_table", "count": 1}},
    "wooden_pickaxe": {"category": "equipment", "name": "Wooden Pickaxe", "size": 3, "pattern": ["planks", "planks", "planks", None, "sticks", None, None, "sticks", None], "requires": {"planks": 3, "sticks": 2}, "output": {"item": "wooden_pickaxe", "count": 1}},
    "wooden_axe": {"category": "equipment", "name": "Wooden Axe", "size": 3, "pattern": ["planks", "planks", None, "planks", "sticks", None, None, "sticks", None], "requires": {"planks": 3, "sticks": 2}, "output": {"item": "wooden_axe", "count": 1}},
    "wooden_shovel": {"category": "equipment", "name": "Wooden Shovel", "size": 3, "pattern": [None, "planks", None, None, "sticks", None, None, "sticks", None], "requires": {"planks": 1, "sticks": 2}, "output": {"item": "wooden_shovel", "count": 1}},
    "wooden_sword": {"category": "equipment", "name": "Wooden Sword", "size": 3, "pattern": [None, "planks", None, None, "planks", None, None, "sticks", None], "requires": {"planks": 2, "sticks": 1}, "output": {"item": "wooden_sword", "count": 1}},
    "wooden_hoe": {"category": "equipment", "name": "Wooden Hoe", "size": 3, "pattern": ["planks", "planks", None, None, "sticks", None, None, "sticks", None], "requires": {"planks": 2, "sticks": 2}, "output": {"item": "wooden_hoe", "count": 1}},
    "stone_pickaxe": {"category": "equipment", "name": "Stone Pickaxe", "size": 3, "pattern": ["cobble", "cobble", "cobble", None, "sticks", None, None, "sticks", None], "requires": {"cobble": 3, "sticks": 2}, "output": {"item": "stone_pickaxe", "count": 1}},
    "stone_axe": {"category": "equipment", "name": "Stone Axe", "size": 3, "pattern": ["cobble", "cobble", None, "cobble", "sticks", None, None, "sticks", None], "requires": {"cobble": 3, "sticks": 2}, "output": {"item": "stone_axe", "count": 1}},
    "stone_shovel": {"category": "equipment", "name": "Stone Shovel", "size": 3, "pattern": [None, "cobble", None, None, "sticks", None, None, "sticks", None], "requires": {"cobble": 1, "sticks": 2}, "output": {"item": "stone_shovel", "count": 1}},
    "stone_sword": {"category": "equipment", "name": "Stone Sword", "size": 3, "pattern": [None, "cobble", None, None, "cobble", None, None, "sticks", None], "requires": {"cobble": 2, "sticks": 1}, "output": {"item": "stone_sword", "count": 1}},
    "stone_hoe": {"category": "equipment", "name": "Stone Hoe", "size": 3, "pattern": ["cobble", "cobble", None, None, "sticks", None, None, "sticks", None], "requires": {"cobble": 2, "sticks": 2}, "output": {"item": "stone_hoe", "count": 1}},
    "chest": {"category": "building", "name": "Chest", "size": 3, "pattern": ["planks", "planks", "planks", "planks", None, "planks", "planks", "planks", "planks"], "requires": {"planks": 8}, "output": {"item": "chest", "count": 1}},
    "furnace": {"category": "building", "name": "Furnace", "size": 3, "pattern": ["cobble", "cobble", "cobble", "cobble", None, "cobble", "cobble", "cobble", "cobble"], "requires": {"cobble": 8}, "output": {"item": "furnace", "count": 1}},
    "ladder": {"category": "building", "name": "Ladder", "size": 3, "pattern": ["sticks", None, "sticks", "sticks", "sticks", "sticks", "sticks", None, "sticks"], "requires": {"sticks": 7}, "output": {"item": "ladder", "count": 3}},
    "wooden_door": {"name": "Wooden Door", "size": 3, "category": "building", "pattern": ["planks", "planks", None, "planks", "planks", None, "planks", "planks", None], "requires": {"planks": 6}, "output": {"item": "wooden_door", "count": 3}},
    "oak_slab": {"name": "Oak Slabs", "size": 3, "category": "building", "pattern": [None, None, None, None, None, None, "planks", "planks", "planks"], "requires": {"planks": 3}, "output": {"item": "oak_slab", "count": 6}},
    "oak_stairs": {"name": "Oak Stairs", "size": 3, "category": "building", "pattern": ["planks", None, None, "planks", "planks", None, "planks", "planks", "planks"], "requires": {"planks": 6}, "output": {"item": "oak_stairs", "count": 4}},
    "oak_fence": {"name": "Oak Fence", "size": 3, "category": "building", "pattern": [None, None, None, "planks", "sticks", "planks", "planks", "sticks", "planks"], "requires": {"planks": 4, "sticks": 2}, "output": {"item": "oak_fence", "count": 3}},
    "oak_fence_gate": {"name": "Oak Fence Gate", "size": 3, "category": "building", "pattern": [None, None, None, "sticks", "planks", "sticks", "sticks", "planks", "sticks"], "requires": {"planks": 2, "sticks": 4}, "output": {"item": "oak_fence_gate", "count": 1}},
    "oak_trapdoor": {"name": "Oak Trapdoors", "size": 3, "category": "building", "pattern": [None, None, None, "planks", "planks", "planks", "planks", "planks", "planks"], "requires": {"planks": 6}, "output": {"item": "oak_trapdoor", "count": 2}},
    "oak_pressure_plate": {"name": "Oak Pressure Plate", "size": 2, "category": "redstone", "pattern": [None, None, "planks", "planks"], "requires": {"planks": 2}, "output": {"item": "oak_pressure_plate", "count": 1}},
    "oak_button": {"name": "Oak Button", "size": 2, "category": "redstone", "pattern": ["planks", None, None, None], "requires": {"planks": 1}, "output": {"item": "oak_button", "count": 1}},
    "stone_slab": {"name": "Cobblestone Slabs", "size": 3, "category": "building", "pattern": [None, None, None, None, None, None, "cobble", "cobble", "cobble"], "requires": {"cobble": 3}, "output": {"item": "stone_slab", "count": 6}},
    "stone_stairs": {"name": "Cobblestone Stairs", "size": 3, "category": "building", "pattern": ["cobble", None, None, "cobble", "cobble", None, "cobble", "cobble", "cobble"], "requires": {"cobble": 6}, "output": {"item": "stone_stairs", "count": 4}},
    "stone_pressure_plate": {"name": "Stone Pressure Plate", "size": 2, "category": "redstone", "pattern": [None, None, "cobble", "cobble"], "requires": {"cobble": 2}, "output": {"item": "stone_pressure_plate", "count": 1}},
    "stone_button": {"name": "Stone Button", "size": 2, "category": "redstone", "pattern": ["cobble", None, None, None], "requires": {"cobble": 1}, "output": {"item": "stone_button", "count": 1}},
    "torch": {"name": "Torches", "size": 2, "category": "building", "pattern": ["coal", None, "sticks", None], "requires": {"coal": 1, "sticks": 1}, "output": {"item": "torch", "count": 4}},
    "bowl": {"name": "Bowls", "size": 3, "category": "misc", "pattern": [None, None, None, "planks", None, "planks", None, "planks", None], "requires": {"planks": 3}, "output": {"item": "bowl", "count": 4}},
    "sign": {"name": "Oak Signs", "size": 3, "category": "building", "pattern": ["planks", "planks", "planks", "planks", "planks", "planks", None, "sticks", None], "requires": {"planks": 6, "sticks": 1}, "output": {"item": "sign", "count": 3}},
    "boat": {"name": "Oak Boat", "size": 3, "category": "misc", "pattern": [None, None, None, "planks", None, "planks", "planks", "planks", "planks"], "requires": {"planks": 5}, "output": {"item": "boat", "count": 1}},
    "coal_block": {"name": "Block of Coal", "size": 3, "category": "building", "pattern": ["coal", "coal", "coal", "coal", "coal", "coal", "coal", "coal", "coal"], "requires": {"coal": 9}, "output": {"item": "coal_block", "count": 1}},
    "redstone_block": {"name": "Block of Redstone", "size": 3, "category": "redstone", "pattern": ["redstone", "redstone", "redstone", "redstone", "redstone", "redstone", "redstone", "redstone", "redstone"], "requires": {"redstone": 9}, "output": {"item": "redstone_block", "count": 1}},
}

BLOCK_DROPS = {
    "grass": ("dirt", 1), "dirt": ("dirt", 1), "stone": ("cobble", 1), "cobble": ("cobble", 1),
    "wood": ("wood", 1), "spruce": ("wood", 1), "acacia": ("wood", 1), "jungle_wood": ("wood", 1),
    "sand": ("sand", 1), "sandstone": ("sandstone", 1), "red_sand": ("red_sand", 1), "terracotta": ("terracotta", 1),
    "podzol": ("dirt", 1), "deepslate": ("cobble", 1), "coal_ore": ("coal", 1), "iron_ore": ("raw_iron", 1),
    "planks": ("planks", 1), "crafting_table": ("crafting_table", 1), "furnace": ("furnace", 1), "chest": ("chest", 1),
    "redstone": ("redstone", 1), "lamp": ("lamp", 1), "lever": ("lever", 1), "glass": ("glass", 1),
}


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


def voxel_biome_at(x: float, z: float) -> str:
    """Deterministic broad biomes using low-frequency temperature/moisture fields."""
    # Keep the initial play area open and readable instead of spawning under a canopy.
    if x * x + z * z < 46 * 46:
        return "plains"
    temp = math.sin(x * 0.0082) + 0.62 * math.cos(z * 0.0067) + 0.24 * math.sin((x + z) * 0.0033)
    wet = math.cos(x * 0.0071 - 0.8) + 0.58 * math.sin(z * 0.0086) + 0.20 * math.cos((x - z) * 0.0038)
    odd = math.sin(x * 0.0047 + z * 0.0052) + 0.55 * math.cos(x * 0.0029 - z * 0.0041)
    ridge = math.sin(x * 0.0031) + math.cos(z * 0.0036) + 0.4 * math.sin((x - z) * 0.0022)
    if ridge > 1.45:
        return "mountains"
    if temp < -0.85:
        return "snowy_plains"
    if temp < -0.42:
        return "taiga"
    if temp > 0.95 and wet < -0.30:
        return "desert"
    if temp > 0.72 and wet < 0.22:
        return "savanna"
    if temp > 0.65 and wet > 0.82:
        return "jungle"
    if wet > 1.08:
        return "swamp"
    if temp > 0.48 and odd < -1.05:
        return "badlands"
    if ridge > 0.82 and wet > -0.25:
        return "meadow"
    if wet > 0.28:
        return "forest"
    return "plains"


def voxel_surface_layers(x: float, z: float, biome: Optional[str] = None) -> int:
    biome = biome or voxel_biome_at(x, z)
    broad = 0.75 * math.sin((x + 17) * 0.023) + 0.62 * math.cos((z - 11) * 0.021) + 0.34 * math.sin((x + z) * 0.012)
    detail = 0.33 * math.sin((x - z) * 0.071) + 0.22 * math.cos((x + z) * 0.059)
    amp = {
        "plains": 0.72, "forest": 1.0, "taiga": 1.15, "snowy_plains": 0.78, "desert": 0.82,
        "savanna": 1.05, "jungle": 1.25, "swamp": 0.34, "badlands": 1.55, "meadow": 1.55, "mountains": 3.9,
    }[biome]
    valley = 0.42 * math.sin(x * .009 - z * .006) + 0.28 * math.cos((x + z) * .008)
    base = 4.0 + broad * amp + detail * min(1.25, amp) + valley * min(1.0, amp)
    if biome == "mountains":
        base += 3.2 + abs(math.sin(x * .018) + math.cos(z * .016)) * 2.1
    elif biome == "badlands":
        base += abs(math.sin(x * .022)) * 1.5
    if biome == "swamp":
        base -= 0.8
    return int(clamp(round(base), 1, 14))


def voxel_surface_block(biome: str) -> str:
    return {
        "desert": "sand", "snowy_plains": "snow", "badlands": "red_sand", "taiga": "podzol",
        "mountains": "snow", "swamp": "grass", "savanna": "grass", "jungle": "grass", "forest": "grass",
        "meadow": "grass", "plains": "grass",
    }.get(biome, "grass")


def voxel_hash(cx: int, cz: int, salt: int = 0) -> float:
    v = math.sin(cx * 127.1 + cz * 311.7 + salt * 74.7) * 43758.5453
    return v - math.floor(v)


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
    weapon: str = DEFAULT_WEAPON
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
    inventory: Dict[str, int] = field(default_factory=dict)

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

    def voxel_surface_spawn(self, sx: int, sz: int, search_radius: int = 4):
        self.ensure_voxel_area(sx, sz, VOXEL_CHUNK_RADIUS)
        best = None
        for dz in range(-search_radius, search_radius + 1):
            for dx in range(-search_radius, search_radius + 1):
                x = grid_round(sx + dx * VOXEL_GRID, VOXEL_GRID)
                z = grid_round(sz + dz * VOXEL_GRID, VOXEL_GRID)
                col = [b for b in self.blocks.values() if b.x == x and b.z == z and b.type in VOXEL_TERRAIN_TYPES and b.type != "bedrock"]
                if not col:
                    continue
                top = max(col, key=lambda b: b.y)
                top_surface = top.y + 1
                penalty = abs(dx) + abs(dz)
                score = top_surface - penalty * 0.18
                if best is None or score > best[0]:
                    best = (score, x, top_surface, z)
        if best is None:
            return sx, 10, sz
        return best[1], best[2], best[3]

    def generate_voxel_chunk(self, cx: int, cz: int):
        column_tops = {}
        for lx in range(VOXEL_CHUNK_CELLS):
            for lz in range(VOXEL_CHUNK_CELLS):
                wx = (cx * VOXEL_CHUNK_CELLS + lx) * VOXEL_GRID
                wz = (cz * VOXEL_CHUNK_CELLS + lz) * VOXEL_GRID
                biome = voxel_biome_at(wx, wz)
                layers = voxel_surface_layers(wx, wz, biome)
                bottom_index = -12
                for idx in range(bottom_index, layers):
                    y = 1 + idx * 2
                    key = f"{wx}:{y}:{wz}"
                    if key in self.blocks:
                        continue
                    if idx == bottom_index:
                        typ = "bedrock"
                    else:
                        # Two overlapping 3-D cave fields give broad tunnels plus smaller pockets.
                        cave_a = math.sin(wx * .115 + y * .34) + math.cos(wz * .126 - y * .31)
                        cave_b = math.sin((wx + wz) * .073 + y * .27) + .65 * math.cos((wx - wz) * .064 - y * .22)
                        deep_enough = idx < layers - 2 and idx > bottom_index + 1
                        if deep_enough and (cave_a > 1.34 or (cave_a > .72 and cave_b > 1.22)):
                            continue
                        if idx == layers - 1:
                            typ = voxel_surface_block(biome)
                        elif biome == "desert" and idx >= layers - 3:
                            typ = "sandstone"
                        elif biome == "badlands" and idx >= layers - 4:
                            typ = "terracotta"
                        elif idx >= layers - 2:
                            typ = "dirt"
                        else:
                            # Deeper strata and sparse ores make underground exploration visibly richer.
                            if y <= -11:
                                typ = "deepslate"
                            else:
                                typ = "stone"
                            ore = voxel_hash(wx // 2 + idx * 13, wz // 2 - idx * 7, 31)
                            if y < 9 and ore > .972:
                                typ = "coal_ore"
                            if y < 1 and ore < .026:
                                typ = "iron_ore"
                    self.blocks[key] = Block(key, wx, y, wz, typ, "world")
                top = 1 + (layers - 1) * 2
                column_tops[(wx, wz)] = (top, biome)

        # Biome vegetation. Leaves have their own block type so spawn selection never mistakes the canopy for terrain.
        for (wx, wz), (top, biome) in column_tops.items():
            spawn_clear = any(abs(wx - sp[0]) <= 12 and abs(wz - sp[2]) <= 12 for sp in self.world_cfg["spawns"]) or (wx * wx + wz * wz <= 48 * 48)
            if spawn_clear:
                continue
            tree_score = voxel_hash(wx // 2, wz // 2, 4)
            threshold = {"forest": .965, "taiga": .972, "jungle": .945, "savanna": .988, "plains": .997, "meadow": .997, "swamp": .988}.get(biome, 2.0)
            if tree_score < threshold:
                continue
            trunk = "wood"
            leaves = "leaves"
            height = 3
            if biome == "taiga":
                trunk, leaves, height = "spruce", "spruce_leaves", 4
            elif biome == "savanna":
                trunk, leaves, height = "acacia", "acacia_leaves", 3
            elif biome == "jungle":
                trunk, leaves, height = "jungle_wood", "jungle_leaves", 5
            for h in range(1, height + 1):
                self.add_block(wx, top + h * 2, wz, trunk, "world")
            leaf_y = top + (height + 1) * 2
            if biome == "taiga":
                for dy, radius in ((0, 2), (2, 1), (4, 0)):
                    for dx in range(-radius, radius + 1):
                        for dz in range(-radius, radius + 1):
                            self.add_block(wx + dx * 2, leaf_y + dy, wz + dz * 2, leaves, "world")
            elif biome == "savanna":
                for dx in (-2, 0, 2):
                    for dz in (-2, 0, 2):
                        self.add_block(wx + dx, leaf_y, wz + dz, leaves, "world")
            else:
                for dx in (-2, 0, 2):
                    for dz in (-2, 0, 2):
                        if abs(dx) + abs(dz) <= 4:
                            self.add_block(wx + dx, leaf_y, wz + dz, leaves, "world")
                self.add_block(wx, leaf_y + 2, wz, leaves, "world")

        # Small, rare biome-appropriate villages. Village architecture follows the biome family:
        # oak/cobble in plains/meadow, sandstone in desert, spruce in taiga/snow, acacia in savanna.
        center_x = (cx * VOXEL_CHUNK_CELLS + VOXEL_CHUNK_CELLS // 2) * VOXEL_GRID
        center_z = (cz * VOXEL_CHUNK_CELLS + VOXEL_CHUNK_CELLS // 2) * VOXEL_GRID
        center_biome = voxel_biome_at(center_x, center_z)
        if center_biome in VILLAGE_BIOMES and voxel_hash(cx, cz, 91) > .965 and abs(center_x) + abs(center_z) > 35:
            self.generate_voxel_village(center_x, center_z, center_biome)

    def generate_voxel_village(self, cx: int, cz: int, biome: str):
        base_y = 1 + (voxel_surface_layers(cx, cz, biome) - 1) * 2
        wall_type = "sandstone" if biome == "desert" else "spruce" if biome in {"taiga", "snowy_plains"} else "acacia" if biome == "savanna" else "planks"
        roof_type = "sandstone" if biome == "desert" else "spruce" if biome in {"taiga", "snowy_plains"} else "acacia" if biome == "savanna" else "wood"
        for hx, hz in ((cx - 5, cz - 4), (cx + 5, cz + 4)):
            hbase = 1 + (voxel_surface_layers(hx, hz, voxel_biome_at(hx, hz)) - 1) * 2
            for dx in (-2, 0, 2):
                for dz in (-2, 0, 2):
                    if abs(dx) == 2 or abs(dz) == 2:
                        self.add_block(grid_round(hx + dx), hbase + 2, grid_round(hz + dz), wall_type, "world")
                        self.add_block(grid_round(hx + dx), hbase + 4, grid_round(hz + dz), wall_type, "world")
                    self.add_block(grid_round(hx + dx), hbase + 6, grid_round(hz + dz), roof_type, "world")
            # door opening
            self.blocks.pop(f"{grid_round(hx)}:{hbase + 2}:{grid_round(hz - 2)}", None)
            self.blocks.pop(f"{grid_round(hx)}:{hbase + 4}:{grid_round(hz - 2)}", None)
        # well / center marker
        for dx, dz in ((-2, 0), (2, 0), (0, -2), (0, 2)):
            self.add_block(cx + dx, base_y + 2, cz + dz, "cobble", "world")

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

    def add_inventory(self, p: Player, item: str, count: int = 1):
        if count <= 0 or item not in MINECRAFT_ITEMS:
            return
        p.inventory[item] = p.inventory.get(item, 0) + count

    def take_inventory(self, p: Player, item: str, count: int = 1) -> bool:
        if count <= 0:
            return True
        have = p.inventory.get(item, 0)
        if have < count:
            return False
        left = have - count
        if left:
            p.inventory[item] = left
        else:
            p.inventory.pop(item, None)
        return True

    def can_craft(self, p: Player, recipe: dict) -> bool:
        return all(p.inventory.get(item, 0) >= count for item, count in recipe["requires"].items())

    def craft(self, p: Player, recipe_id: str, scope: str = "inventory") -> Optional[dict]:
        recipe = CRAFTING_RECIPES.get(recipe_id)
        if not recipe or recipe.get("hidden"):
            return None
        max_size = 3 if scope == "table" else 2
        if recipe["size"] > max_size or not self.can_craft(p, recipe):
            return None
        for item, count in recipe["requires"].items():
            self.take_inventory(p, item, count)
        out = recipe["output"]
        self.add_inventory(p, out["item"], out["count"])
        return {"recipe": recipe_id, "item": out["item"], "count": out["count"]}

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

    def block_exposed(self, b: Block) -> bool:
        for dx, dy, dz in ((2, 0, 0), (-2, 0, 0), (0, 2, 0), (0, -2, 0), (0, 0, 2), (0, 0, -2)):
            if f"{b.x + dx}:{b.y + dy}:{b.z + dz}" not in self.blocks:
                return True
        return False

    def blocks_near(self, x: float, z: float, radius: float = VOXEL_STREAM_RADIUS):
        """Return the useful voxel window around ``x,z`` without scanning the whole world.

        The old implementation iterated over every block ever generated in the room. That
        becomes progressively slower in an infinite world. This version performs fixed-size
        dictionary lookups on the voxel grid, so the amount of work depends on the stream
        radius rather than on how far players have explored.
        """
        r2 = radius * radius
        core2 = 12 * 12
        center_x = grid_round(x, VOXEL_GRID)
        center_z = grid_round(z, VOXEL_GRID)
        cells = int(math.ceil(radius / VOXEL_GRID))
        out = []
        for ix in range(-cells, cells + 1):
            bx = center_x + ix * VOXEL_GRID
            dx2 = (bx - x) ** 2
            if dx2 > r2:
                continue
            for iz in range(-cells, cells + 1):
                bz = center_z + iz * VOXEL_GRID
                d2 = dx2 + (bz - z) ** 2
                if d2 > r2:
                    continue
                surface_y = 1 + (voxel_surface_layers(bx, bz) - 1) * 2
                if d2 <= core2:
                    y0, y1 = VOXEL_MIN_Y, VOXEL_MAX_Y
                else:
                    # Surface, tree canopy and village roofs are all within this band.
                    y0 = max(VOXEL_MIN_Y, surface_y - 5)
                    y1 = min(VOXEL_MAX_Y, surface_y + 19)
                if (y0 - 1) % 2:
                    y0 += 1
                for by in range(y0, y1 + 1, 2):
                    b = self.blocks.get(f"{bx}:{by}:{bz}")
                    if b is not None:
                        out.append(b.public())
        return out

    async def emit_blocks(self, only: Optional[str] = None, center: Optional[Tuple[float, float]] = None,
                          radius: float = VOXEL_STREAM_RADIUS, message_type: str = "blocks_patch"):
        """Send a mergeable voxel patch instead of replacing the client's whole cache."""
        dead = []
        for pid, ws in list(self.sockets.items()):
            if only is not None and pid != only:
                continue
            player = self.players.get(pid)
            if not player:
                continue
            cx, cz = center if center is not None else (player.x, player.z)
            try:
                await ws.send_json({
                    "t": message_type,
                    "center": [cx, cz],
                    "radius": radius,
                    "blocks": self.blocks_near(cx, cz, radius),
                })
            except Exception:
                dead.append(pid)
        for pid in dead:
            self.sockets.pop(pid, None)

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
        "version": "3.2.0",
        "rooms": len(rooms),
        "players": sum(len(r.players) for r in rooms.values()),
    }


@app.get("/api/config")
async def config():
    return JSONResponse({"classes": CLASSES, "weapons": WEAPONS, "worlds": public_worlds(), "world_order": WORLD_ORDER, "modes": sorted(MODES), "minecraft_items": MINECRAFT_ITEMS, "crafting_recipes": CRAFTING_RECIPES})


@app.get("/api/site-config")
async def site_config():
    return JSONResponse({"ads": ad_config(), "version": "3.2.0", "brand": "Blockfront Worlds"})


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
    weapon = qp.get("weapon") or DEFAULT_WEAPON
    if weapon not in WEAPONS:
        weapon = DEFAULT_WEAPON
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
    p = Player(pid, name, klass, team, sx, sy, sz, weapon=weapon, hp=CLASSES[klass]["hp"])
    room.players[pid] = p
    room.sockets[pid] = ws
    room.spawn(p)
    # Make the first frame deterministic for clients: welcome always arrives
    # before snapshots/events from the room loop.
    await ws.send_json({
        "t": "welcome", "id": pid, "room": room.code, "mode": room.mode, "world": room.world,
        "player": p.public(), "hardpoint": room.hardpoint_index,
        "blocks": room.blocks_near(p.x, p.z) if room.world == "voxel" else [],
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
                        p.y = clamp(ny, VOXEL_MIN_Y - 3, 48)
                        generated = room.ensure_voxel_area(p.x, p.z, VOXEL_CHUNK_RADIUS)
                        if p.y < VOXEL_MIN_Y - 1:
                            sx, sy, sz = room.voxel_surface_spawn(int(p.x), int(p.z), 2)
                            p.x, p.y, p.z = sx, sy, sz
                            await ws.send_json({"t": "respawn", "player": p.public()})
                    else:
                        p.y = clamp(ny, 0, 24)
                if generated:
                    await room.emit_blocks(only=pid, center=(p.x, p.z), radius=36)
                p.yaw = float(msg.get("yaw", p.yaw))
                p.pitch = clamp(float(msg.get("pitch", p.pitch)), -1.55, 1.55)
                p.vx = clamp(float(msg.get("vx", 0)), -30, 30)
                p.vy = clamp(float(msg.get("vy", 0)), -30, 30)
                p.vz = clamp(float(msg.get("vz", 0)), -30, 30)

            elif t == "voxel_prefetch" and p.alive and room.world == "voxel":
                try:
                    tx = float(msg.get("x", p.x))
                    tz = float(msg.get("z", p.z))
                except (TypeError, ValueError):
                    continue
                if math.hypot(tx - p.x, tz - p.z) <= 90:
                    room.ensure_voxel_area(tx, tz, VOXEL_CHUNK_RADIUS)
                    await room.emit_blocks(only=pid, center=(tx, tz), radius=36)

            elif t == "class":
                k = msg.get("klass")
                if k in CLASSES:
                    p.klass = k
                    room.spawn(p)
                    await ws.send_json({"t": "respawn", "player": p.public()})
                    await room.emit({"t": "event", "kind": "class", "text": f"{p.name} switched to {k}"})

            elif t == "weapon":
                selected = str(msg.get("weapon", DEFAULT_WEAPON))
                if selected in WEAPONS:
                    p.weapon = selected
                    await ws.send_json({"t": "weapon", "weapon": p.weapon})
                    await room.emit({"t": "event", "kind": "weapon", "text": f"{p.name} equipped {p.weapon}"})

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

            elif t == "craft" and p.alive and room.world == "voxel":
                recipe_id = str(msg.get("recipe", ""))
                scope = "table" if str(msg.get("scope", "inventory")) == "table" else "inventory"
                result = room.craft(p, recipe_id, scope)
                if result:
                    await ws.send_json({"t": "craft_result", **result, "inventory": p.inventory})
                else:
                    await ws.send_json({"t": "craft_error", "recipe": recipe_id, "inventory": p.inventory})

            elif t == "drop_item" and p.alive and room.world == "voxel":
                item = str(msg.get("item", ""))
                if item in MINECRAFT_ITEMS and room.take_inventory(p, item, 1):
                    await ws.send_json({"t": "inventory", "inventory": p.inventory})

            elif t == "block_break" and p.alive and room.world == "voxel":
                now = time.time()
                if now - p.last_edit < .12:
                    continue
                p.last_edit = now
                key = str(msg.get("key", ""))
                b = room.blocks.get(key)
                if not b:
                    continue
                if b.type == "bedrock":
                    continue
                if math.dist((p.x, p.y + 3.0, p.z), (b.x, b.y, b.z)) > 8.0:
                    continue
                # Protect the demo lever/lamp circuit from being instantly erased
                # only if it was seeded by the world; every other block is mineable.
                removed = room.blocks.pop(key, None)
                room.recompute_power()
                p.score += 5
                if removed:
                    await room.emit({"t": "block_remove", "key": key})
                    drop = BLOCK_DROPS.get(removed.type)
                    if drop:
                        item, count = drop
                        room.add_inventory(p, item, count)
                        await ws.send_json({"t": "item_pickup", "item": item, "count": count, "at": [removed.x, removed.y, removed.z], "inventory": p.inventory})
                    elif removed.type.endswith("leaves") or removed.type == "leaves":
                        # Leaves usually disappear without a block drop in this lightweight survival layer.
                        if random.random() < .12:
                            room.add_inventory(p, "sticks", 1)
                            await ws.send_json({"t": "item_pickup", "item": "sticks", "count": 1, "at": [removed.x, removed.y, removed.z], "inventory": p.inventory})
                    if removed.type in {"redstone", "lamp", "lever"}:
                        await room.emit_blocks(radius=28)

            elif t == "block_place" and p.alive and room.world == "voxel":
                now = time.time()
                if now - p.last_edit < .12:
                    continue
                p.last_edit = now
                typ = str(msg.get("type", "dirt")).lower()
                if typ not in BLOCK_TYPES or p.inventory.get(typ, 0) <= 0:
                    await ws.send_json({"t": "block_place_error", "message": "You do not have that block."})
                    continue
                raw_pos = [float(v) for v in msg.get("pos", [0, 1, 0])[:3]]
                x = grid_round(raw_pos[0], 2)
                z = grid_round(raw_pos[2], 2)
                y = int(round((raw_pos[1] - 1) / 2) * 2 + 1)
                # Prefer the authoritative server-side target block + clicked face.
                # This keeps placement aligned with Minecraft's adjacent-face rule and
                # prevents client/server disagreement when hidden terrain blocks exist.
                against_key = str(msg.get("against_key") or "")
                face = msg.get("face")
                against = room.blocks.get(against_key) if against_key else None
                if against is not None and isinstance(face, list) and len(face) >= 3:
                    vals = [float(face[i]) for i in range(3)]
                    axis = max(range(3), key=lambda i: abs(vals[i]))
                    step = 1 if vals[axis] >= 0 else -1
                    fx = step if axis == 0 else 0
                    fy = step if axis == 1 else 0
                    fz = step if axis == 2 else 0
                    x = against.x + fx * 2
                    y = against.y + fy * 2
                    z = against.z + fz * 2
                x = grid_round(x, 2)
                z = grid_round(z, 2)
                y = int(round((y - 1) / 2) * 2 + 1)
                y = int(clamp(y, VOXEL_MIN_Y, VOXEL_MAX_Y))
                room.ensure_voxel_area(x, z, VOXEL_CHUNK_RADIUS)
                if math.dist((p.x, p.y + 3.0, p.z), (x, y, z)) > 9.5:
                    await ws.send_json({"t": "block_place_error", "key": f"{x}:{y}:{z}", "message": "That block is too far away."})
                    continue
                key = f"{x}:{y}:{z}"
                if key in room.blocks or len(room.blocks) >= 60000:
                    await ws.send_json({"t": "block_place_error", "key": key, "message": "That space is occupied."})
                    continue
                # Avoid trapping a player inside a new cube.
                if any(abs(q.x - x) < .95 and abs((q.y + 1.8) - y) < 1.45 and abs(q.z - z) < .95 for q in room.players.values() if q.alive):
                    await ws.send_json({"t": "block_place_error", "key": key, "message": "A player is occupying that space."})
                    continue
                placed = room.add_block(x, y, z, typ, p.id)
                room.take_inventory(p, typ, 1)
                room.recompute_power()
                await room.emit({"t": "block_add", "block": placed.public()})
                await ws.send_json({"t": "inventory", "inventory": p.inventory})
                if typ in {"redstone", "lamp", "lever"}:
                    await room.emit_blocks(radius=28)

            elif t == "block_use" and p.alive and room.world == "voxel":
                key = str(msg.get("key", ""))
                b = room.blocks.get(key)
                if b and b.type == "lever" and math.dist((p.x, p.y + 3.0, p.z), (b.x, b.y, b.z)) <= 7.0:
                    b.powered = not b.powered
                    room.recompute_power()
                    await room.emit_blocks(radius=28)

            elif t == "fire" and p.alive:
                cfg = WEAPONS.get(p.weapon, WEAPONS[DEFAULT_WEAPON])
                now = time.time()
                min_interval = 60.0 / cfg["rpm"]
                if now - p.last_fire < min_interval * 0.72:
                    continue
                p.last_fire = now
                origin = tuple(float(v) for v in msg.get("o", [p.x, p.y + 1.4, p.z])[:3])
                direction = norm(tuple(float(v) for v in msg.get("d", [0, 0, -1])[:3]))
                if math.dist(origin, (p.x, p.y + 1.4, p.z)) > 3.0:
                    continue
                if cfg.get("nonlethal"):
                    digit = random.choice(["6", "7"])
                    await room.emit({"t": "milan", "shooter": p.id, "name": p.name, "digit": digit, "o": list(origin), "d": list(direction)})
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
                        hit_spheres = [
                            (ray_sphere(origin, d, (q.x, q.y + 1.8, q.z), .78), False),
                            (ray_sphere(origin, d, (q.x, q.y + 3.2, q.z), .46), True),
                        ] if room.world == "voxel" else [
                            (ray_sphere(origin, d, (q.x, q.y + .9, q.z), .56), False),
                            (ray_sphere(origin, d, (q.x, q.y + 1.55, q.z), .35), True),
                        ]
                        for ht, is_head in hit_spheres:
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
                        damage = cfg["damage"] * (cfg.get("head_multiplier", 1.5) if is_head else 1.0)
                        if cfg["range"] > 25 and distance > cfg["range"] * .60 and p.weapon not in {"Sniper Rifle"}:
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
                        await room.emit({"t": "kill", "killer": p.name, "killer_id": p.id, "victim": q.name, "victim_id": q.id, "weapon": p.weapon, "streak": p.streak})
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
