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
        if self.path == '/levels/mission-examples.json':
            # Authored input fixture for long-text and unmet-entry UI checks.
            # Serve it only in the test server, never mutate live game state.
            levels = json.loads((ROOT / 'levels/mission-examples.json').read_text())
            fixture = json.loads(json.dumps(levels[1]))
            fixture.update(id='test-long-ui', title='Проверка длинного задания',
                           description='Длинное задание для проверки прокрутки. ' * 30)
            fixture['universe']['bodies'] = []
            fixture['universe']['ship'].update(x=-10, y=0.5, vx=20, vy=0, r=0.1)
            fixture['universe']['earthClock'] = dict(kind='inertial', x=100, y=100, vx=0, vy=0)
            fixture['universe']['physics'].update(gravity=0, maxStep=0.01, timeScale=1)
            fixture['mission'] = dict(type='arrival', maxCoordinateYears=300,
                target=dict(centre=dict(kind='fixed', x=0, y=0), radius=3),
                limits=dict(shipYears=dict(min=100), relativeSpeed=dict(max=9)))
            levels.append(fixture)
            navigation = json.loads(json.dumps(fixture))
            navigation.update(id='test-navigation', title='Проверка камеры в полёте', description='Длительный полёт для проверки ручной камеры.')
            navigation['mission'] = dict(type='arrival', maxCoordinateYears=100000,
                target=dict(centre=dict(kind='fixed', x=100000000, y=0), radius=3), limits={})
            levels.append(navigation)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(levels).encode())
        elif self.path == '/src/main.js':
            source = (ROOT / 'src/main.js').read_text().replace('let last = 0;', '''
            globalThis.inspectGame = () => ({configuration: game.configuration,
              simulation: game.simulation, camera: game.camera,
              tutorial: game.tutorial, drag: input.state.drag, pointers: input.state.pointers.size});
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
          const ids = ['play','follow','info','tray-toggle','clocks','stage','controls'];
          const nodes = ids.map(id => document.getElementById(id));
          return nodes.map(n => {const r = n.getBoundingClientRect(); return {
            id:n.id || n.dataset.type, x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};});
        }''')
        for box in boxes:
            assert box['x'] >= -0.1 and box['y'] >= -0.1, box
            assert box['right'] <= width + 0.1 and box['bottom'] <= height + 0.1, box
            if box['id'] in ['follow', 'play', 'info', 'tray-toggle']:
                assert box['width'] >= 44 and box['height'] >= 44, box
        # Controls must remain separate, not merely have on-screen bounding boxes.
        buttons = boxes[:2]
        for a, b in zip(buttons, buttons[1:]):
            assert a['right'] <= b['x'], (a, b)
        stage = next(b for b in boxes if b['id'] == 'stage')
        tray = next(b for b in boxes if b['id'] == 'controls')
        assert stage['height'] >= 100 and stage['bottom'] <= tray['y'], boxes
        assert page.evaluate('getComputedStyle(document.querySelector("canvas")).touchAction') == 'none'
        assert page.evaluate('document.documentElement.scrollWidth') <= width
        assert page.locator('#controls button').count() == 2
        assert page.locator('#play-label').inner_text() == 'Пуск'
        assert page.locator('#follow').inner_text().endswith('К кораблю')
        assert page.locator('#tray').is_visible()
        assert page.locator('#trayText').is_hidden()
        assert page.locator('#tray').bounding_box()['height'] <= 100
        assert page.locator('#mission-panel').is_hidden()
        info_box = page.locator('#info').bounding_box()
        assert info_box['y'] < height / 2
        assert info_box['x'] + info_box['width'] >= width - 15
        for selector in ['#play', '#follow']:
            box = page.locator(selector).bounding_box()
            assert box['width'] >= 60 and box['height'] >= 60
            assert box['y'] > height / 2
        page.screenshot(path=str(OUTPUT / f'{width}x{height}.png'))
        for card in page.locator('.card').all():
            box = card.bounding_box()
            assert box['width'] >= 44 and box['height'] >= 44
            assert box['y'] >= 0 and box['y'] + box['height'] <= height
        page.screenshot(path=str(OUTPUT / f'drawer-{width}x{height}.png'))
        page.locator('#tray-toggle').tap()
        assert page.locator('#tray').is_hidden()
        assert page.locator('#tray-toggle').is_visible()
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

    before_ui = state()
    page.locator('#info').tap()
    page.locator('#info').tap()
    assert state()['simulation'] == before_ui['simulation']
    assert state()['camera'] == before_ui['camera']
    page.locator('#tray-toggle').tap()
    assert page.locator('#trayText').is_hidden()
    touch('touchStart', 1, centre('[data-type=planet]'))
    touch('touchMove', 1, at(-350, -140))
    assert page.locator('#trayText').is_visible()
    assert page.locator('#trayText').evaluate('(n) => getComputedStyle(n).pointerEvents') == 'none'
    page.screenshot(path=str(OUTPUT / 'tray-drag-hint.png'))
    touch('touchEnd', 1)
    assert page.locator('#trayText').is_hidden()
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
    assert page.locator('#trayText').is_hidden()
    zoom = state()['camera']['zoom']
    touch('touchMove', 2, [340, 420])
    assert state()['camera']['zoom'] != zoom
    touch('touchEnd', 2)
    touch('touchEnd', 1)
    assert state()['configuration'] == before
    assert page.evaluate('visualViewport.scale') == 1, 'pinch must zoom the game, not the page'
    # The tray's own handle folds down and pulls up, independently of physics.
    before_handle = state()['configuration']
    hx, hy = centre('#tray-toggle')
    drag([hx,hy], [hx,hy+75])
    assert page.locator('#tray').is_hidden()
    hx, hy = centre('#tray-toggle')
    drag([hx,hy], [hx,hy-75])
    assert page.locator('#tray').is_visible()
    hx, hy = centre('#tray-toggle')
    touch('touchStart',1,[hx,hy])
    touch('touchMove',1,[hx,hy+75])
    cdp.send('Input.dispatchTouchEvent', {'type':'touchCancel','touchPoints':[]})
    fingers.clear()
    assert page.locator('#tray').is_visible()
    assert state()['configuration'] == before_handle
    # Other dock buttons must not delete, move or reset the body on drop.
    before_dock_drop = state()['configuration']
    drag(at(-310, -120), centre('#play'))
    assert state()['configuration'] == before_dock_drop
    assert state()['simulation']['status'] == 'ready'
    # Returning the planet to the tray removes it; it can be placed again.
    page.locator('#tray-toggle').tap()
    drag(at(-310, -120), centre('#tray-toggle'))
    assert not state()['configuration']['placed']
    page.locator('#tray-toggle').tap()
    drag(centre('[data-type=planet]'), at(-350, -140))
    assert len(state()['configuration']['placed']) == 1
    initial = state()['configuration']
    page.locator('#play').tap()
    page.wait_for_function('inspectGame().simulation.shipYears > 0')
    assert state()['camera']['follow'] is True
    assert page.locator('#play-label').inner_text() == 'Сброс'
    page.locator('#follow').tap()
    page.locator('#follow').tap()
    assert state()['camera']['follow'] is True
    page.screenshot(path=str(OUTPUT / 'flight-controls.png'))
    page.locator('#play').tap()
    assert state()['simulation']['status'] == 'ready'
    assert state()['simulation']['shipYears'] == 0
    assert page.locator('#play-label').inner_text() == 'Пуск'
    assert state()['configuration'] == initial
    page.locator('#play').tap()
    page.wait_for_function('inspectGame().simulation.shipYears > 0')
    page.locator('#play').tap()
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
    page.goto(url + '/?mission=test-navigation')
    page.wait_for_function('typeof inspectGame === "function"')
    initial = state()['configuration']
    page.locator('#play').tap()
    page.wait_for_function('inspectGame().simulation.shipYears > 0')
    # Navigation mode: tap keeps tracking, drag takes over while flight continues.
    page.touchscreen.tap(100,220)
    assert state()['camera']['follow'] is True
    drag([100,220],[180,260])
    manual = state()
    assert manual['camera']['follow'] is False
    assert manual['configuration'] == initial
    assert manual['simulation']['status'] == 'running'
    page.wait_for_timeout(80)
    assert state()['camera'] == manual['camera'], 'manual camera must not drift back to ship'
    assert state()['simulation']['shipYears'] > manual['simulation']['shipYears']
    page.screenshot(path=str(OUTPUT / 'manual-flight-camera.png'))
    # Pinch and the remaining finger pan only the camera.
    touch('touchStart',1,[120,220])
    touch('touchStart',2,[220,220])
    zoom = state()['camera']['zoom']
    touch('touchMove',2,[260,220])
    assert state()['camera']['zoom'] > zoom
    touch('touchEnd',2)
    touch('touchMove',1,[130,230])
    touch('touchEnd',1)
    assert state()['configuration'] == initial
    page.locator('#follow').tap()
    assert state()['camera']['follow'] is True
    page.mouse.move(150,220)
    page.mouse.wheel(0,100)
    page.wait_for_timeout(40)
    assert state()['camera']['follow'] is False
    page.locator('#follow').tap()
    assert state()['camera']['follow'] is True
    assert state()['simulation']['status'] == 'running'
    page.screenshot(path=str(OUTPUT / 'flight-controls.png'))
    page.locator('#play').tap()
    assert state()['simulation']['status'] == 'ready'
    assert state()['simulation']['shipYears'] == 0
    assert state()['configuration'] == initial
    print('PASS running navigation: manual pan/pinch/wheel, clocks continue, resume follow and Reset', flush=True)
    page.goto(url + '/dist/game/index.html')
    page.locator('#play').tap()
    page.wait_for_function('Number(document.getElementById("ship-time").textContent) > 0')
    page.locator('#play').tap()
    assert page.locator('#ship-time').inner_text() == '0.00'
    print('PASS standalone HTML Play and Reset', flush=True)
    # Mission examples are embedded into the same standalone HTML, without fetches.
    page.goto(url + '/dist/game/index.html?mission=example-survival')
    assert page.locator('#mission-panel').is_hidden()
    page.locator('#info').tap()
    assert page.locator('#mission').is_visible()
    assert page.locator('#earth-clock').is_hidden()
    assert page.locator('#ship-clock').is_visible()
    page.locator('#play').tap()
    page.wait_for_function('document.getElementById("status").textContent.includes("Победа")')
    box = page.locator('#outcome-overlay').bounding_box()
    assert box['x'] == 0 and box['y'] == 0
    assert box['width'] == 844 and box['height'] == 390
    page.screenshot(path=str(OUTPUT / 'fullscreen-win.png'))
    # Dismissing directly over Reset must not reset the simulation underneath.
    page.touchscreen.tap(*centre('#play'))
    assert 'Победа' in page.locator('#status').inner_text()
    assert page.locator('#play-label').inner_text() == 'Сброс'
    assert page.locator('#play').is_enabled()
    page.locator('#info').tap()
    assert 'выживания' in page.locator('#result').inner_text()
    assert page.locator('#play-label').inner_text() == 'Сброс'
    assert page.locator('#play').is_enabled()
    page.locator('#play').tap()
    assert page.locator('#result').is_hidden()
    page.locator('#play').tap()
    page.wait_for_function('document.getElementById("status").textContent.includes("Победа")')
    page.locator('#outcome-overlay').tap()
    page.goto(url + '/dist/game/index.html?mission=example-region')
    page.locator('#play').tap()
    page.wait_for_function('document.getElementById("status").textContent.includes("Поражение")')
    page.locator('#outcome-overlay').tap()
    page.locator('#info').tap()
    assert 'Столкновение' in page.locator('#result').inner_text()
    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(url + '/dist/game/index.html?mission=example-earth-return')
    assert page.locator('#earth-clock').is_visible()
    assert page.locator('#ship-clock').is_visible()
    assert 'Земля' in page.locator('#earth-clock-label').inner_text()
    page.screenshot(path=str(OUTPUT / 'earth-mission.png'))
    page.goto(url + '/dist/game/index.html')
    assert page.locator('#earth-clock').is_hidden()
    assert page.locator('#ship-clock').is_visible()
    page.locator('#follow').tap()
    page.locator('#follow').tap()
    page.screenshot(path=str(OUTPUT / 'ship-only-clock.png'))
    print('PASS standalone mission Win/Lose, reason, Reset, repeat and clock labels', flush=True)
    for width, height in [(320, 568), (390, 844), (844, 390), (1280, 720)]:
        page.set_viewport_size(dict(width=width, height=height))
        for mission in ['example-survival', 'example-speed-time', 'example-earth-return']:
            page.goto(url + '/dist/game/index.html?mission=' + mission)
            assert page.locator('#mission-panel').is_hidden()
            page.locator('#info').tap()
            assert page.locator('#mission-panel').is_visible()
            assert page.locator('#earth-clock').is_visible() == (mission == 'example-earth-return')
            for selector in ['#play', '#follow', '#tray-toggle', '#mission-panel']:
                box = page.locator(selector).bounding_box()
                assert box['x'] >= 0 and box['y'] >= 0, (selector, box)
                assert box['x'] + box['width'] <= width + 0.1, (selector, box)
                assert box['y'] + box['height'] <= height + 0.1, (selector, box)
            assert page.locator('#stage').bounding_box()['height'] >= 100
            assert page.evaluate('document.documentElement.scrollWidth') <= width
            page.locator('#mission-body').evaluate('(n) => n.scrollTop = n.scrollHeight')
            assert page.locator('#units-note').is_visible()
            page.screenshot(path=str(OUTPUT / f'mission-{mission}-{width}x{height}.png'))
            page.locator('#info').tap()
            assert page.locator('#conditions').is_hidden()
            assert page.locator('#stage').bounding_box()['height'] >= 100
            page.locator('#play').tap()
            page.locator('#play').tap()
        print(f'PASS mission panels, scrolling and controls {width}x{height}', flush=True)
    page.set_viewport_size(dict(width=390, height=844))
    page.goto(url + '/?mission=test-long-ui')
    page.wait_for_function('typeof inspectGame === "function"')
    page.locator('#info').tap()
    assert page.locator('#mission-body').evaluate('(n) => n.scrollHeight > n.clientHeight')
    page.locator('#mission-body').evaluate('(n) => n.scrollTop = n.scrollHeight')
    assert '≤ 9' in page.locator('#conditions').inner_text()
    page.locator('#info').tap()
    page.locator('#play').tap()
    page.wait_for_function('document.getElementById("mission-feedback").textContent.includes("Корабль в области")')
    assert page.locator('#result').is_hidden()
    feedback = page.locator('#mission-feedback').text_content()
    assert 'Полёт продолжается' in feedback
    assert 'Часы корабля' in feedback
    assert 'Скорость относительно цели' in feedback
    page.wait_for_function('inspectGame().simulation.status === "lose"')
    assert page.locator('#mission-panel').is_hidden()
    assert page.locator('#outcome-overlay').is_visible()
    page.wait_for_function('document.getElementById("outcome-overlay").hidden')
    assert state()['simulation']['status'] == 'lose'
    assert page.locator('#play-label').inner_text() == 'Сброс'
    assert page.locator('#play').is_enabled()
    page.locator('#info').tap()
    assert page.locator('#result').is_visible()
    assert 'На момент завершения' in page.locator('#result').inner_text()
    assert page.locator('#earth-clock').is_hidden()
    page.screenshot(path=str(OUTPUT / 'long-mission-result.png'))
    page.locator('#play').tap()
    assert page.locator('#result').is_hidden()
    assert page.locator('#ship-time').inner_text() == '0.00'
    print('PASS long task scrolling, early/fast entry continues, terminal panel and Reset', flush=True)
    page.emulate_media(reduced_motion='reduce')
    page.goto(url + '/dist/game/index.html?mission=example-survival')
    page.locator('#play').tap()
    page.wait_for_function('document.getElementById("status").textContent.includes("Победа")')
    assert page.locator('#outcome-overlay').evaluate('(n) => getComputedStyle(n).transitionDuration') == '0s'
    page.wait_for_function('document.getElementById("outcome-overlay").hidden')
    assert page.locator('#play-label').inner_text() == 'Сброс'
    assert page.locator('#play').is_enabled()
    page.locator('#info').tap()
    assert 'Победа' in page.locator('#result').inner_text()
    print('PASS reduced motion keeps result after notification disappears', flush=True)
    # The first authored campaign level uses the same real touch UI and engine.
    page.goto(url + '/')
    page.locator('#info').tap()
    page.locator('#training-link').tap()
    page.wait_for_url('**/?mission=training-1')
    assert page.locator('#title').inner_text() == 'Первое вмешательство'
    for width,height in [(390,844),(844,390)]:
        page.set_viewport_size(dict(width=width,height=height))
        page.goto(url + '/?mission=training-1')
        page.wait_for_function('typeof inspectGame === "function"')
        assert page.locator('#title').inner_text() == 'Первое вмешательство'
        assert page.locator('.card:visible').count() == 0
        assert state()['tutorial']['stepIndex'] == 0
        assert page.locator('#earth-clock').is_hidden()
        assert page.locator('#mission-brief').is_visible()
        assert 'Выжить 500 лет по часам корабля без столкновения.' in page.locator('#mission-brief').inner_text()
        assert 'Пуск без планеты' in page.locator('#mission-brief').inner_text()
        brief = page.locator('#mission-brief').bounding_box()
        assert brief['y'] + brief['height'] <= page.locator('#tray-sheet').bounding_box()['y']
        page.locator('#info').tap()
        assert '500' in page.locator('#conditions').inner_text()
        page.locator('#info-close').tap()
        page.screenshot(path=str(OUTPUT / f'first-level-start-{width}x{height}.png'))
        page.locator('#play').tap()
        assert 'Наблюдайте за полётом' in page.locator('#mission-brief').inner_text()
        page.wait_for_function('inspectGame().simulation.status === "lose"')
        assert state()['simulation']['collisionId'] == 'helios'
        assert state()['tutorial']['stepIndex'] == 0
        assert page.locator('.card:visible').count() == 0
        page.locator('#outcome-overlay').tap()
        assert 'Нажмите Сброс' in page.locator('#mission-brief').inner_text()
        page.screenshot(path=str(OUTPUT / f'tutorial-collision-{width}x{height}.png'))
        page.locator('#info').tap()
        assert 'Гелиос' in page.locator('#result').inner_text()
        page.locator('#play').tap()
        page.locator('#info-close').tap()
        assert page.locator('#tray').is_visible()
        assert page.locator('#mission-brief').is_visible()
        assert state()['tutorial']['stepIndex'] == 1
        assert page.locator('.card:visible').count() == 1
        assert 'Перетащите планету' in page.locator('#mission-brief').inner_text()
        brief = page.locator('#mission-brief').bounding_box()
        assert brief['y'] + brief['height'] <= page.locator('#tray-sheet').bounding_box()['y']
        # The actual gesture goes through the instruction overlay without interception.
        touch('touchStart',1,centre('[data-type=planet]'))
        assert page.locator('#mission-brief').is_hidden()
        touch('touchMove',1,at(-110,-120))
        touch('touchEnd',1)
        assert len(state()['configuration']['placed']) == 1
        brief = page.locator('#mission-brief').bounding_box()
        px,py = at(-110,-120)
        assert not (brief['x'] <= px <= brief['x']+brief['width'] and brief['y'] <= py <= brief['y']+brief['height']), 'brief obscures the placed planet'
        placement = state()['configuration']
        page.screenshot(path=str(OUTPUT / f'first-level-placement-{width}x{height}.png'))
        page.locator('#play').tap()
        page.wait_for_function('inspectGame().simulation.status === "win"')
        assert abs(state()['simulation']['shipYears']-500) < 1e-8
        page.locator('#outcome-overlay').tap()
        page.locator('#info').tap()
        assert 'Победа' in page.locator('#result').inner_text()
        page.screenshot(path=str(OUTPUT / f'first-level-win-{width}x{height}.png'))
        page.locator('#play').tap()
        page.locator('#info-close').tap()
        assert state()['configuration'] == placement
        assert state()['simulation']['shipYears'] == 0
        assert state()['tutorial']['completed'] is True
        assert page.locator('.card:visible').count() == 1
        page.locator('#follow').tap()
        drag(at(-110,-120),at(-105,-120))
        assert abs(state()['configuration']['placed'][0]['x']+105) < 2
        if width == 390:
            page.locator('#play').tap()
            page.wait_for_function('inspectGame().simulation.status === "win"')
            page.locator('#outcome-overlay').tap()
            page.locator('#play').tap()
            page.locator('#follow').tap()
        drag(at(-105,-120),centre('#tray-toggle'))
        assert not state()['configuration']['placed']
        assert state()['tutorial']['stepIndex'] == 1
        print(f'PASS first campaign level: collision, one-planet Win, Reset, move, return {width}x{height}', flush=True)
    page.goto(url + '/dist/game/index.html?mission=training-1')
    assert page.locator('#title').inner_text() == 'Первое вмешательство'
    assert page.locator('.card:visible').count() == 0
    assert page.locator('#earth-clock').is_hidden()
    print('PASS authored campaign embedded into standalone HTML', flush=True)
    assert page.locator('#mission-brief').is_visible()
    assert 'Пуск без планеты' in page.locator('#mission-brief').inner_text()
    assert not errors, errors
    browser.close()
server.shutdown()
print('Browser checks passed. Physical phone acceptance remains a separate check.')
