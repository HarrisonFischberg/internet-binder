// swift-tools-version: 6.0
// KeepsakeKit: storage, the shared rules (run in JavaScriptCore) and sealing, used by the app,
// the Share Extension and the widgets.
import PackageDescription

let package = Package(
    name: "KeepsakeKit",
    platforms: [.iOS("27.0"), .macOS("27.0")],
    products: [
        .library(name: "KeepsakeKit", targets: ["KeepsakeKit"]),
        .library(name: "KeepsakeUI", targets: ["KeepsakeUI"]),
    ],
    dependencies: [.package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0")],
    targets: [
        .target(
            name: "KeepsakeKit",
            dependencies: [.product(name: "GRDB", package: "GRDB.swift")],
            resources: [.copy("Resources/keepsake-core.js"), .copy("Resources/ios-bridge.js")]
        ),
        // The look: five styles (Pantry Pop by default), cards, controls, haptics, the bundled title face.
        .target(name: "KeepsakeUI", dependencies: ["KeepsakeKit"], resources: [.copy("Resources/Fonts")]),
        .testTarget(
            name: "KeepsakeKitTests",
            dependencies: ["KeepsakeKit", "KeepsakeUI"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
