"""Small live smoke test for a running Blockfront Worlds server.

Start the app first, then run:
    python scripts/smoke_multiplayer.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from urllib.parse import quote

import httpx
import websockets

BASE_HTTP = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:8000'
BASE_WS = BASE_HTTP.replace('https://', 'wss://').replace('http://', 'ws://')


async def main():
    health = httpx.get(f'{BASE_HTTP}/health', timeout=10)
    health.raise_for_status()
    print('health:', health.json())

    base = f'{BASE_WS}/ws/SMOKE?mode=TDM&world=voxel'
    ua = f'{base}&name={quote("Smoke_A")}&klass={quote("Triggerman")}'
    ub = f'{base}&name={quote("Smoke_B")}&klass={quote("Run N Gun")}'

    async with websockets.connect(ua) as a, websockets.connect(ub) as b:
        wa = json.loads(await asyncio.wait_for(a.recv(), 5))
        wb = json.loads(await asyncio.wait_for(b.recv(), 5))
        assert wa['t'] == wb['t'] == 'welcome'
        assert wa['world'] == wb['world'] == 'voxel'
        assert wa['blocks'], 'Voxel room should contain synchronized blocks'
        await a.send(json.dumps({'t': 'chat', 'text': 'multiplayer-smoke'}))
        for _ in range(40):
            msg = json.loads(await asyncio.wait_for(b.recv(), 5))
            if msg.get('t') == 'chat' and msg.get('text') == 'multiplayer-smoke':
                print('multiplayer: PASS')
                return
        raise RuntimeError('chat synchronization was not observed')


if __name__ == '__main__':
    asyncio.run(main())
