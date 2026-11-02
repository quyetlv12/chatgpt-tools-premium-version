"""Isolation and static-serving gates for the separate React copy."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

import suite

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('react_launcher', ROOT / 'run-react.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class ReactCopyTests(unittest.TestCase):
    def test_original_hashes_and_git_status_unchanged(self):
        baseline = json.loads((ROOT / 'migration/source-baseline.json').read_text())
        source = Path(baseline['source'])
        for name, digest in baseline['files'].items():
            self.assertEqual(hashlib.sha256((source / name).read_bytes()).hexdigest(), digest, name)
        self.assertEqual(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip(), baseline['head'])
        self.assertEqual(subprocess.check_output(['git', 'status', '--short'], cwd=source, text=True), baseline['status'])

    def test_account_workflow_files_match_source_baseline(self):
        baseline = json.loads((ROOT / 'migration/source-baseline.json').read_text())
        # Keep original hashes immutable; pin only reviewed independent workflow deltas.
        overrides = json.loads((ROOT / 'migration/workflow-overrides.json').read_text())['files']
        self.assertEqual(set(overrides), {
            'modules/twofa/mfa_phase.py',
            'modules/twofa/session_phase.py',
            'modules/twofa/change 2fa community/server.py',
            'modules/twofa/change 2fa community/service.py',
            'modules/twofa/change 2fa community/jobs.py',
            'modules/twofa/db/repositories.py',
            'modules/twofa/AGENTS.md', 'modules/twofa/docs/TOOL-FLOW.md',
            'modules/twofa/tests/test_twofa_history.py',
            'modules/twofa/tests/test_mysql_sync.py',
            'modules/twofa/tests/test_passkey_feature.py',
            'modules/twofa/tests/test_combined_jobs.py',
            'modules/twofa/tests/test_filtered_export.py',
            'modules/twofa/tests/test_filtered_export_api.py',
        })
        presentation_files = {'modules/twofa/change 2fa community/static/dashboard.css'}
        for name, digest in baseline['files'].items():
            if name.startswith('modules/twofa/') and name not in presentation_files:
                content = (ROOT / name).read_bytes()
                if name in overrides:
                    self.assertEqual(overrides[name]['source_sha256'], digest, name)
                    digest = overrides[name]['react_sha256']
                self.assertEqual(hashlib.sha256(content).hexdigest(), digest, name)

    def test_launcher_replaces_inherited_runtime_and_executables(self):
        with patch.dict(os.environ, {'SHOPTAIKHOAN_SUITE_DATA_DIR': '/original',
                'SHOPTAIKHOAN_SUITE_TWOFA_EXECUTABLE': '/original/engine',
                'SHOPTAIKHOAN_AUTO_LOGIN_EXECUTABLE': '/original/login'}):
            launcher.configure_environment()
            modules = suite.build_modules(ROOT, port=launcher.PORT)
            self.assertNotIn('SHOPTAIKHOAN_SUITE_TWOFA_EXECUTABLE', os.environ)
            self.assertNotIn('SHOPTAIKHOAN_AUTO_LOGIN_EXECUTABLE', os.environ)
            self.assertEqual(os.environ['SHOPTAIKHOAN_KEYCHAIN_SERVICE'], 'com.shoptaikhoan.react-dev.sub2api')
            self.assertEqual(os.environ['NINE_ROUTER_DATA_DIR'], str(ROOT / 'runtime-react/nine-router'))
            self.assertTrue(all(module.socket_path.is_relative_to(ROOT / 'runtime-react') for module in modules))
            self.assertEqual(modules[0].command[-3:], ('--port', '5150', '--no-browser'))
            urls = [value for module in modules for value in module.env.values() if value.startswith('http')]
            self.assertTrue(all('.localhost:5150' in url for url in urls))

    def test_runtime_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'runtime-react').symlink_to(root / 'outside', target_is_directory=True)
            with patch.object(launcher, 'ROOT', root), patch.object(launcher, 'RUNTIME', root / 'runtime-react'):
                with self.assertRaises(RuntimeError):
                    launcher.configure_environment()

    def test_hashed_assets_and_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'assets').mkdir()
            (root / 'index.html').write_text('<main>React</main>')
            (root / 'assets/index-hash.js').write_text('export {}')
            (root / 'private.txt').write_text('synthetic')
            server = suite.create_hub_server('127.0.0.1', 0, suite.SuiteManager(()), root)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base + '/assets/index-hash.js') as response:
                    self.assertIn('javascript', response.headers['Content-Type'])
                    self.assertEqual(response.read(), b'export {}')
                with self.assertRaises(HTTPError) as caught:
                    urlopen(base + '/assets/../private.txt')
                self.assertEqual(caught.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
