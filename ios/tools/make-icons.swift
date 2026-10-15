// Renders Keepsake's app icons (1024 px) into App/Assets.xcassets: the bookmark mark (keepsake/icons/icon.svg)
// on a postage stamp, one per theme. Run: swift ios/tools/make-icons.swift
import SwiftUI
import AppKit

struct Perforated: Shape {
    var bite: CGFloat, spacing: CGFloat
    func path(in r: CGRect) -> Path {
        var holes = Path()
        func run(_ a: CGPoint, _ b: CGPoint) {
            let n = max(1, Int(hypot(b.x - a.x, b.y - a.y) / spacing))
            for i in 0...n {
                let f = CGFloat(i) / CGFloat(n)
                holes.addEllipse(in: CGRect(x: a.x + (b.x - a.x) * f - bite, y: a.y + (b.y - a.y) * f - bite, width: bite * 2, height: bite * 2))
            }
        }
        run(CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY))
        run(CGPoint(x: r.minX, y: r.maxY), CGPoint(x: r.maxX, y: r.maxY))
        run(CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.minX, y: r.maxY))
        run(CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY))
        return Path(r).subtracting(holes)
    }
}

struct Bookmark: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.midX, y: r.maxY - r.height * 0.21))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}

struct Icon: View {
    let table: Color, stamp: Color, ink: Color, dot: Color, frame: Color
    var body: some View {
        ZStack {
            table
            ZStack {
                Perforated(bite: 22, spacing: 62).fill(stamp)
                    .shadow(color: .black.opacity(0.18), radius: 18, x: 6, y: 14)
                RoundedRectangle(cornerRadius: 6).stroke(frame, lineWidth: 10).padding(64)
                Bookmark().fill(ink).frame(width: 290, height: 450)
                Circle().fill(dot).frame(width: 96, height: 96).offset(y: -78)
            }
            .frame(width: 640, height: 760)
            .rotationEffect(.degrees(-4))
        }
        .frame(width: 1024, height: 1024)
    }
}

func hex(_ v: UInt32) -> Color { Color(.sRGB, red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255) }

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ios/App/Assets.xcassets")
let icons: [(String, Icon)] = [
    ("AppIcon", Icon(table: hex(0xEDE6DA), stamp: hex(0xFBF8F2), ink: hex(0x24439A), dot: hex(0xA8342A), frame: hex(0x24439A).opacity(0.35))),
    ("AppIconLinen", Icon(table: hex(0xDCE0D9), stamp: hex(0xF8F9F6), ink: hex(0x3F5B45), dot: hex(0xB9924F), frame: hex(0x3F5B45).opacity(0.35))),
    ("AppIconInk", Icon(table: hex(0x111111), stamp: hex(0xFFFFFF), ink: hex(0x111111), dot: hex(0xA8342A), frame: hex(0x111111).opacity(0.3))),
]

@MainActor func write(_ view: Icon, to url: URL) throws {
    let r = ImageRenderer(content: view)
    r.scale = 1
    guard let cg = r.cgImage else { throw NSError(domain: "icon", code: 1) }
    let rep = NSBitmapImageRep(cgImage: cg)
    try rep.representation(using: .png, properties: [:])!.write(to: url)
}

let fm = FileManager.default
try fm.createDirectory(at: root, withIntermediateDirectories: true)
try #"{"info":{"author":"xcode","version":1}}"#.write(to: root.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
for (name, view) in icons {
    let set = root.appendingPathComponent("\(name).appiconset")
    try fm.createDirectory(at: set, withIntermediateDirectories: true)
    try MainActor.assumeIsolated { try write(view, to: set.appendingPathComponent("icon-1024.png")) }
    try #"{"images":[{"filename":"icon-1024.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}"#
        .write(to: set.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
    // A small copy for the icon picker in Settings.
    let preview = root.appendingPathComponent("\(name)Preview.imageset")
    try fm.createDirectory(at: preview, withIntermediateDirectories: true)
    try MainActor.assumeIsolated { try write(view, to: preview.appendingPathComponent("preview.png")) }
    try #"{"images":[{"filename":"preview.png","idiom":"universal"}],"info":{"author":"xcode","version":1}}"#
        .write(to: preview.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
    print("wrote \(name)")
}
