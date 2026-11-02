"""Native menu wiring contracts; compile Swift separately on macOS."""
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SuiteMenuTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "packaging/macos/ShoptaikhoanSuite.swift").read_text()

    def test_four_tool_shortcuts_are_top_level_and_match_dashboard_urls(self):
        dashboard = (ROOT / "web/index.html").read_text()
        for name, host in (
            ("2FA & Password", "twofa"),
            ("Codex Export", "export"),
            ("Browser Login & 9Router", "browser"),
            ("Chat Backup", "backup"),
        ):
            url = f"http://{host}.localhost:5050/"
            self.assertIn(f'("{name}", "{url}")', self.source)
            self.assertIn(url, dashboard)
        self.assertIn('menu.addItem(tool)', self.source)
        self.assertNotIn('.submenu', self.source)
        self.assertNotIn('Đi tới tool', self.source)
        self.assertIn('#selector(openTool(_:))', self.source)
        self.assertIn('sender.representedObject as? URL', self.source)
        self.assertIn('openInBrave(url)', self.source)

    def test_both_variants_show_in_dock_and_share_the_template_icon(self):
        import plistlib
        for name in ("Info.plist", "ReactTest-Info.plist"):
            info = plistlib.loads((ROOT / "packaging/macos" / name).read_bytes())
            self.assertFalse(info["LSUIElement"])
        self.assertIn('app.setActivationPolicy(.regular)', self.source)
        self.assertIn('applicationShouldHandleReopen', self.source)
        self.assertIn('icon.isTemplate = true', self.source)
        script = (ROOT / "build-react-test-macos.sh").read_text()
        self.assertIn('"$ROOT/packaging/macos/MenuBarTemplate.svg" "$APP/Contents/Resources/MenuBarTemplate.svg"', script)

    def test_dashboard_and_module_shortcuts_use_dedicated_brave_profile(self):
        self.assertIn('openInBrave(dashboardURL)', self.source)
        self.assertIn('configuration.createsNewApplicationInstance = true', self.source)
        self.assertIn('NSWorkspace.shared.openApplication', self.source)
        self.assertNotIn('NSWorkspace.shared.open(', self.source)

    def test_close_action_reuses_suite_endpoint_without_confirmation_or_global_kill(self):
        action = self.source.split('@objc private func closeToolWindows', 1)[1].split('@objc private func quitApp', 1)[0]
        self.assertIn('#selector(closeToolWindows(_:))', self.source)
        self.assertIn('dashboardURL.appendingPathComponent("api/windows/close")', action)
        self.assertIn('request.httpMethod = "POST"', action)
        self.assertIn('URLSession.shared.dataTask', action)
        self.assertIn('sender.isEnabled = false', action)
        self.assertIn('sender.isEnabled = true', action)
        self.assertIn('statusCode == 200', action)
        self.assertIn('DispatchQueue.main.async', action)
        self.assertIn('menu.autoenablesItems = false', self.source)
        self.assertNotIn('runModal', action)
        self.assertNotIn('Process()', action)


if __name__ == '__main__':
    unittest.main()
