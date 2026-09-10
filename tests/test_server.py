from pathlib import Path

from fastapi.testclient import TestClient

from app import (
    BLOCK_TYPES,
    CLAN_DEFENSE_COUNTS,
    CLAN_WALL_COUNTS,
    CLASSES,
    CRAFTING_RECIPES,
    MINECRAFT_ITEMS,
    WEAPONS,
    WORLD_ORDER,
    WORLDS,
    VOXEL_STREAM_RADIUS,
    Player,
    Room,
    app,
    get_room,
    ray_aabb,
    ray_sphere,
    rooms,
    voxel_biome_at,
    voxel_surface_layers,
)

client = TestClient(app)


def test_health():
    r = client.get('/health')
    assert r.status_code == 200
    body = r.json()
    assert body['ok'] is True
    assert body['version'] == '3.2.0'


def test_config_contains_five_worlds():
    r = client.get('/api/config')
    assert r.status_code == 200
    data = r.json()
    assert 'Triggerman' in data['classes']
    assert data['world_order'] == ['classic', 'voxel', 'stadium', 'battle', 'clan']
    assert set(data['worlds']) == set(data['world_order'])
    assert data['worlds']['voxel']['build'] is True
    assert data['worlds']['voxel']['day_night'] is True
    assert data['worlds']['voxel']['mobs'] is True
    assert len(data['worlds']['voxel']['biomes']) >= 10
    assert {'Assault Rifle', 'Sniper Rifle', 'Shotgun', 'Machine Gun', 'Milan Gun'} <= set(data['weapons'])
    assert data['weapons']['Milan Gun']['nonlethal'] is True
    assert data['weapons']['Milan Gun']['damage'] == 0
    assert data['worlds']['clan']['name'] == 'Clash of Clans'
    assert data['worlds']['clan']['town_hall_count'] == 17
    layout = data['worlds']['clan']['town_hall_layout']
    assert len(layout) == 17
    assert layout[0] == {'th': 1, 'x': 0, 'z': 0}
    assert len({v['x'] for v in layout}) > 8
    assert len({v['z'] for v in layout}) > 8
    assert all(data['worlds'][wid]['infinite'] for wid in data['world_order'])


def test_all_worlds_have_gameplay_geometry():
    for wid in WORLD_ORDER:
        w = WORLDS[wid]
        assert len(w['boxes']) >= 10
        assert len(w['spawns']) >= 4
        assert len(w['hardpoints']) >= 3
        assert len(w['bounds']) == 4


def test_ray_sphere():
    t = ray_sphere((0, 0, 0), (0, 0, 1), (0, 0, 5), 1)
    assert t is not None and 3.9 < t < 4.1


def test_ray_aabb():
    b = {'x': 0, 'y': 1, 'z': 5, 'w': 2, 'h': 2, 'd': 2}
    t = ray_aabb((0, 1, 0), (0, 0, 1), b)
    assert t is not None and 3.9 < t < 4.1


def test_class_data():
    assert len(CLASSES) >= 10
    assert all(v['hp'] > 0 and v['rpm'] > 0 for v in CLASSES.values())


def test_room_isolated_by_world():
    rooms.clear()
    a = get_room('SAME', 'FFA', 'classic')
    b = get_room('SAME', 'FFA', 'voxel')
    assert a is not b
    assert a.world == 'classic'
    assert b.world == 'voxel'
    assert b.blocks
    assert b.mobs
    assert any(block.type == 'bedrock' for block in b.blocks.values())
    assert any(block.y < 1 for block in b.blocks.values())


def test_voxel_power_network():
    rooms.clear()
    room = get_room('POWER', 'FFA', 'voxel')
    # The seeded demo contains a lever and lamp linked by redstone.
    lever = next(b for b in room.blocks.values() if b.type == 'lever')
    lamp = next(b for b in room.blocks.values() if b.type == 'lamp')
    assert lamp.powered is False
    lever.powered = True
    room.recompute_power()
    assert lamp.powered is True


def test_site_config_ads_default_off(monkeypatch):
    monkeypatch.delenv('ADS_ENABLED', raising=False)
    r = client.get('/api/site-config')
    assert r.status_code == 200
    assert r.json()['ads']['enabled'] is False


def test_room_browser_endpoint():
    r = client.get('/api/rooms')
    assert r.status_code == 200
    assert 'rooms' in r.json()


def test_block_types_are_safe_known_values():
    assert {'dirt', 'stone', 'wood', 'redstone', 'lamp', 'lever'} <= BLOCK_TYPES


def test_websocket_welcome_precedes_room_updates():
    rooms.clear()
    with client.websocket_connect('/ws/WELCOME?mode=FFA&world=voxel&name=Tester&klass=Triggerman') as ws:
        first = ws.receive_json()
        assert first['t'] == 'welcome'
        assert first['world'] == 'voxel'
        assert first['blocks']


def test_voxel_spawn_is_above_surface():
    b = Room("ROOM2", "FFA", "voxel")
    p = Player(id="p", name="P", klass="Runner", team="Alpha", x=0, y=0, z=0)
    b.players[p.id] = p
    b.spawn(p)
    assert p.y >= 8
    terrain_types = {'grass','dirt','stone','sand','sandstone','snow','red_sand','terracotta','podzol'}
    top = max(block.y for block in b.blocks.values() if block.x == p.x and block.z == p.z and block.type in terrain_types) + 1
    assert p.y >= top


def test_weapon_catalog():
    assert WEAPONS['Sniper Rifle']['damage'] > WEAPONS['Assault Rifle']['damage']
    assert WEAPONS['Shotgun']['pellets'] == 7
    assert WEAPONS['Machine Gun']['mag'] >= 50
    assert WEAPONS['Milan Gun']['damage'] == 0
    assert WEAPONS['Milan Gun']['nonlethal'] is True


def test_clan_progression_geometry():
    clan = WORLDS['clan']
    assert clan['town_hall_count'] == 17
    tags = {b['tag'] for b in clan['boxes']}
    for th in (1, 5, 10, 17):
        assert f'th{th}_townhall' in tags
    layout = clan['town_hall_layout']
    assert len(layout) == 17
    coords = {(v['x'], v['z']) for v in layout}
    assert len(coords) == 17
    assert len({x for x, _ in coords}) > 8 and len({z for _, z in coords}) > 8
    th17 = next(v for v in layout if v['th'] == 17)
    assert th17['x'] != 0


def test_voxel_biome_generation_helpers():
    known = {'plains','forest','taiga','snowy_plains','desert','savanna','jungle','swamp','badlands','meadow','mountains'}
    samples = {(x, z) for x in range(-1200, 1201, 120) for z in range(-1200, 1201, 120)}
    seen = {voxel_biome_at(x, z) for x, z in samples}
    assert seen <= known
    assert len(seen) >= 7
    assert all(1 <= voxel_surface_layers(x, z) <= 14 for x, z in list(samples)[:40])


def test_clan_layout_is_dense_enough_for_continuous_map():
    layout = WORLDS['clan']['town_hall_layout']
    coords = [(v['x'], v['z']) for v in layout]
    for i, (x, z) in enumerate(coords):
        nearest = min(((x-x2)**2 + (z-z2)**2) ** .5 for j, (x2, z2) in enumerate(coords) if i != j)
        assert nearest < 80


def test_clan_exact_wall_and_defense_counts():
    expected_walls = {1:0,2:25,3:50,4:75,5:100,6:125,7:175,8:225,9:250,10:275,11:300,12:300,13:300,14:325,15:325,16:325,17:325}
    assert CLAN_WALL_COUNTS == expected_walls
    assert sum(CLAN_DEFENSE_COUNTS[1].values()) == 1
    assert sum(CLAN_DEFENSE_COUNTS[8].values()) == 25
    assert sum(CLAN_DEFENSE_COUNTS[12].values()) == 45
    assert sum(CLAN_DEFENSE_COUNTS[15].values()) == 55
    assert CLAN_DEFENSE_COUNTS[17]['firespitter'] == 2
    assert CLAN_DEFENSE_COUNTS[17]['multigear'] == 1
    assert CLAN_DEFENSE_COUNTS[17]['infernoartillery'] == 1
    assert CLAN_DEFENSE_COUNTS[17].get('cannon', 0) == 0

def test_voxel_depth_and_spawn_clearing():
    room = Room('DEEP', 'FFA', 'voxel')
    assert any(b.y <= -20 for b in room.blocks.values())
    assert any(b.type in {'deepslate','coal_ore','iron_ore'} for b in room.blocks.values())
    assert voxel_biome_at(0, 0) == 'plains'


def test_voxel_stream_radius_is_bounded_for_fast_patches():
    assert VOXEL_STREAM_RADIUS <= 44


def test_voxel_prefetch_returns_mergeable_patch():
    rooms.clear()
    with client.websocket_connect('/ws/PATCH?mode=FFA&world=voxel&name=PatchTester&klass=Triggerman') as ws:
        welcome = ws.receive_json()
        assert welcome['t'] == 'welcome'
        ws.send_json({'t': 'voxel_prefetch', 'x': welcome['player']['x'] + 20, 'z': welcome['player']['z'] + 8})
        found = None
        for _ in range(12):
            msg = ws.receive_json()
            if msg.get('t') == 'blocks_patch':
                found = msg
                break
        assert found is not None
        assert found['radius'] <= 36
        assert found['blocks']


def test_minecraft_survival_crafting_catalog():
    assert len(CRAFTING_RECIPES) >= 30
    assert CRAFTING_RECIPES['planks']['size'] == 2
    assert CRAFTING_RECIPES['crafting_table']['size'] == 2
    assert CRAFTING_RECIPES['wooden_pickaxe']['size'] == 3
    assert CRAFTING_RECIPES['furnace']['requires']['cobble'] == 8
    assert CRAFTING_RECIPES['torch']['output'] == {'item': 'torch', 'count': 4}
    assert 'stone_sword' in MINECRAFT_ITEMS


def test_minecraft_break_adds_inventory_and_craft_consumes_materials():
    room = Room('CRAFT', 'FFA', 'voxel')
    p = Player(id='crafter', name='Crafter', klass='Runner', team='Alpha', x=0, y=10, z=0)
    room.add_inventory(p, 'wood', 1)
    result = room.craft(p, 'planks', 'inventory')
    assert result['item'] == 'planks' and result['count'] == 4
    assert p.inventory.get('wood', 0) == 0
    assert p.inventory.get('planks', 0) == 4
    result = room.craft(p, 'crafting_table', 'inventory')
    assert result['item'] == 'crafting_table' and result['count'] == 1
    assert p.inventory.get('crafting_table', 0) == 1


def test_three_by_three_recipe_requires_crafting_table_scope():
    room = Room('TABLE', 'FFA', 'voxel')
    p = Player(id='crafter2', name='Crafter2', klass='Runner', team='Alpha', x=0, y=10, z=0)
    room.add_inventory(p, 'planks', 3)
    room.add_inventory(p, 'sticks', 2)
    assert room.craft(p, 'wooden_pickaxe', 'inventory') is None
    crafted = room.craft(p, 'wooden_pickaxe', 'table')
    assert crafted['item'] == 'wooden_pickaxe' and crafted['count'] == 1


def test_client_regressions_for_v32():
    js = Path('static/game.js').read_text(encoding='utf-8')
    assert 'function clanGLBClone' in js
    assert 'function preloadClanGLBs' in js
    assert 'against_key:againstKey' in js
    assert 'if(state.ws!==ws)return' in js
    assert "state.world!=='voxel'&&['blocks','blocks_patch'" in js


def test_clan_glb_assets_are_present_and_valid():
    model_dir = Path('static/assets/clan_models')
    names = {'town_hall','archer_tower','cannon','laboratory','barbarian','giant','wizard','pekka','wall_piece'}
    for name in names:
        data = (model_dir / f'{name}.glb').read_bytes()
        assert data[:4] == b'glTF'
        assert len(data) > 1000
