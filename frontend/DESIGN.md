# Premium Dark Navy — Tool Auto

## Direction

An operational desktop workspace for people managing many accounts and automation jobs. Calm navy layers, clear text, restrained electric blue actions and cyan activity. Account information and its action groups stay on the same table row. Keep the product name `shoptaikhoan`.

This brief implements the user's full Premium Dark Navy request. It supersedes the earlier brighter navy and all-white text experiments. OpenDesign is not configured in this workspace; the installed design-brief, frontend-design and design-review workflow is applied locally.

## Boundaries

UI only. Preserve APIs, data models, handlers, eligibility rules, polling/SSE, retained workspace state and every existing workflow. No backend changes or real account actions. Existing Radix dialogs/confirmation and Sonner notifications remain the common feedback components.

## Color tokens

| Role | Color |
|---|---|
| Main background | `#081426` |
| Sidebar / input | `#0D1D34` |
| Header | `#0B192D` |
| Card | `#122742` |
| Secondary surface | `#172F4D` |
| Hover | `#1D3557` |
| Active navigation | `#1D4ED8` |
| Border | `#263B59` |
| Primary action | `#2563EB` |
| Cyan / running | `#38BDF8` |
| Light blue | `#60A5FA` |
| Soft blue | `#1E40AF` |
| Main text | `#F1F5F9` |
| Secondary text | `#94A3B8` |
| Muted raw token | `#64748B` |
| Disabled text | `#475569` |
| Success | `#34D399` |
| Warning | `#FBBF24` |
| Error | `#FB7185` |
| Danger button | `#9F263D` |
| Success button token | `#059669` |
| Console | `#07111F` |

Semantic surfaces mix 10% status color into the card background, with 35% status borders. Status is also communicated by text and icons. Blue/cyan indicates primary work; green, amber and rose indicate outcome or caution. Disabled controls use neutral navy and disabled text.

### Accessibility adjustment

`#64748B` yields only about 3.16:1 on cards and 3.55:1 on inputs. Readable metadata, helper text and placeholders therefore use `#94A3B8` (about 5.87:1 / 6.59:1). The requested muted value remains a raw token for decorative use. Disabled text is exempt from normal text contrast requirements. Subtle borders separate surfaces; focus outlines use cyan/light blue, checked/selected controls use blue, and selection never depends on the subtle border alone.

## Typography

Self-hosted variable **Inter** (400–800) for UI and **JetBrains Mono** (400–700) for code, console, logs and structured account input. Both fonts include Vietnamese glyphs; source and OFL licenses are in `public/fonts/`.

| Role | Size / weight |
|---|---|
| Main heading | 30px desktop, 28px mobile / 700 |
| Section heading | 21px / 600 |
| Card title | 18px / 600 |
| Statistic | 32px / 700 |
| Body / controls / navigation | 15px / 400–600 |
| Table | 14–15px / 400–600 |
| Label | 14px / 500 |
| Caption | 13px / 400–500 |
| Log | 14px / 400 |

Heading line-height 1.25; body 1.6; table/button 1.4. No font weight below 400. Preserve numbered editor textarea/gutter font metrics and synchronized scrolling.

## Layout and components

- Horizontal header navigation at every width, following the user's layout correction. Desktop places the brand, navigation and utilities in one row. At 1100px and below, navigation occupies a second horizontal row inside the header and scrolls locally when needed.
- Main content fills the page width. Workspace container queries collapse forms when their usable width gets narrow.
- Card padding 16–20px, gaps 16–24px, radius 12px, subtle shadow. Control radius 8–10px.
- Tables scroll within their own container. TwoFA account/action columns remain adjacent and aligned. Statistic cards use 32px numbers; small screens use two columns where needed.
- The fixed TwoFA action bar spans the page width. ResizeObserver-driven bottom padding and toast offsets remain intact.
- Below 580px, close-window utilities use a labeled 44px icon button to keep the brand and utilities on one row.
- Primary action blue; secondary action navy. Semantic icon buttons use common status tokens. Confirmations preserve cancel-first focus, focus trapping and restoration.
- Empty, error, loading, partial and completed states use the existing functional components and content. No invented dashboard metrics or placeholder business controls.
- Hover transitions 180ms. Reduced motion disables animations and transitions. Main mobile actions target at least 44px; compact dialog controls and checkbox labels retain their existing hit areas and keyboard focus.
- Skip link, native form labels, progress semantics and navigation active state remain available.

## Delivery and verification

Account-table supporting text uses a scoped `--muted-foreground: #CBD5E1` for verification notes, missing Usage, payment methods and payment dates. Keep LIVE/PLUS, loading/error colors and disabled controls on their existing semantic tokens. This is a color-only adjustment; row layout, font metrics and account behavior stay unchanged.

Text inputs, textareas (including the numbered account and verified-output editors) and selects use a subtle 1px slate `--field-border` (`#475569`) on navy surfaces. Keyboard focus keeps the existing colored outline. Disabled controls, checkboxes, switches and panel borders retain their existing styles.

`src/index.css` owns global tokens; `design-tokens.json` is the portable palette. `brief-preview.html` previews the actual tokens and interactive component states. All five functional screens are checked against this brief at desktop and mobile sizes using synthetic transport fixtures that block unknown and external API traffic.

### Redesign checks before the horizontal-header correction — 2026-11-01

| Check | Result |
|---|---|
| Production build | PASS. CSS 82.59 kB; JS 587.16 kB. Existing chunk-size warning above 500 kB remains. |
| Lint | Exit 0; two existing unused-variable warnings (`health`, `connected`) in `TwoFAWorkspace.jsx`. |
| Unit tests | 31 tests, 177 assertions passed. |
| Workspace + Export/Backup browser tests | 23 tests passed. |
| Account browser regressions | 24 scenarios passed; rerun after the final visual adjustments. |
| Browser Login regressions | 7 scenarios / 128 assertions passed. |
| Rendered responsive audit | All five workspaces at 1440, 1024, 390 and 320px: 20 combinations passed, no page horizontal overflow. Tables/navigation scroll within their containers. |
| Readability samples | Minimum sampled enabled-text contrast 4.72:1; no sampled visible text below 12px; local Inter and JetBrains Mono loaded. This is a sampled check, not an exhaustive WCAG audit. |
| Interactive design preview | Token preview, controls and component states passed. |
| Final state review | Hover without layout shift, keyboard focus, checked/disabled states, reduced motion, error toast, partial results, progress and all four log levels passed. Four additional rendered contrast/overflow checks passed. |

Commands used from `frontend/`:

```sh
bun run build
bun run lint
bun test
NODE_PATH=/Users/quyetdev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  /Users/quyetdev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/workspace-browser.cjs tests/export-backup-browser.cjs \
  tests/account-browser.cjs tests/browser-login-browser.cjs
```

The browser suites cover preserved payloads/API namespaces, eligibility, retained workspace state, SSE handling, confirmations, focus trapping/restoration, nested dialogs and queue actions. Test files may wrap multiple scenarios in a single TAP test, so scenario counts are reported separately.

Final rendered review fixed the Browser Login console title disappearing during log auto-follow: the title is sticky within the existing scroll container (`src/workspaces/BrowserWorkspace.css:55`). The log handling and auto-follow code are unchanged. The final state harness verified the title at 1440 and 390px after this CSS change; build, lint and unit tests also passed afterward.

All browser actions used synthetic transport fixtures that block unknown/external API requests. No real accounts, provider actions, installed desktop app packaging or deployment were exercised. Read-only independent review of the page gutters and structured-text monospace changes reported no findings.

Screenshots and the sampled audit report are saved under:

`/Users/quyetdev/.codex/visualizations/2026/11/01/01a1955e-1eb9-7652-89a0-9dda9ee98329/`

### Ten-dimension design review

Scores are a local self-assessment against the supplied brief, not a measured percentage of visual fidelity. References identify the implementation or review fix; remaining limits are stated explicitly.

| Dimension | Score / 10 | Evidence / implementation and limits |
|---|---:|---|
| Color consistency | 9 | Shared navy layers, blue/cyan actions and semantic status colors in `src/index.css:13`; readable secondary text replaces low-contrast muted captions at `src/index.css:24`. |
| Typography hierarchy | 9 | Local Vietnamese-capable fonts at `src/index.css:5`; role sizes at `src/index.css:11`; structured inputs use monospace at `src/workspaces/account-workspaces.css:15`. No sampled text below 12px. |
| Spacing rhythm | 8.5 | Page gutters at `src/workspaces/account-workspaces.css:2` and mobile override at `src/workspaces/account-workspaces.css:76`; 20px panel padding / 18px gaps at `src/workspaces/BrowserWorkspace.css:14`. Small legacy component-specific gaps remain. |
| Component consistency | 9 | Shared button/disabled rules at `src/index.css:87`, Sonner at `src/index.css:68`, confirmation at `src/index.css:62`. Workspace-specific components reuse the same semantic tokens. |
| Responsive behavior | 9 | Horizontal header navigation in `src/index.css`, container layout at `src/workspaces/BrowserWorkspace.css:101`, compact statistics at `src/workspaces/twofa.css:88`. Twenty screen/width combinations passed; dense account tables intentionally require local scrolling. |
| Dark mode completeness | 9.5 | Dark color scheme and global surfaces at `src/index.css:13` and `src/index.css:36`; console at `src/workspaces/BrowserWorkspace.css:93`. Five workspaces and shared overlays reviewed. No light theme requested. |
| Animation | 9 | Restrained 180ms transitions at `src/index.css:196`; activity indication at `src/workspaces/twofa.css:90`; reduced motion at `src/index.css:221`. No decorative scroll animation or glow. |
| Accessibility | 8 | Visible checkbox/link/button focus at `src/index.css:82` and `src/index.css:99`; sampled text contrast at least 4.72:1. Focus traps/restoration and reduced motion verified; no screen-reader or exhaustive non-text contrast audit performed. Compact controls retain existing hit areas. |
| Information density | 8.5 | Account information and actions stay on one row at `src/workspaces/twofa.css:36`; semantic action grouping at `src/workspaces/twofa.css:37`. Two-column forms collapse when needed; dense operational tables remain wide by design. |
| Polish and states | 9 | Hover, disabled, empty/error, partial progress, confirmation and toast states reviewed. Sticky console-title fix at `src/workspaces/BrowserWorkspace.css:55` keeps context visible during auto-follow. Real provider/account execution remains outside this UI verification. |

Pattern review found no decorative gradients, purple defaults, stock hero, gratuitous glass effects or scroll animations. Navy surfaces, restrained shadows, functional typography and existing operational content provide the visual hierarchy.

### Horizontal header correction — 2026-11-01

The brand, five workspace links and utility controls now share a horizontal header. The sidebar and its left content/action-bar offset are removed. At 1100px and below, the links stay on one horizontal scroll row beneath the brand and utilities. The navy palette, typography, routes, workspace retention and request handlers are preserved.

Verification after this correction:

- Production build passed (CSS 81.29 kB; JS 586.90 kB); the existing bundle-size warning remains. Lint exited 0 with the same two existing unused-variable warnings.
- `tests/workspace-browser.cjs`: 9 tests passed, including all five workspaces at 1440, 1024, 390 and 320px with the conditional close-window button visible. Checks cover header direction, full-width content/action bar, no page overflow, skip navigation, retained drafts, connection recovery and stream lifecycle.
- Rendered design review: 20 workspace/width combinations passed sampled contrast, font and overflow checks. Minimum sampled contrast 4.72:1; no sampled enabled text below 12px. Desktop and mobile screenshots were visually reviewed.
- Browser requests used synthetic fixtures that block unknown and external APIs. Real accounts and desktop packaging were not exercised. Other browser/unit suites retain the earlier verification recorded above and were not rerun for this shell-only correction.

Current screenshots and audit report are in the `horizontal-header/` subfolder of the visualization directory above. The build and lint commands used the bundled Node executable with `node_modules/vite/bin/vite.js build` and `node_modules/oxlint/bin/oxlint`; the browser suite used the Node/Playwright paths above.

### Export format tabs

Cockpit, 9router and Sub2API use a full-width horizontal icon/button strip above the export form, matching Browser Login's secondary/ghost selected state and bottom divider. Gauge, Network and ServerCog distinguish the destinations. The strip scrolls within its own width on narrow screens; mobile targets remain at least 44px. Existing format state, saved preferences, Export/Convert inputs, payloads and busy/stopped locks are preserved.

Verified at 1440, 1100, 390 and 320px: one horizontal row, no page overflow, 44px mobile buttons, native keyboard activation and retained form values across destination/task changes. All 16 synthetic Export/Backup browser regressions passed; production frontend build passed. Lint passed with the two existing unused-variable warnings in TwoFAWorkspace. No live account/provider actions or macOS app packaging were performed for this UI change.

### 2FA history dialog — 2026-11-01

The history view reuses the installed Radix `AppDialog`. Direction: a compact operational record viewer in the existing navy theme, with Inter headings, JetBrains Mono raw data, a cyan history icon and blue primary copy action. The heading/count and bottom copy/export actions remain visible while only the record list scrolls. Each record groups its email, timestamp, individual copy action and selectable raw data; long content wraps inside its record. On mobile, spacing contracts and actions have at least 44px height. No new dependency, font, palette, route or backend behavior is introduced.

Loading, empty and retryable error states are distinct. Closing invalidates pending history responses and clears loaded records. Copy and TXT export keep the original raw strings and record order.

Verification: all 26 synthetic account browser regressions passed, including exact clipboard/download contents, loading/error/retry/empty states, Escape/focus restoration, focus containment, and long-list geometry at 1600×1000, 390×844, 320×640 and 820×420. Rendered desktop/mobile, long-content, error and empty states were reviewed; no horizontal overflow or hidden footer was found. Build passed; lint passed with the two existing unused-variable warnings. Screenshots use synthetic data in `.artifacts/twofa-history/`. Live accounts, screen-reader behavior and macOS packaging were not exercised. This is a redesign guided by the screenshot's problems, not a pixel reproduction of the old layout.


### Payment method badges — 2026-11-01

The TwoFA payment column now groups each method into a compact icon/brand badge, a masked monospace number, and a secondary expiry/default line. Visa uses the existing blue tokens, Mastercard the amber tokens, UPI the cyan tokens; other methods use a neutral badge. These colors identify methods and do not indicate payment success or card validity. The billing date has a calendar icon and remains secondary. Existing type labels, masked values, dates, two-method limit, additional count, and disabled/pending/unavailable/empty states are preserved through the unchanged view model.

The payment column is 240px; the table minimum grows from 1340px to 1480px on desktop and from 1540px to 1640px on mobile to preserve usable space in the other columns. Horizontal overflow stays inside the existing table container. Badges allow wrapping for unfamiliar labels. Shared Badge, global tokens, API requests and backend behavior are unchanged.

Verification: production build passed; lint passed with the two existing unused-variable warnings. A synthetic browser check covered UPI, Mastercard, Visa, unfamiliar brands, PayPal, default/expiry/masked digits, additional methods, invalid billing date and all missing-data states. No payment-content or page overflow at desktop, 390px and 320px. Rendered column and mobile screenshots were reviewed in `.artifacts/payment-badges/`. No real accounts, payment provider actions or macOS packaging were exercised.

Final review caught and fixed a mobile cascade regression before delivery: the original mobile table-width rule remains authoritative at 1640px. Running-status and LIVE/PLUS bounds fit their cells at 390px and 320px; independent review confirmed no remaining findings. Account regression run: 25/26 passed initially; the nested password-dialog case timed out during the CSS update and passed on its focused rerun. No cause beyond the observed timing was established.


### LIVE and PLUS account badges — 2026-11-01

TwoFA account checks use the existing outline Badge: LIVE has a green CircleCheck and PLUS has a blue Sparkles icon. The previous amber Crown is replaced. Both share compact sizing and can wrap within the existing column. Account/plan conditions and verification text remain unchanged; non-Plus plan labels remain visible.

Validation: production build and lint passed (existing warnings only). Synthetic browser checks and rendered review passed at 1600, 390, and 320px: correct icons and state conditions, preserved FREE labels, no badge or page overflow. Screenshots: `.artifacts/account-badges/`.

### PLUS green color correction — 2026-11-01

PLUS now shares LIVE success colors (text, border, and surface), per the updated reference request. Sparkles, sizing, spacing, state conditions, and responsive layout are preserved.

### Header workspace identity — 2026-11-01

Refine the existing dark header identity for account operators: retain the product name, font and navigation, replace the empty Square with a Lucide Layers3 mark on the existing info surface, and use a thin info border. A compact bold wordmark leads a smaller tracked WORKSPACE caption with a short blue rule. Preserve the home link and focus outline, provide a 44px link target, and scale the mark and name down below 580px. No new assets, fonts, animation, workflows or status indicators.

Validation: build and lint passed with existing bundle-size and unused-variable warnings. Synthetic browser review passed at 1600/1100/768/390/320px: no header collision or page overflow, 44px brand link, keyboard focus and TwoFA destination preserved. Desktop/mobile screenshots: `.artifacts/workspace-brand/`.

### Green payment badges — 2026-11-01

All payment method badges and the default badge now use the existing success text, surface and border tokens to stand out on navy rows, matching LIVE/PLUS. Brand-specific blue, amber and cyan overrides are removed. Preserve icons, sizing, card masking, expiry, payment dates and responsive layout.

Delivery verification: the running React hub at port 5150 served stale built CSS after the source color update. Rebuilt frontend/dist and verified its served CSS has success colors with no per-brand overrides. Production-origin synthetic browser review passed desktop/390/320px. Existing open pages require a reload to fetch the new asset hash; no service restart performed.


### Usage metric ledger — 2026-11-01

A compact, precise utility panel for operators scanning account consumption. Retain the existing navy palette, Inter type, Lucide icons and semantic success/warning/error colors. Each Usage cell has an 8px rounded thin border, inset surface and 10px padding. Lead with a 20px tabular percentage and an inline 12px used label; align the remaining label opposite. Use a 5px native progress track, then a fine divider and 12px icon-led reset/credit rows. No gradients, new fonts, dependencies or decorative motion. Pending, empty and disabled states use a quieter dashed frame. Preserve every view-model label and its existing tone, including a limit reached below 100%. Existing values stay visible during refresh.

Usage column is 220px. The locally scrollable table has a minimum width of 1640px desktop and 1720px mobile to preserve room for status/check columns and the existing larger mobile actions. Page itself must not scroll horizontally. Scope: presentation only, no workflow, API or calculation changes.

Validation: frontend build and lint passed (existing bundle-size and two unused-variable warnings only). Production-origin (5150) synthetic browser checks covered 0/2/9/87/99.99/100%, limited below 100%, reset duration/unknown time/zero reset credits, finite and unlimited credits, cached data during refresh, empty/disabled/pending states. Usage, status/check cells and page have no horizontal overflow at 1600/390/320px; only the existing table scrolls locally. Final desktop column and mobile renders reviewed in `.artifacts/usage/`. Fractional metric captions wrap when needed. No live account operations or macOS package build were exercised.


### Compact account actions in two rows — 2026-11-01

Retain the navy palette, Inter labels, semantic action colors and three labeled groups on the same account row. Use two button columns for Data/check and Security, and one column for Management, yielding at most two button rows in every eligible account state. Keep 6px button gaps, 12px group separation and the existing vertical dividers. Actions occupy 344px on desktop and 384px below 560px, with 36px desktop and 44px mobile buttons. Preserve the table minimum widths (1640px/1720px), account/Usage/payment widths and local horizontal scroll so the freed width expands the status and check columns. No interaction or eligibility changes.

Validation: build and lint passed with the existing bundle-size and two unused-variable warnings. Synthetic browser review passed on Vite (5151) and the rebuilt hub (5150) at 1600/1440/768/390/320px: every eligible button remains available, full accounts have exactly two button rows, labels stay on one line, buttons stay within their groups, mobile targets are 44px, keyboard order/tooltips and copy-only journals are preserved, and the page has no horizontal overflow. Desktop status/check columns each grew from 154px to 232px. Account regression suite: 25/26 passed initially; the rotation-result case read before its async value arrived and passed unchanged when rerun alone. Screenshots and geometry reports: `.artifacts/action-two-rows/`. No real account actions or macOS package build.


### Unified account actions — 2026-11-01

Supersedes the labeled action groups above. Remove all three group captions and vertical dividers; place the existing icon buttons consecutively in one five-column grid with 6px gaps, yielding at most two rows. Keep 36px desktop and 44px mobile buttons, tooltips, accessible labels, DOM/keyboard order, eligibility and handlers. Actions now occupy 240px desktop and 280px mobile so the released width expands the status and check columns. Preserve the navy palette, semantic colors, table minimum widths and local table scroll. No other UI or workflow change.


Validation: production build and lint passed with the existing bundle-size and two unused-variable warnings. Synthetic browser checks against the rebuilt hub (5150) passed at 1600/1440/768/390/320px: full ten-action rows wrap into exactly two rows, sparse rows stay consecutive in one row, every button keeps its eligibility and order, gaps are 6px, mobile targets are 44px, and the page has no horizontal overflow. Keyboard order, tooltips, raw copy, log opening, delete confirmation and copy-only journals passed. Reviewed desktop/mobile renders and the scoped source diff; every ActionButton prop and handler is unchanged. Screenshots and geometry: `.artifacts/action-unified/`. No real account operations or macOS package build.


### Account actions in one row — 2026-11-01

Supersedes the five-column/two-row arrangement above. Keep every action in one continuous flex row with no wrapping, 6px gaps, the same icon colors, tooltips, keyboard order and 36px desktop/44px mobile targets. Increase the actions column to 448px desktop and 528px mobile to fit all ten eligible actions. The table minimum becomes 1840px/1960px to retain readable status/check columns. Narrow screens use the existing local table scroll; there is no additional action scroller. CSS-only presentation change; account conditions and handlers are unchanged.


Validation: production build and lint passed with existing warnings only. Browser checks on rebuilt hub 5150 passed at 1600/1440/768/390/320px: all eligible actions share one row, 6px gaps and existing button sizes remain, buttons fit inside the action cell, the page does not overflow, and mobile local table scroll can reach both ends. Keyboard order, tooltips, raw copy, log dialog, delete confirmation and journal copy-only behavior passed with synthetic fixtures. Desktop/mobile renders and the four scoped CSS changes were reviewed. Evidence: `.artifacts/action-single-row/`. No live account operations or macOS package build.


### Scroll to the processing list after launch — 2026-11-01

After an accepted check or confirmed 2FA launch, scroll once to the existing processing-list panel after the new jobs have rendered. Use native smooth scrolling, or instant scrolling when reduced motion is preferred. Keep focus, navy styling, table layout and existing request/confirmation behavior. Failed requests, cancelled confirmations and subsequent SSE updates do not request scrolling. Native scrolling stops at the document end when a short list cannot align with the viewport top.

Validation: production build and lint passed with existing bundle-size and two unused-variable warnings. Five focused synthetic browser regressions passed on rebuilt hub 5150, covering empty-list launch on desktop 1600×1000 and mobile 390×844, reduced motion, one scroll after row commit, no repeat scroll on SSE updates, failure/cancel, confirmed 2FA, historical-journal return, existing payloads and confirmation keyboard/focus behavior. Desktop/mobile renders and the scoped source diff were reviewed. Evidence and backups: `.artifacts/launch-scroll/`. No real account operations or macOS package build.


### Return to the top from the queue bar — 2026-11-01

Add a visible ArrowUp icon and “Lên đầu” outline button after the cleanup controls in the existing fixed queue bar. Retain the current navy/white tokens, Inter typography, compact spacing and responsive wrapping; no new palette, font, floating widget or dependency. Keep the button available for empty, running and journal states. Native window scrolling returns to the header and account input, smooth by default and instant for reduced motion. Reuse the existing keyboard focus treatment and 44px mobile targets. Preserve account data, selection, local table scrolling and the automatic list scroll after an accepted launch.

Validation: production build and lint passed with existing bundle-size and two unused-variable warnings. Five focused synthetic browser tests passed on rebuilt hub 5150, covering fixed-bar geometry at 1440/390/320/820px, top scrolling by keyboard/click with normal/reduced motion, preserved rows/selection/local table position, empty/running/journal eligibility and existing launch scrolling. Desktop/mobile/narrow-mobile screenshots and scoped source diff reviewed. Evidence and backups: `.artifacts/scroll-top/`. No real account operations or macOS package build.


### Distinct account action colors — 2026-11-01

Keep the navy workspace, Inter typography, continuous row, existing icons, tooltips, eligibility and 36px desktop/44px mobile targets. Give each row action its own accent: copy blue, logs lavender, recheck cyan, usage lime, 2FA amber, combined magenta, passkey emerald, logout peach, delete chats rose, stop red and retry teal. Use tinted surfaces and borders for these actions. “Bỏ khỏi danh sách” uses solid orange #FB923C with a dark #431407 icon and light orange border to stand out from delete chats. Hover brightens the surface; keyboard focus follows each action accent; existing disabled tokens retain precedence. Scope all colors to `.tf-action-buttons`; fixed footer and account flows retain their existing styling and behavior.

Validation: production build and lint passed with the existing bundle-size and two unused-variable warnings. Focused synthetic checks against rebuilt hub 5150 confirmed twelve distinct action colors, orange remove icon contrast 6.92:1, hover/focus/disabled styling, one-row geometry and 36px/44px targets at 1600/390/320px, with no page overflow or account mutations. Reviewed desktop/mobile renders, keyboard-focus screenshot and the scoped CSS diff. Evidence and backups: `.artifacts/action-colors/`. No real account operations or macOS package build.


### Remove account trash icon — 2026-11-01

Supersedes the orange ListX treatment for the row remove action. Use the existing Lucide Trash2 icon, solid red #DC2626, white icon #FFFFFF, red border #F87171 and light red focus/hover accent #FCA5A5. Keep row sizing, tooltip, label, eligibility, disabled tokens and removal handler. The adjacent delete-chat action remains rose and uses its existing message icon.

Validation: build and lint passed with existing warnings. Synthetic browser checks on rebuilt hub 5150 confirmed Trash2, twelve distinct icon colors, white-on-red contrast 4.83:1, hover/focus/disabled states and preserved row geometry at 1600/390/320px. Desktop/mobile renders and the two-line source diff were reviewed. Evidence: `.artifacts/remove-trash/`. No live account operations or macOS package build.


### Direct row Passkey launch — 2026-11-01

Clicking the row “Thêm Passkey” action immediately uses the existing native Chrome preparation flow without the initial confirmation dialog. Retain existing request payload, validated fallback link, errors, pending/disabled behavior and manual completion on OpenAI. A per-job pending check ignores repeated clicks before React updates. This change adds no visual components or new styles.

Validation: production build and lint passed with existing bundle-size and two unused-variable warnings. Four focused synthetic browser tests passed on rebuilt hub 5150, covering direct launch and its existing payload, pending duplicate clicks, validated fallback, API errors and invalid links. Logout and chat deletion still require confirmation. Reviewed the scoped source and test diffs. No live passkey enrollment or macOS package build.


### Close tool windows from account queue — 2026-11-01

Add “Đóng toàn bộ cửa sổ” to the fixed account action bar, reusing Button, Lucide CopyX, Inter and navy surfaces. Use the existing orange #FDBA74 accent with a tinted surface and focus outline; retain wrapped desktop/mobile layout and 44px mobile targets. The action calls the existing token-protected Passkey close endpoint immediately, closes only tracked tool Chrome processes, and reports the returned count or empty/error state. Keep it available with an empty queue or historical journal. Disable duplicate close clicks and row Passkey launches while closing; disable closing while foreground preparation is pending. Account data, queue cancellation, other modules and normal Chrome windows retain their existing behavior.

Validation: production build and lint passed with existing warnings. Eight focused synthetic browser tests passed, including success/empty/error results, duplicate-click protection, preserved Passkey actions and fixed bar eligibility. Rendered and reviewed 1440x1000, 390x844, 320x640 and 820x420; compact mobile gaps/padding keep all controls visible with 44px targets. Two existing close-all process tests passed using fake processes, including forced close after timeout. Reviewed source and test diffs. No live Chrome closure or macOS package build. Evidence: `.artifacts/close-windows/`.


### Compact Browser Login workspace — 2026-11-01

Retain all six Browser Login tabs, existing content, descriptions, help, fields, settings, history and actions. Use the existing navy palette, Inter and JetBrains Mono, cyan section icons, blue primary action and semantic success/warning/error colors. No dependency or behavior changes. Group browser and concurrency fields on one row; keep account input resizable with a compact initial height; place visible URL and retry toggles together. Replace large statistic cards with a four-cell strip and separators. Balance the form against progress/results and the activity console; give long results and logs their own scroll regions without truncating text. Tabs use a compact bordered navigation strip.

Direction: professional, compact operations workspace; two columns above 900px and a stacked layout below that workspace width. Retain readable helpers and labels, white field borders and keyboard focus. Mobile uses 44px control targets, horizontally scrollable tabs and wrapped messages. Reference screenshot establishes content inventory; spacing and hierarchy are intentionally redesigned. Verify synthetic idle/running/retained/error states and all tabs at desktop and narrow/mobile widths; no live account operations.

Validation: production build passed; lint reported only the two existing TwoFA unused-variable warnings and build retained its existing bundle-size warning. Five focused Bun tests (52 assertions) and seven existing synthetic Browser Login scenarios (128 assertions) passed. All six tabs checked at 1440/1280/1024/768/390/320px with no document overflow. Separate long-content running-state checks verified local scrolling, complete wrapped messages and visible actions; narrow workspace stacking and 44px mobile controls passed. The desktop form reduced from 884.78px to 654.84px (26%). Desktop/mobile and rich-state screenshots and source diff reviewed independently, with no blockers. Evidence: `.artifacts/browser-redesign/` including `verification.txt`. Frontend dist rebuilt for the current hub; no backend restart, live account actions or native macOS package build.


### Account queue close-button visibility — 2026-11-01

Show the existing orange close-window action only when the shared Suite status reports an open tool browser window. Subscribe to the existing React Query cache with fetching disabled; add no polling. Keep the disabled loading action visible while closing, then invalidate shared status after success. Unknown/error status hides the idle action. Reuse the current colors, typography, spacing, focus and responsive action bar. Preserve the close endpoint and account handlers.

Validation: 11 synthetic browser checks passed, including pending/empty/open/manual-close/closing/success/failure/status-error states, no extra polling, retained controls and mobile overflow. Desktop 1440x1000 and mobile 390x844 screenshots reviewed; frontend build and lint passed with existing warnings; eight existing transport/status tests passed. No live window closure or account operations. Evidence: build/window-button-check/.


### Eligible account queue actions — 2026-11-01

Only render fixed queue-bar controls when their existing business conditions allow the action: selectable Live rows, eligible selected rows, exportable current-tab rows, retryable failures, clearable failures, a completed nonempty queue or an open tool window. Keep existing colors, Inter typography, icons, centered wrapping, keyboard focus and mobile targets. Keep temporary busy disabling and the close-window loading state; retain “Lên đầu” in every view. Reuse existing eligibility predicates and handlers without new state, effects, requests or backend changes.

Validation: production build and lint passed with the existing bundle-size and two unused-variable warnings. Seventeen focused synthetic UI checks passed at 1440x1000 and 390x844, covering empty/Live/selected/mixed/running/failed/filtered/journal states, temporary request disabling, retained cleanup confirmation, export payload and 44px mobile targets with no page overflow. Before/after toolbar and mobile renders reviewed. Source review confirms all 40 onClick handlers, 12 onChange handlers and 34 disabled expressions are unchanged, and all source outside the action bar is identical. Close-window visibility/loading/error/polling regressions also passed (11 checks). No live account actions or window closures. Evidence: build/action-visibility-check/.


### Four account columns styled after the original — 2026-11-01

Use the supplied original screenshot for the Status/Plan, Account Check, Weekly Usage and Payment columns. Restore the rounded uppercase status pill with a small dot, one outlined LIVE · PLAN badge with a checkpoint below, a compact bordered Usage card with small used percentage and prominent remaining percentage, and a compact Payment card with a plain method title and separated billing date. Retain the current React navy/emerald tokens, Inter typography and light borders; no new fonts or dependencies. Keep actual account/plan data, combined-flow details, errors, loading, credit/reset details and multiple payment methods. Check-only success reads “ĐÃ CHECK LIVE”; pending and historical checkpoints retain their distinct meanings. Existing mobile table scrolling and reduced motion remain available.

Validation: frontend build and lint passed with existing bundle-size and two unused-variable warnings. Fifteen focused model/workspace tests passed (80 assertions). Synthetic UI checks passed at 1600/1440/768/390/320px without page or cell overflow, plus eight loading/disabled/missing/error/limit variants and reduced motion. Tests recorded zero mutating requests and blocked external origins. Desktop/mobile renders and the scoped JSX/CSS diff were reviewed. Presentation only: no account handlers, API, Python or original-tool changes. The cropped reference establishes layout and hierarchy; colors follow the existing React theme. Evidence and backups: `.artifacts/four-column-original/`. Frontend dist rebuilt; no native macOS package build.


## Account tools in the header — 2026-11-01

Move the five existing account tools into the shared app header and remove the redundant “Check tài khoản & Đổi 2FA” heading. Reuse the existing navy palette, typography, outline buttons, icons and dialog handlers. Keep tools visible only on the active account route via a React portal so workspace state remains mounted. Wide desktop: tools on the right, before global controls. Below 1750px: a right-aligned header row; below 1100px: wrap below navigation, preserving all labels and keyboard access. No backend or account processing changes.

Verification: frontend build passed; lint completed with the two existing unused-variable warnings (health, connected). Synthetic browser checks confirmed all five dialogs, active-route visibility, retained account draft and no document overflow across 320–2040px. Desktop/mobile screenshots and read-only independent source/visual review passed. Evidence: `.artifacts/header-tools/`. Native macOS package was not rebuilt.


## Original 2FA palette across React — 2026-11-01

Use the actual original `chatgpt-tool/modules/twofa/change 2fa community/static/dashboard.css` as the color source, including its final compact-dashboard overrides. Preserve the existing React layout, typography, icons, header tools, eligibility and account handlers. Active skills: ECC frontend-patterns, Ponytail full and the installed design-brief/frontend-design/design-review workflow. This is a presentation change with medium reasoning scope.

Map the original navy canvas (#0b2136), panels (#16425f), inset fields (#082137), bright text (#f4fbff), secondary text (#b6d1df), cyan (#55e7fa) and blue-to-cyan primary gradient (#3198ff → #52e4f4) into shared tokens. Reuse original mint success (#55edbd), amber warning (#ffd486), pink error (#ff8f9c), translucent borders and subtle shadows. Apply the original input/output gradients, green success output, line-number gutter, outlined LIVE badge, Usage state colors and per-action colors to 2FA. Shared tokens carry the same palette into Passkey, Codex Export, Browser Login and Chat Backup. Keep disabled surfaces navy with muted text and preserve focus and reduced-motion treatments.

Validation: frontend production build and lint passed with the existing bundle-size warning and two existing unused-variable warnings. Synthetic 2FA rendering passed at 1600/1440/768/390/320px, eight loading/disabled/missing/error/limit variants and reduced motion. Cross-workspace checks passed at 1440/390px, including enabled/disabled primary colors, no document overflow and no runtime errors. All requests used synthetic data, external origins were blocked and no mutating requests occurred. Reviewed desktop/mobile screenshots, scoped CSS diffs and independent cascade/contrast review. All 140 protected JSX/Python/original files and original Git status match their pre-change baseline. Evidence: `.artifacts/original-palette/`.

Fidelity boundary: match the source palette while retaining React geometry and fonts. Existing PLUS and credit/reset spans retain their current markup, so original distinctions requiring new markup are not introduced. Historical `design-tokens.json` and `brief-preview.html` document the earlier Premium Dark Navy exploration; active runtime tokens are in `src/index.css`. Frontend dist rebuilt; no native macOS package or live-provider validation.


## Chuẩn giao diện kế thừa HTML cho 2FA — 2026-11-02

Phần này thay thế các quyết định về font, cỡ chữ và mật độ của các ghi chú 2FA phía trên. Nguồn đối chiếu là HTML/CSS thực tế tại `chatgpt-tool/modules/twofa/change 2fa community/static/`, gồm các quy tắc compact-dashboard cuối file. Đối chiếu bằng CSS đã được trình duyệt tính toán, không suy ra thông số từ ảnh. Phạm vi gồm màn hình 2FA, Đổi mật khẩu và các hộp thoại Cấu hình, Session JSON, Lịch sử, Nhật ký, Log. Giữ nguyên luồng xử lý và dữ liệu.

### Font và đơn vị

- Font giao diện: `"Avenir Next", Avenir, "SF Pro Text", "Helvetica Neue", sans-serif`.
- Font tiêu đề: `"Avenir Next", Avenir, "SF Pro Display", "Helvetica Neue", sans-serif`.
- Font dữ liệu tài khoản/code/log 2FA: `"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace`.
- Dùng `--legacy-unit: 18px` trên desktop và `16px` khi viewport không quá 680px. Đây là đơn vị cục bộ trong `.tf-twofa-workspace`, `.tf-twofa-modal`, `.tf-twofa-tools` và `.aw-password-workspace`; không đổi `rem` của Tailwind hay font-size của `html`.
- Giữ nguyên các fallback monospace riêng của màn hình Đổi mật khẩu theo CSS nguồn. Các tiêu đề màn hình này khai báo Outfit/Inter trong HTML nhưng không tải font, nên thực tế hiển thị Helvetica trên macOS. React đặt `Helvetica, Arial, sans-serif` cho đúng hình dạng đang hiển thị của bản gốc. CDP xác nhận hai bản cùng dùng Helvetica-Bold cho tiêu đề, AvenirNext-Regular cho nội dung thông thường.

### Thang chữ dùng cho 2FA

Các số thập phân được giữ nguyên theo CSS gốc; không làm tròn về thang font mặc định của thư viện component.

| Vai trò | Desktop | ≤680px | Độ đậm | Chi tiết |
| --- | ---: | ---: | ---: | --- |
| Nhãn nhỏ ĐẦU VÀO / REALTIME | 9.72px | 8.64px | 700 | line-height 1.45; tracking .115em |
| Tiêu đề panel | 18.36px | 15.36px | 700 | line-height 1.1; tracking -.018em |
| Nhãn định dạng | 10.62px | 9.44px | 700 | line-height 1.45; tracking .1em |
| Code định dạng | 10.44px | 9.28px | 600 | monospace; line-height 1.2; tracking 0 |
| Dữ liệu đầu vào | 12.24px | 10.88px | 500 | monospace; line-height 24.84px / 22.08px |
| Dữ liệu đầu ra | 11.88px | 10.56px | 500 | monospace; line-height 1.55 |
| Nút thường | 11.88px | 10.56px | 700 | line-height 1.45; tracking 0 |
| Bộ lọc tài khoản | 12.24px | 10.08px | 700 | line-height 1.45; tracking .015em |
| Nội dung bảng | 12.96px | 11.52px | 400 | line-height 1.45; tabular numbers |
| Tiêu đề cột | 10.98px | 9.76px | 700 | tracking .055em |
| Email tài khoản | 13.32px | 11.84px | 700 | line-height 1.45; tracking -.008em |
| Trạng thái | 10.44px | 9.28px | 700 | tracking .08em; giữ chữ hoa/thường từ dữ liệu |
| LIVE · PLAN | 10.08px | 8.96px | 700 | line-height 1.45; tracking .04em |
| Usage đã dùng | 10.26px | 9.12px | 800 | line-height 1.45 |
| Usage còn lại | 13.32px | 11.84px | 900 | line-height 1; tracking -.015em |
| Reset Usage | 9.36px | 8.32px | 400 | line-height 1.25 |
| Tên phương thức thanh toán | 10.98px | 9.76px | 700 | line-height 1.45; tracking .035em |
| Chi tiết thanh toán | 9.54px | 8.48px | 400 | line-height 1.45 |
| Ngày thanh toán | 9px | 8px | 400 | line-height 1.45 |

Hộp thoại dùng thông số theo từng loại trong CSS nguồn, không ép chung một cỡ tiêu đề: Cấu hình/Log 2FA là `1.6 × unit`, Lịch sử/Nhật ký là `1.65 × unit` (mobile `1.35 × unit`), Session là `1.35 × unit`. Màn hình Đổi mật khẩu dùng tiêu đề `1.35 × unit`, tiêu đề panel `1.03 × unit`, textarea `.69 × unit`/400/1.55. Lịch sử và Log Đổi mật khẩu có quy tắc riêng, cùng phạm vi `.tf-twofa-modal`.

### Màu, khoảng cách và nhãn

| Vai trò | Giá trị nguồn |
| --- | --- |
| Nền trang | `#0b2136` |
| Panel | `#16425f` và gradient navy của bản gốc |
| Nền ô nhập | `#082137` |
| Chữ chính / phụ | `#f4fbff` / `#b6d1df` |
| Cyan | `#55e7fa` |
| Nút chính | `#3198ff → #52e4f4` |
| Thành công / cảnh báo / lỗi | `#55edbd` / `#ffd486` / `#ff8f9c` |

- Desktop: panel padding 14px 16px, gap hai panel 10px, bo góc 14px; ô nhập bo 10px và gutter 46px. Nút thường cao 35px, bo 9px; bảng dùng padding header 7px 8px, ô dữ liệu 10px 8px. Border mảnh và lớp màu trong suốt kế thừa bản gốc.
- Dưới 1100px, hai panel xếp dọc. Dưới 680px, panel padding 13px và điều khiển xếp theo không gian còn lại. Bảng cuộn ngang trong vùng riêng, không làm tràn trang.
- Dùng lại nhãn gốc cho phần có chức năng tương ứng: “ĐẦU VÀO”, “Danh sách tài khoản”, “Định dạng”, “VERIFIED OUTPUT”, “Tài khoản đã change”, “Khởi chạy”, “Copy tất cả”, “Xuất .txt”, “REALTIME”, “Tiến trình tài khoản”; cùng cách viết các bộ lọc, tùy chọn và hộp thoại. Màn hình Đổi mật khẩu giữ “PURE HTTP · WORKFLOW RIÊNG”, “ĐẦU VÀO RIÊNG”, “VERIFIED OUTPUT”, “PASSWORD QUEUE” và các mô tả gốc.
- Nhãn trạng thái động, lỗi, checkpoint và thông tin tài khoản vẫn lấy từ view model hiện tại. Không sửa dữ liệu/logic để tạo cảm giác giống ảnh mẫu.

### Phạm vi kế thừa và phần React được giữ

Mục tiêu là khớp kiểu chữ và nội dung tương ứng của HTML. Menu ngang React, công cụ trên header, thống kê, thanh thao tác cố định, icon hành động một hàng với tooltip, điều kiện hiển thị nút và bố cục dialog React vẫn được giữ. Trên mobile, giữ vùng bấm 44px, focus bàn phím và reduced motion. Vì vậy toàn trang không được coi là bản sao pixel của HTML. Phông hệ thống được xác minh trên Chromium/macOS; hệ điều hành khác có thể chọn fallback khác. Passkey, Codex Export, Browser Login và Chat Backup chỉ nhận bộ font/màu dùng chung, không nhận các selector bố cục 2FA/Đổi mật khẩu.

Source chuẩn đang chạy: `src/index.css` cho token chung và `src/workspaces/twofa-legacy.css` cho mapping cục bộ. File legacy được import sau `twofa.css`. Khi sửa tiếp, cập nhật đúng các selector trong file mapping, tránh thêm một lớp override font tùy ý vào component. Nội dung JSX nằm tại `TwoFAWorkspace.jsx`, `PasswordWorkspace.jsx` và các prop trình bày có mặc định tương thích trong `account-workspace-shared.jsx`.

### Bằng chứng kiểm tra

- 2FA: 30 vai trò × 6 thuộc tính chữ × 5 viewport (1600/1440/768/390/320px), không sai khác computed typography.
- Hộp thoại 2FA: 21 vai trò × 6 thuộc tính × 3 viewport (1440/390/320px), không sai khác computed typography; dialog nằm trong viewport.
- Đổi mật khẩu: 29 vai trò × 6 thuộc tính × 4 viewport (1440/768/390/320px). Chỉ khác chuỗi khai báo font-family của 5 tiêu đề; font thực tế được CDP xác nhận giống nhau như giải thích ở trên. Không lỗi runtime, request ngoài fixture hay tràn trang.
- Build production, lint và 15 test tập trung (80 assertions) đều qua; giữ nguyên hai cảnh báo lint chưa dùng `health`/`connected` và cảnh báo bundle trên 500kB đã có từ trước.
- Bộ kiểm tra trình duyệt tổng hợp `tests/account-browser.cjs`: 36/36 tình huống qua, gồm nhập/copy/xuất dữ liệu, dialog và focus bàn phím, điều kiện thao tác, payload hiện có và cập nhật SSE. Cập nhật kỳ vọng theo nhãn/màu hiện tại; đợi Radix đăng ký lớp dialog lồng trước khi gửi Escape trong test, không sửa runtime dialog.
- So sánh độc lập xác nhận 1.346 file backend/hooks/original/protected không thay đổi; 157 thuộc tính handler/điều khiển JSX và 5 đoạn logic runtime được giữ nguyên.

Fixture, ảnh desktop/mobile, kết quả đo và bản sao trước thay đổi nằm trong `.artifacts/html-style/`. Toàn bộ kiểm tra trình duyệt dùng dữ liệu tổng hợp, chặn origin ngoài và endpoint chưa mock trước khi điều hướng. Không chạy thao tác tài khoản thật, không khởi động lại backend và không đóng gói app macOS trong thay đổi này. Frontend dist đã được build lại.

## Toast: nền đặc (2026-11-02)

Toast tiếp tục ở top center, dùng kiểu chữ và kích thước hiện tại. Nền success/warning pha màu trạng thái trên `--bg-sidebar` đặc, thay cho token surface trong suốt; các vùng khác tiếp tục dùng token surface hiện tại. Giữ chữ sáng, viền màu trạng thái, nút đóng và hành vi thông báo. Kiểm tra bằng fixture tổng hợp trên desktop 1440px và mobile 390px.

## Điều khiển danh sách 2FA (2026-11-02)

Bỏ nhãn REALTIME và tiêu đề Tiến trình tài khoản để bộ lọc nằm đầu panel. Khi xem nhật ký vẫn giữ tên, mô tả chỉ xem và nút quay về danh sách hiện tại. Làm mới và Dừng tất cả chuyển xuống thanh cố định: Làm mới xuất hiện khi có tài khoản, Dừng tất cả khi điều kiện allActive hiện tại đúng; ẩn cả hai khi xem nhật ký. Giữ khóa nút trong lúc gửi yêu cầu để tránh thao tác lặp. Dùng lại font, khoảng cách, icon RefreshCw/Square và token info/error. Thanh tự xuống hàng trên mobile, giữ vùng bấm 44px và cơ chế chừa chỗ phía cuối trang.

### 2026-11-02 — Dọn lỗi theo nhóm
Compact utility dialog reuses AppDialog, existing navy surfaces, typography, warning selection border, badges, and destructive submit. Three native radio choices: DIE, HTTP 403, all; current counts update with jobs, zero-count groups disabled, no default selection. Existing focus trap, Escape, focus return and 320px single-column layout apply. Scope: queue cleanup only; Live/active jobs and saved history are preserved.

### 2026-11-02 — Responsive account columns
Use native automatic table layout: the action column fits the widest visible button group, while account, status, check, usage and payment columns share available width. Keep actions on one line, Usage at least 180px wide, and percentage metrics unbroken. Retain local horizontal table scrolling on narrow screens and 44px action targets at 680px and below. Preserve all content, handlers, action eligibility and existing navy styling. Synthetic browser checks cover 390–2560px, changing action counts and the last action tooltip; no account workflow changes.

Account rows use 14px vertical cell padding (previously 10px) for a modest 8px height increase. Horizontal padding, header spacing, fonts, colors, responsive widths and account behavior stay unchanged.

### 2026-11-02 — Hide three account actions
Hide Xem log, Check lại and Đọc lại Usage from TwoFA account rows. Keep the existing Usage display, remaining action order, responsive widths, 44px mobile targets and account workflows. Backend capabilities and other workspaces are unchanged.

### 2026-11-02 — Select all in table header
Move the existing Chọn tất cả Live checkbox into the first header cell, aligned with row checkboxes. Keep its accessible label and tooltip while hiding the text visually to fit the selection column. Preserve selection scope, eligibility, busy state and journal visibility. Remove the footer copy; all bulk actions remain in the fixed bar.

### 2026-11-02 — Header utilities
Remove the Local badge and manual status refresh icon from the shared header. Preserve workspace tools, conditional window-close action, automatic status queries and connection-error recovery.

### 2026-11-02 — Laptop account table
For 13–14 inch laptop viewports, reduce the TwoFA table minimum to 1120px and bound the account column to 200–280px. Email text wraps within a 260px group, preserving the complete selectable address and adjacent copy button. Keep automatic layout for the other content columns and the action column sized to its visible buttons. Preserve all seven eligible actions, Usage's 180px minimum, existing typography/colors, and mobile local scrolling with 44px action targets. No handlers or backend behavior change.

Synthetic browser verification covers 1280, 1366, 1440 and 1512px with all columns/actions visible without horizontal scrolling, a long email, exact clipboard contents and keyboard/hover tooltips. It also checks wide monitors (1920/2560px), tablet/mobile (1024/680/390/320px), and fewer eligible actions. Before/after reference images and source snapshots are in `.artifacts/laptop-table/`.

### 2026-11-02 — Give payment more room
Reduce the account column to 200px with full email wrapping inside its 184px content group. Reserve 180px for payment on smaller viewports and 24% of the table from 1440px upward. Keep the existing typography, badges, content, copy behavior, intrinsic action width and local mobile scrolling. This reallocates space to payment while keeping all columns visible on laptops. Verify using synthetic fixtures at 320–2560px; reference captures live in `.artifacts/payment-width/`.
