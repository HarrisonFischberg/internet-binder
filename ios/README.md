# Internet Binder for iPhone and iPad

Local-first, no account. Design and plan: `replica/m3/` (`PROMPT.md`, `progress.md`, `decisions.md`).

| folder | what |
| --- | --- |
| `Keepsake.xcodeproj` | app, Share Extension, Widgets (generated: `python3 tools/make-xcodeproj.py`) |
| `App/`, `ShareExtension/`, `Widgets/` | target sources (folder-synchronized: new files need no project edit) |
| `KeepsakeKit/` | Swift package: SQLite store, Chrome's rules in JavaScriptCore, `Library`, `Sealer` |
| `Config/` | entitlements (App Group) and extension Info.plists |
| `Prototypes/` | M3.0 static design prototypes (not shipped) |
| `tools/` | core bundler and polyfills, fixtures and sealer vectors (Node), project generator |

## Build and test

```bash
xcodebuild -project ios/Keepsake.xcodeproj -scheme Keepsake -destination 'platform=iOS Simulator,name=iPhone 17' build
```

```bash
cd ios/KeepsakeKit && swift test
```

```bash
npm run test:ios-core
```

After changing anything in `keepsake/src/shared`, regenerate the bundle (the test above fails until you do):

```bash
node ios/tools/bundle-core.mjs
```
