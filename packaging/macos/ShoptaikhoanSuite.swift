import AppKit
import Foundation

enum SuiteBrowser {
    static func profileURL(applicationSupport: URL, supportName: String) -> URL {
        applicationSupport.appendingPathComponent(supportName, isDirectory: true)
            .appendingPathComponent("Brave Profile", isDirectory: true)
    }

    static func arguments(profile: URL, url: URL) -> [String] {
        ["--user-data-dir=\(profile.path)", "--no-first-run", "--no-default-browser-check", "--new-window", url.absoluteString]
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let port = Bundle.main.object(forInfoDictionaryKey: "SuiteHubPort") as? Int ?? 5050
    private let supportName = Bundle.main.object(forInfoDictionaryKey: "SuiteSupportName") as? String ?? "Shoptaikhoan Suite"
    private let isReact = Bundle.main.object(forInfoDictionaryKey: "SuiteReactMode") as? Bool ?? false
    private var dashboardURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }
    private var hubProcess: Process?
    private var ownsHub = false
    private var statusItem: NSStatusItem?
    private var dashboardReady = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let iconURL = Bundle.main.url(forResource: "MenuBarTemplate", withExtension: "svg"),
           let icon = NSImage(contentsOf: iconURL) {
            icon.isTemplate = true
            icon.size = NSSize(width: 18, height: 18)
            item.button?.image = icon
        } else {
            item.button?.title = "ST"
        }
        item.button?.toolTip = supportName
        let menu = NSMenu()
        let open = NSMenuItem(title: "Mở giao diện", action: #selector(openDashboard), keyEquivalent: "o")
        open.target = self
        menu.addItem(open)
        menu.addItem(.separator())
        for (title, address) in [
            ("2FA & Password", "http://twofa.localhost:5050/"),
            ("Codex Export", "http://export.localhost:5050/"),
            ("Browser Login & 9Router", "http://browser.localhost:5050/"),
            ("Chat Backup", "http://backup.localhost:5050/")
        ] {
            let tool = NSMenuItem(title: title, action: #selector(openTool(_:)), keyEquivalent: "")
            tool.target = self
            if isReact {
                let key = address.contains("twofa.") ? "twofa" : address.contains("export.") ? "export" : address.contains("browser.") ? "browser" : "chat-backup"
                tool.representedObject = URL(string: "\(dashboardURL.absoluteString)#/workspace/\(key)")!
            } else {
                tool.representedObject = URL(string: address)!
            }
            menu.addItem(tool)
        }
        menu.addItem(.separator())
        let close = NSMenuItem(title: "Đóng toàn bộ tab Chrome của tool", action: #selector(closeToolWindows(_:)), keyEquivalent: "")
        close.target = self
        menu.addItem(close)
        // The close action disables itself while its asynchronous request runs.
        menu.autoenablesItems = false
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Thoát \(supportName)", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        statusItem = item
        ensureHub()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if dashboardReady { openDashboard() }
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        guard ownsHub, let process = hubProcess, process.isRunning else { return }
        var request = URLRequest(url: dashboardURL.appendingPathComponent("api/shutdown"))
        request.httpMethod = "POST"
        request.timeoutInterval = 2
        let semaphore = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { _, _, _ in semaphore.signal() }.resume()
        _ = semaphore.wait(timeout: .now() + 2)
        let shutdownWait = isReact ? 250 : 30
        for _ in 0..<shutdownWait where process.isRunning { Thread.sleep(forTimeInterval: 0.1) }
        if process.isRunning { process.terminate() }
        process.waitUntilExit()
    }

    private func ensureHub() {
        checkHealth { [weak self] ready in
            guard let self else { return }
            DispatchQueue.main.async {
                if ready { self.dashboardReady = true; self.openDashboard(); return }
                do { try self.startHub(); self.waitForHub(attempt: 0) }
                catch { self.showError(error.localizedDescription) }
            }
        }
    }

    private func startHub() throws {
        guard let resources = Bundle.main.resourceURL,
              let hub = Bundle.main.url(forResource: "shoptaikhoan-suite-hub", withExtension: nil, subdirectory: "bin")
        else { throw NSError(domain: "ShoptaikhoanSuite", code: 1, userInfo: [NSLocalizedDescriptionKey: "Thiếu thành phần chạy của Suite."]) }

        let engines = resources.appendingPathComponent("engines", isDirectory: true)
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent(supportName, isDirectory: true)
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        let logURL = support.appendingPathComponent("suite.log")
        if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
        let log = try FileHandle(forWritingTo: logURL)
        try log.seekToEnd()

        var env = ProcessInfo.processInfo.environment
        env["SHOPTAIKHOAN_SUITE_DATA_DIR"] = support.appendingPathComponent("runtime", isDirectory: true).path
        env["SHOPTAIKHOAN_SUITE_TWOFA_EXECUTABLE"] = engines.appendingPathComponent("TwoFA.app/Contents/MacOS/Shoptaikhoan Tool").path
        env["SHOPTAIKHOAN_SUITE_EXPORT_EXECUTABLE"] = engines.appendingPathComponent("GPT-Tool.app/Contents/MacOS/GPT-Tool").path
        env["SHOPTAIKHOAN_SUITE_BROWSER_EXECUTABLE"] = engines.appendingPathComponent("BrowserLogin.app/Contents/Resources/bin/shoptaikhoan-server").path
        env["SHOPTAIKHOAN_SUITE_CHAT_BACKUP_EXECUTABLE"] = engines.appendingPathComponent("chat-backup-server").path
        env["SHOPTAIKHOAN_AUTO_LOGIN_EXECUTABLE"] = engines.appendingPathComponent("BrowserLogin.app/Contents/Resources/bin/shoptaikhoan-auto-login").path
        env["PLAYWRIGHT_BROWSERS_PATH"] = engines.appendingPathComponent("BrowserLogin.app/Contents/Resources/ms-playwright", isDirectory: true).path
        env["SHOPTAIKHOAN_NO_MENU_BAR"] = "1"

        let process = Process()
        process.executableURL = hub
        process.arguments = ["--no-browser"]
        if isReact { process.arguments! += ["--port", String(port), "--data-dir", env["SHOPTAIKHOAN_SUITE_DATA_DIR"]!] }
        process.currentDirectoryURL = resources
        process.environment = env
        process.standardOutput = log
        process.standardError = log
        try process.run()
        hubProcess = process
        ownsHub = true
    }

    private func waitForHub(attempt: Int) {
        if let process = hubProcess, !process.isRunning {
            showError("Backend đã dừng. Kiểm tra cổng \(port) và log tại ~/Library/Application Support/\(supportName)/suite.log")
            return
        }
        guard attempt < 160 else { showError("App không khởi động sau 40 giây. Xem log tại ~/Library/Application Support/\(supportName)/suite.log"); return }
        checkHealth { [weak self] ready in
            guard let self else { return }
            DispatchQueue.main.async {
                if ready { self.dashboardReady = true; self.openDashboard() }
                else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForHub(attempt: attempt + 1) } }
            }
        }
    }

    private func checkHealth(completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: dashboardURL.appendingPathComponent("api/status"))
        request.timeoutInterval = 1
        let expectedVariant = isReact ? Bundle.main.bundleIdentifier : nil
        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  expectedVariant == nil || http.value(forHTTPHeaderField: "X-Shoptaikhoan-Variant") == expectedVariant,
                  let data,
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let modules = payload["modules"] as? [[String: Any]],
                  !modules.isEmpty
            else { completion(false); return }
            completion(modules.allSatisfy { $0["ready"] as? Bool == true })
        }.resume()
    }

    private func showError(_ message: String, title: String = "Không thể mở Shoptaikhoan Suite") {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.alertStyle = .critical; alert.runModal()
    }

    private func openInBrave(_ url: URL) {
        guard let brave = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.brave.Browser") else {
            showError("Hãy cài Brave Browser rồi chọn Mở giao diện để thử lại. Profile riêng của tool được lưu độc lập với Brave cá nhân.", title: "Không tìm thấy Brave Browser")
            return
        }
        do {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let profile = SuiteBrowser.profileURL(applicationSupport: support, supportName: supportName)
            try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let configuration = NSWorkspace.OpenConfiguration()
            // A separate instance is required when personal Brave is already running.
            configuration.createsNewApplicationInstance = true
            configuration.arguments = SuiteBrowser.arguments(profile: profile, url: url)
            NSWorkspace.shared.openApplication(at: brave, configuration: configuration) { [weak self] _, error in
                if let error {
                    DispatchQueue.main.async { self?.showError(error.localizedDescription, title: "Không thể mở Brave Browser") }
                }
            }
        } catch { showError(error.localizedDescription, title: "Không thể tạo profile Brave riêng") }
    }

    @objc private func openDashboard() { openInBrave(dashboardURL) }
    @objc private func openTool(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        openInBrave(url)
    }

    @objc private func closeToolWindows(_ sender: NSMenuItem) {
        guard sender.isEnabled else { return }
        let title = sender.title
        sender.isEnabled = false
        sender.title = "Đang đóng tab Chrome…"
        var request = URLRequest(url: dashboardURL.appendingPathComponent("api/windows/close"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            let payload = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let succeeded = (response as? HTTPURLResponse)?.statusCode == 200 && payload?["closed"] is NSNumber
            DispatchQueue.main.async {
                sender.isEnabled = true
                if succeeded {
                    let count = (payload?["closed"] as? NSNumber)?.intValue ?? 0
                    sender.title = count > 0 ? "Đã đóng các tab Chrome của tool" : "Không có tab tool đang mở"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { sender.title = title }
                } else {
                    sender.title = title
                    self?.showError(error?.localizedDescription ?? "Hãy kiểm tra Suite đang chạy.", title: "Không thể đóng tab Chrome của tool")
                }
            }
        }.resume()
    }
    @objc private func quitApp() { NSApplication.shared.terminate(nil) }
}

#if !LAUNCHER_TEST
@main
struct SuiteLauncher {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}
#endif
