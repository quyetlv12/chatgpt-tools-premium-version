"""Opt-in dashboard fixture; every request is intercepted, no account operations."""
import os
import unittest
from pathlib import Path
from urllib.parse import urlsplit

STATIC = Path(__file__).resolve().parents[1] / 'change 2fa community' / 'static'


@unittest.skipUnless(os.environ.get('TWOFA_BROWSER_TEST'), 'Explicit local browser fixture opt-in')
class BulkCombinedBrowserTests(unittest.TestCase):
    def test_selected_accounts_start_directly_and_toolbar_fits(self):
        from playwright.sync_api import sync_playwright

        jobs = [dict(id=f'fixture-{n}', email=f'account{n}@example.test', status='success',
            account_state='live', login_verified=True, mode='check_only', plan='plus',
            usage=None, payment_methods=[], created_at=n) for n in range(3)]
        starts, unexpected, errors = [], [], []

        def handle(route):
            request = route.request
            url = urlsplit(request.url)
            if url.hostname != '127.0.0.1':
                route.abort()
                return
            path = url.path
            if path == '/' or path.startswith('/assets/'):
                file = STATIC / ('index.html' if path == '/' else path.removeprefix('/assets/'))
                mime = {'.html': 'text/html', '.js': 'text/javascript',
                    '.css': 'text/css', '.svg': 'image/svg+xml'}.get(file.suffix, 'application/octet-stream')
                route.fulfill(body=file.read_bytes(), content_type=mime)
            elif path == '/api/bootstrap':
                route.fulfill(json=dict(token='synthetic-token', jobs=jobs, settings={'twofa.max_concurrent': 2}))
            elif path == '/api/live-journals':
                route.fulfill(json={'journals': []})
            elif path == '/api/combined':
                route.fulfill(json={'operations': []})
            elif path == '/api/password-settings':
                route.fulfill(json={'configured': False})
            elif path.endswith('/output'):
                route.fulfill(body='', content_type='text/plain')
            elif path.endswith('/combined/start') and request.method == 'POST':
                starts.append((path, request.post_data_json))
                job_id = path.split('/')[3]
                # Terminal fixtures avoid background polling and all real mutation.
                route.fulfill(json=dict(id=f'op-{job_id}', job_id=job_id, status='success'))
            else:
                unexpected.append((request.method, path))
                route.fulfill(status=404, json={'detail': 'Unexpected fixture request'})

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel='chrome', headless=True)
            try:
                page = browser.new_page(viewport={'width': 2010, 'height': 1000})
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('**/*', handle)
                page.add_init_script('window.EventSource = class { close(){} };')
                page.goto('http://127.0.0.1:54321/')
                page.locator('#job-list tr').first.wait_for()
                button = page.locator('#change-selected')
                self.assertFalse(button.is_visible())
                page.locator('#select-all-logout').check()
                self.assertTrue(button.is_enabled())
                self.assertEqual(button.locator('span').inner_text(), 'Đổi 2FA + Logout')
                self.assertEqual(page.locator('#change-selected-count').inner_text(), '3')
                self.assertIn('#ti-route', button.locator('use').get_attribute('href'))
                self.assertEqual(page.locator('[data-action="change-2fa"]').count(), 3)
                for width in (2010, 820, 390):
                    page.set_viewport_size({'width': width, 'height': 1000})
                    box = button.bounding_box()
                    self.assertGreaterEqual(box['x'], 0)
                    self.assertLessEqual(box['x'] + box['width'], width + 1)
                    self.assertGreaterEqual(box['height'], 24)
                    if os.environ.get('TWOFA_COMBINED_SCREENSHOT_DIR'):
                        page.locator('#queue').screenshot(path=str(Path(os.environ['TWOFA_COMBINED_SCREENSHOT_DIR']) / f'combined-{width}.png'))
                button.click()
                page.wait_for_function("document.getElementById('change-selected').hidden")
                self.assertEqual(sorted(path for path, _ in starts),
                    [f'/api/jobs/fixture-{n}/combined/start' for n in range(3)])
                self.assertTrue(all(body == {'confirm': 'START_COMBINED'} for _, body in starts))
                self.assertEqual(page.locator('dialog[open]').count(), 0)
                self.assertEqual(unexpected, [])
                self.assertEqual(errors, [])
            finally:
                browser.close()
