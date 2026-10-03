"""Browser checks for #5. Run after npm run build with Playwright 1.55.0.

Uses the real source UI, with a read-only observation hook in served main.js.
No game state is modified by the test. Also loads the published standalone HTML.
"""
import functools
import http.server
import json
from pathlib import Path
import shutil
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'artifacts' / 'touch-browser'
OUTPUT.mkdir(parents=True, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/src/main.js':
            source = (ROOT / 'src/main.js').read_text().replace('let last = 0;', '''
            globalThis.inspectGame = () => ({configuration: game.configuration,
              simulation: game.simulation, camera: game.camera,
              drag: input.state.drag, pointers: input.state.pointers.size});
            let last = 0;''')
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.end_headers()
            self.wfile.write(source.encode())
        else:
            super().do_GET()

    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),
                                headless=True, args=['--no-sandbox'])
    for width, height in [(320, 568), (390, 844), (412, 915), (844, 390), (1280, 720)]:
        context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url)
        page.wait_for_function('typeof inspectGame === "function"')
        page.wait_for_timeout(100)
        boxes = page.evaluate('''() => {
          const ids = ['follow','play','reset','clocks','stage','tray'];
          const nodes = [...ids.map(id => document.getElementById(id)), ...document.querySelectorAll('.card')];
          return nodes.map(n => {const r = n.getBoundingClientRect(); return {
            id:n.id || n.dataset.type, x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};});
        }''')
        for box in boxes:
            assert box['x'] >= -0.1 and box['y'] >= -0.1, box
            assert box['right'] <= width + 0.1 and box['bottom'] <= height + 0.1, box
            if box['id'] in ['follow', 'play', 'reset', 'planet', 'giant', 'star']:
                assert box['width'] >= 44 and box['height'] >= 44, box
        # Controls must remain separate, not merely have on-screen bounding boxes.
        buttons = boxes[:3]
        for a, b in zip(buttons, buttons[1:]):
            assert a['right'] <= b['x'], (a, b)
        stage = next(b for b in boxes if b['id'] == 'stage')
        tray = next(b for b in boxes if b['id'] == 'tray')
        assert stage['height'] >= 100 and stage['bottom'] <= tray['y'], boxes
        assert page.evaluate('getComputedStyle(document.querySelector("canvas")).touchAction') == 'none'
        assert page.evaluate('document.documentElement.scrollWidth') <= width
        page.screenshot(path=str(OUTPUT / f'{width}x{height}.png'))
        print(f'PASS layout {width}x{height}', flush=True)
        context.close()

    context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function('typeof inspectGame === "function"')
    page.wait_for_timeout(100)
    cdp = context.new_cdp_session(page)
    fingers = {}

    def touch(kind, finger, xy=None):
        if xy is not None:
            fingers[finger] = {'id': finger, 'x': xy[0], 'y': xy[1]}
        if kind == 'touchEnd':
            fingers.pop(finger)
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': list(fingers.values())})
        page.wait_for_timeout(40)

    def state():
        return page.evaluate('inspectGame()')

    def at(x, y):
        return page.evaluate('''([x,y]) => { const c=inspectGame().camera, r=document.querySelector('canvas').getBoundingClientRect();
          return [r.x+r.width/2+(x-c.x)*c.zoom,r.y+r.height/2+(y-c.y)*c.zoom]; }''', [x, y])

    def centre(selector):
        r = page.locator(selector).bounding_box()
        return [r['x'] + r['width']/2, r['y'] + r['height']/2]

    def drag(start, end):
        touch('touchStart', 1, start)
        touch('touchMove', 1, end)
        touch('touchEnd', 1)

    drag(centre('[data-type=planet]'), at(-350, -140))
    assert len(state()['configuration']['placed']) == 1
    camera = state()['camera']
    drag(at(-350, -140), at(-310, -120))
    # Chromium Touch -> Pointer coordinates are rounded to CSS pixels.
    assert abs(state()['configuration']['placed'][0]['x'] + 310) < 2, state()['configuration']
    assert state()['camera'] == camera
    # Invalid position is shown while the existing-body preview is still separate.
    before = state()['configuration']
    touch('touchStart', 1, at(-310, -120))
    touch('touchMove', 1, at(-30, 0))
    assert state()['configuration'] == before
    page.screenshot(path=str(OUTPUT / 'invalid-existing-drag.png'))
    touch('touchEnd', 1)
    assert state()['configuration'] == before
    # Real touchCancel must discard the preview and release capture.
    touch('touchStart', 1, at(-310, -120))
    touch('touchMove', 1, at(-350, -140))
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []})
    fingers.clear()
    page.wait_for_timeout(40)
    assert state()['drag'] is None and state()['pointers'] == 0
    assert state()['configuration'] == before
    # A second finger during tray drag becomes a pinch, never a placed star.
    touch('touchStart', 1, centre('[data-type=star]'))
    touch('touchMove', 1, at(-350, -250))
    touch('touchStart', 2, [280, 400])
    assert state()['drag'] is None
    zoom = state()['camera']['zoom']
    touch('touchMove', 2, [340, 420])
    assert state()['camera']['zoom'] != zoom
    touch('touchEnd', 2)
    touch('touchEnd', 1)
    assert state()['configuration'] == before
    assert page.evaluate('visualViewport.scale') == 1, 'pinch must zoom the game, not the page'
    # Returning the planet to the tray removes it; it can be placed again.
    drag(at(-310, -120), centre('#tray'))
    assert not state()['configuration']['placed']
    drag(centre('[data-type=planet]'), at(-350, -140))
    assert len(state()['configuration']['placed']) == 1
    initial = state()['configuration']
    page.locator('#play').tap()
    page.wait_for_function('inspectGame().simulation.shipYears > 0')
    assert state()['camera']['follow'] is True
    page.locator('#reset').tap()
    assert state()['simulation']['status'] == 'ready'
    assert state()['simulation']['shipYears'] == 0
    assert state()['configuration'] == initial
    page.locator('#play').tap()
    page.wait_for_function('inspectGame().simulation.shipYears > 0')
    page.locator('#reset').tap()
    # Bring the placed body back into view after the camera followed the ship.
    page.mouse.move(195, 400)
    page.mouse.wheel(0, 2500)
    page.wait_for_timeout(100)
    # Rotation/resize cancels a pending drag, without changing its start position.
    touch('touchStart', 1, at(-350, -140))
    touch('touchMove', 1, at(-310, -120))
    assert state()['drag'] is not None
    page.set_viewport_size({'width': 844, 'height': 390})
    page.wait_for_timeout(100)
    assert state()['drag'] is None and state()['pointers'] == 0
    assert state()['configuration'] == initial
    touch('touchEnd', 1)
    print('PASS real browser touch cycle, pinch, cancellation, repeat and resize', flush=True)
    page.goto(url + '/dist/game/index.html')
    page.locator('#play').tap()
    page.wait_for_function('Number(document.getElementById("ship-time").textContent) > 0')
    page.locator('#reset').tap()
    assert page.locator('#ship-time').inner_text() == '0.00'
    print('PASS standalone HTML Play and Reset', flush=True)
    # Mission examples are embedded into the same standalone HTML, without fetches.
    page.goto(url + '/dist/game/index.html?mission=example-survival')
    assert page.locator('#mission').is_visible()
    page.locator('#play').tap()
    page.wait_for_function('document.getElementById("status").textContent.includes("Победа")')
    assert 'выживания' in page.locator('#result').inner_text()
    assert page.locator('#play').is_disabled()
    page.locator('#reset').tap()
    assert page.locator('#result').is_hidden()
    page.locator('#play').tap()
    page.wait_for_function('document.getElementById("status").textContent.includes("Победа")')
    page.goto(url + '/dist/game/index.html?mission=example-region')
    page.locator('#play').tap()
    page.wait_for_function('document.getElementById("status").textContent.includes("Поражение")')
    assert 'Столкновение' in page.locator('#result').inner_text()
    page.goto(url + '/dist/game/index.html?mission=example-earth-return')
    assert 'Земля' in page.locator('#earth-clock-label').inner_text()
    page.screenshot(path=str(OUTPUT / 'earth-mission.png'))
    page.goto(url + '/dist/game/index.html')
    assert page.locator('#earth-clock-label').inner_text() == 'Опорные часы:'
    page.locator('#follow').tap()
    page.screenshot(path=str(OUTPUT / 'reference-clock.png'))
    print('PASS standalone mission Win/Lose, reason, Reset, repeat and clock labels', flush=True)
    assert not errors, errors
    browser.close()
server.shutdown()
print('Browser checks passed. Physical phone acceptance remains a separate check.')
