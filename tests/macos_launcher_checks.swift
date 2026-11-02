import AppKit
import Foundation

@main
struct LauncherChecks {
    static func main() throws {
        let root = URL(fileURLWithPath: "/tmp/launcher check with spaces", isDirectory: true)
        let suite = SuiteBrowser.profileURL(applicationSupport: root, supportName: "Shoptaikhoan Suite")
        let react = SuiteBrowser.profileURL(applicationSupport: root, supportName: "Shoptaikhoan React Test")
        precondition(suite.path == root.path + "/Shoptaikhoan Suite/Brave Profile")
        precondition(suite != react)
        let page = URL(string: "http://127.0.0.1:5250/#/workspace/chat-backup")!
        let arguments = SuiteBrowser.arguments(profile: react, url: page)
        precondition(arguments == ["--user-data-dir=" + react.path,
                                  "--no-first-run", "--no-default-browser-check", "--new-window", page.absoluteString])
        precondition(!arguments.contains { $0.contains("remote-debugging") || $0.contains("disable-web-security") })
        let iconPath = CommandLine.arguments[1]
        guard let image = NSImage(contentsOfFile: iconPath) else { fatalError("Invalid status icon") }
        image.isTemplate = true
        image.size = NSSize(width: 18, height: 18)
        precondition(image.isTemplate && image.isValid)
        print("PASS: persistent variant-specific Brave profile, literal arguments, template status icon")
    }
}
