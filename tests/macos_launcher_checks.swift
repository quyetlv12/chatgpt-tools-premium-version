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
        let processArguments = ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "--user-data-dir=" + react.path]
        precondition(SuiteBrowser.usesProfile(processArguments, profile: react))
        precondition(!SuiteBrowser.usesProfile(processArguments, profile: suite))
        precondition(!SuiteBrowser.usesProfile(["--user-data-dir=" + react.path + " old"], profile: react))
        var processBytes = withUnsafeBytes(of: Int32(2)) { Array($0) }
        processBytes += Array("/executable\0\0".utf8)
        processBytes += Array(processArguments.joined(separator: "\0").utf8) + [0]
        processBytes += Array("SECRET_ENV=never an argument\0".utf8)
        precondition(SuiteBrowser.decodeArguments(processBytes) == processArguments)
        precondition(SuiteBrowser.decodeArguments([0, 1]) == [])
        let pid: pid_t = 42
        func window(_ owner: pid_t, width: Int, height: Int, layer: Int = 0) -> [String: Any] {
            [kCGWindowOwnerPID as String: owner, kCGWindowLayer as String: layer,
             kCGWindowBounds as String: ["X": -1500, "Y": 0, "Width": width, "Height": height]]
        }
        precondition(SuiteBrowser.hasWindow(pid: pid, windows: [window(pid, width: 900, height: 700)]))
        precondition(!SuiteBrowser.hasWindow(pid: pid, windows: [window(43, width: 900, height: 700)]))
        precondition(!SuiteBrowser.hasWindow(pid: pid, windows: [window(pid, width: 1, height: 1), window(pid, width: 2048, height: 117)]))
        precondition(!SuiteBrowser.hasWindow(pid: pid, windows: [window(pid, width: 900, height: 700, layer: 8)]))
        precondition(!SuiteBrowser.hasWindow(pid: pid, windows: []))
        let iconPath = CommandLine.arguments[1]
        guard let image = NSImage(contentsOfFile: iconPath) else { fatalError("Invalid status icon") }
        image.isTemplate = true
        image.size = NSSize(width: 18, height: 18)
        precondition(image.isTemplate && image.isValid)
        print("PASS: isolated Brave profile, exact argv parsing, window ownership/filtering, literal launch arguments, status icon")
    }
}
