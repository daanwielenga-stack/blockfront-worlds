from fastapi.testclient import TestClient

from app import (
    BLOCK_TYPES,
    CLASSES,
    WEAPONS,
    WORLD_ORDER,
    WORLDS,
    Player,
    Room,
    app,
    get_room,
    ray_aabb,
    ray_sphere,
    rooms,
)

client = TestClient(app)


def test_health():
    r = client.get('/health')
    assert r.status_code == 200
    body = r.json()
    assert body['ok'] is True
    assert body['version'] == '2.2.0'


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
    assert {'Assault Rifle', 'Sniper Rifle', 'Shotgun', 'Machine Gun', 'Milan Gun'} <= set(data['weapons'])
    assert data['weapons']['Milan Gun']['nonlethal'] is True
    assert data['weapons']['Milan Gun']['damage'] == 0
    assert data['worlds']['clan']['name'] == 'Clash of Clans'
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
    top = max(block.y for block in b.blocks.values() if block.x == p.x and block.z == p.z) + 1
    assert p.y >= top


def test_weapon_catalog():
    assert WEAPONS['Sniper Rifle']['damage'] > WEAPONS['Assault Rifle']['damage']
    assert WEAPONS['Shotgun']['pellets'] == 7
    assert WEAPONS['Machine Gun']['mag'] >= 50
    assert WEAPONS['Milan Gun']['damage'] == 0
    assert WEAPONS['Milan Gun']['nonlethal'] is True
