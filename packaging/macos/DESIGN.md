# macOS launcher

## Direction
Compact native utility for people managing the Suite modules. The menu bar is a
quick entry point; clicking the Dock icon opens the dashboard in dedicated Brave.
Keep the existing Dock artwork and web screens.

## Icon
- Four rounded tiles inside one rounded outline represent the four modules.
- Transparent SVG, 22 × 22 viewBox, displayed at 18 × 18 points; vector rendering
  supports Retina. Outer stroke: 1.5 units; inner tiles: 5 × 5 units.
- Monochrome template: macOS supplies the foreground for light/dark menu bars and
  selected/disabled states. No badge text, color background, gradients or animation.
- Tool tip uses the app's existing display name.

## Native presentation
- System menu typography and spacing, existing menu order and keyboard shortcuts.
- Regular activation policy and LSUIElement=false for both packaged variants.
- Dock remains available without a native window; reopen opens the dashboard once
  the existing backend readiness check has completed.

## Browser and states
- All launcher links use Brave with a persistent `Brave Profile` under the variant's
  Application Support directory. No copying from a personal Brave profile.
- First launch creates that directory; later launches reuse it.
- Missing Brave or a launch error shows a native actionable alert. The menu remains
  available for retry. Readiness, account automation and worker shutdown stay as-is.

## Acceptance and review
- Compile the launcher and run `tests/macos_launcher_checks.swift` with
  `-D LAUNCHER_TEST -parse-as-library`: variant-specific paths, literal arguments,
  and native SVG loading.
- Run `python -m unittest discover -s tests -p 'test_*.py'` for launcher wiring,
  packaging isolation and existing readiness/shutdown checks.
- Inspect the icon at 18-point/Retina sizes on light/dark surfaces. Native smoke
  test uses synthetic readiness data and a disposable support directory; verify
  regular activation and the actual Brave `--user-data-dir` process argument.
