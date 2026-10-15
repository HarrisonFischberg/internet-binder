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
        // The Postcard identity (replica/m3/decisions.md D14): palette, kind objects, controls, haptics.
        .target(name: "KeepsakeUI", dependencies: ["KeepsakeKit"]),
        .testTarget(
            name: "KeepsakeKitTests",
            dependencies: ["KeepsakeKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
