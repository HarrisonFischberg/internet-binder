#if canImport(UIKit)
import SwiftUI

/// A rectangle with round bites along its edges: a stamp, or a punched strip.
public struct Perforated: Shape {
    var bite: CGFloat = 2.6
    var spacing: CGFloat = 8
    var edges: Edge.Set = .all
    public init(bite: CGFloat = 2.6, spacing: CGFloat = 8, edges: Edge.Set = .all) { self.bite = bite; self.spacing = spacing; self.edges = edges }
    public func path(in r: CGRect) -> Path {
        var holes = Path()
        func run(_ a: CGPoint, _ b: CGPoint) {
            let n = max(1, Int(hypot(b.x - a.x, b.y - a.y) / spacing))
            for i in 0...n {
                let f = CGFloat(i) / CGFloat(n)
                holes.addEllipse(in: CGRect(x: a.x + (b.x - a.x) * f - bite, y: a.y + (b.y - a.y) * f - bite, width: bite * 2, height: bite * 2))
            }
        }
        if edges.contains(.top) { run(CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY)) }
        if edges.contains(.bottom) { run(CGPoint(x: r.minX, y: r.maxY), CGPoint(x: r.maxX, y: r.maxY)) }
        if edges.contains(.leading) { run(CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.minX, y: r.maxY)) }
        if edges.contains(.trailing) { run(CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY)) }
        return Path(r).subtracting(holes)
    }
}

/// A round price sticker: a circle with a wavy edge of `bumps` scallops.
public struct Scallop: Shape {
    var bumps = 14
    public init(bumps: Int = 14) { self.bumps = bumps }
    public func path(in r: CGRect) -> Path {
        let c = CGPoint(x: r.midX, y: r.midY)
        let outer = min(r.width, r.height) / 2
        let inner = outer * 0.9
        var p = Path()
        let steps = bumps * 12
        for i in 0...steps {
            let a = Double(i) / Double(steps) * 2 * .pi - .pi / 2
            let radius = inner + (outer - inner) * CGFloat((1 + cos(a * Double(bumps))) / 2)
            let pt = CGPoint(x: c.x + radius * CGFloat(cos(a)), y: c.y + radius * CGFloat(sin(a)))
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        p.closeSubpath()
        return p
    }
}

/// A ticket: two half-moon notches where the stub tears off.
public struct TicketShape: Shape {
    var stub: CGFloat = 54
    public init(stub: CGFloat = 54) { self.stub = stub }
    public func path(in r: CGRect) -> Path {
        let x = r.maxX - stub
        var notches = Path()
        notches.addEllipse(in: CGRect(x: x - 7, y: r.minY - 7, width: 14, height: 14))
        notches.addEllipse(in: CGRect(x: x - 7, y: r.maxY - 7, width: 14, height: 14))
        return Path(roundedRect: r, cornerRadius: 5).subtracting(notches)
    }
}

/// Paper torn along the top.
public struct ClippingShape: Shape {
    public init() {}
    public func path(in r: CGRect) -> Path {
        var p = Path()
        var state: UInt64 = 11
        func next() -> UInt64 { state = state &* 6364136223846793005 &+ 1442695040888963407; return state >> 33 }
        p.move(to: CGPoint(x: r.minX, y: r.minY + 4))
        var x = r.minX
        while x < r.maxX {
            x = min(r.maxX, x + CGFloat(4 + next() % 6))
            p.addLine(to: CGPoint(x: x, y: r.minY + CGFloat(next() % 6)))
        }
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}

/// A swing tag: clipped top corners and a punched hole.
public struct TagShape: Shape {
    public init() {}
    public func path(in r: CGRect) -> Path {
        let c: CGFloat = 12
        var p = Path()
        p.move(to: CGPoint(x: r.minX + c, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - c, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY + c))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + c))
        p.closeSubpath()
        return p.subtracting(Path(ellipseIn: CGRect(x: r.midX - 4, y: r.minY + 7, width: 8, height: 8)))
    }
}

/// A horizontal line through the middle (a dashed row rule).
public struct Line: Shape {
    public init() {}
    public func path(in r: CGRect) -> Path { var p = Path(); p.move(to: CGPoint(x: r.minX, y: r.midY)); p.addLine(to: CGPoint(x: r.maxX, y: r.midY)); return p }
}

struct VLine: Shape {
    func path(in r: CGRect) -> Path { var p = Path(); p.move(to: CGPoint(x: r.midX, y: r.minY)); p.addLine(to: CGPoint(x: r.midX, y: r.maxY)); return p }
}
#endif
