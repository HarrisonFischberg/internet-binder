import SwiftUI
import CoreLocation

enum Kind: String, CaseIterable {
    case place, recipe, film, book, product, video, article, workout
    var label: String {
        switch self {
        case .place: "Place"
        case .recipe: "Recipe"
        case .film: "Film"
        case .book: "Book"
        case .product: "Product"
        case .video: "Video"
        case .article: "Article"
        case .workout: "Workout"
        }
    }
    var symbol: String {
        switch self {
        case .place: "mappin.and.ellipse"
        case .recipe: "fork.knife"
        case .film: "film"
        case .book: "book"
        case .product: "bag"
        case .video: "play.rectangle"
        case .article: "doc.text"
        case .workout: "figure.strengthtraining.traditional"
        }
    }
}

/// Sample saves for the prototypes. Fictional names; photos are drawn gradients standing in
/// for the real thumbnails a save would carry.
struct Sample: Identifiable {
    let id: Int
    let kind: Kind
    let title: String
    let fact: String
    let source: String
    let photo: [UInt32]
    var aspect: CGFloat = 1
}

enum Samples {
    static let library: [Sample] = [
        Sample(id: 1, kind: .place, title: "Café Azulejo", fact: "Alfama, Lisbon · Café", source: "instagram.com",
               photo: [0x2F6F7A, 0x83B5B3, 0xE9D6B8, 0xC4704A, 0x2A4E5C, 0xF2E6CF, 0x9C4A2E, 0xDCC4A0, 0x3E7C86], aspect: 1.25),
        Sample(id: 2, kind: .recipe, title: "Brown butter pasta with sage", fact: "9 ingredients · 25 min", source: "Saved from Safari",
               photo: [0xF3D9A4, 0xC98A3B, 0x7A4A1E, 0xE8B866, 0xFBEFD2, 0x9E6428, 0x5B7A2E, 0xD9A55A, 0xF6E3BC], aspect: 0.8),
        Sample(id: 3, kind: .film, title: "The Long Summer", fact: "1998 · Film", source: "letterboxd.com",
               photo: [0x1B1D3A, 0x3A2F6B, 0xB8433A, 0x0E0F22, 0x6B3F7A, 0xE07A4A, 0x14152C, 0x2E2550, 0x9A3346], aspect: 1.4),
        Sample(id: 4, kind: .product, title: "Linen apron, washed olive", fact: "$48 · Fieldwork Goods", source: "fieldwork.example",
               photo: [0xE7E1D2, 0xB9B48F, 0x6E7046, 0xD8D2BD, 0xF4F0E6, 0x8A8A5C, 0xC9C2A6, 0xA3A27A, 0xEDE8DB], aspect: 1),
        Sample(id: 5, kind: .book, title: "Notes on Gardens", fact: "M. Ilves", source: "goodreads.com",
               photo: [0x23402F, 0x4F7A4E, 0xD8CFAE, 0x1A3024, 0x7FA06A, 0xEDE4C6, 0x2E5238, 0x5E8A5A, 0xC7BE98], aspect: 1.45),
        Sample(id: 6, kind: .video, title: "How to fold dumplings, three ways", fact: "Mia Chen · 8 min", source: "youtube.com",
               photo: [0xF7E9DD, 0xE0B48A, 0xA8603A, 0xFFF6EC, 0xD99A6C, 0x7A3E26, 0xF1D2B4, 0xC07A4E, 0xFAEBDD], aspect: 0.75),
        Sample(id: 7, kind: .workout, title: "Morning mobility", fact: "6 exercises · Hips", source: "instagram.com",
               photo: [0xD5E4E2, 0x7FB2AE, 0x2F6F6A, 0xEAF2F1, 0x9CC6C2, 0x1E5551, 0xC1DAD7, 0x5E9C97, 0xE2EEEC], aspect: 1.1),
        Sample(id: 8, kind: .article, title: "The case for slow cities", fact: "Longform · 12 min", source: "longform.example",
               photo: [0xDCE3EE, 0x8FA6C8, 0x3C5A8A, 0xEEF2F8, 0xA9BCD8, 0x2A4470, 0xC6D2E6, 0x6E89B4, 0xE6ECF5], aspect: 0.9),
        Sample(id: 9, kind: .place, title: "Ramen Kiri", fact: "Shibuya, Tokyo · Ramen", source: "maps.apple.com",
               photo: [0x2A1A14, 0x8A3B22, 0xE8A24A, 0x1A100C, 0xC2622E, 0xF6D08A, 0x3A2018, 0xA44A26, 0xE89A42], aspect: 1.2),
        Sample(id: 10, kind: .recipe, title: "Charred corn salad", fact: "7 ingredients · 15 min", source: "instagram.com",
               photo: [0xF6E27A, 0xE2B13C, 0x5E8A2E, 0xFBF0B0, 0xD9932E, 0x3E6A22, 0xEFD35E, 0xB86E28, 0x8CB04A], aspect: 1),
    ]

    static var place: Sample { library[0] }
    static var recipe: Sample { library[1] }

    static let placeCoordinate = CLLocationCoordinate2D(latitude: 38.7118, longitude: -9.1300)
    static let placeAddress = "Rua de São Miguel, Alfama, Lisbon"
    static let placeHours = "Open today 8:00–18:00"

    static let ingredients: [(String, String)] = [
        ("350 g", "rigatoni"),
        ("90 g", "butter"),
        ("12", "sage leaves"),
        ("2", "cloves garlic, sliced"),
        ("60 g", "parmesan, grated"),
        ("1", "lemon, zested"),
        ("", "black pepper"),
        ("", "salt, for the water"),
        ("40 g", "toasted walnuts"),
    ]
    static let steps = [
        "Boil the pasta in well-salted water until just shy of done. Keep a mug of the water.",
        "Melt the butter over medium heat. Let it foam, then turn nutty and brown, about 4 minutes.",
        "Add sage and garlic for 30 seconds, until the leaves crisp.",
        "Toss in the pasta with a splash of water and the parmesan until glossy. Finish with lemon and walnuts.",
    ]
}

/// A drawn stand-in for a photo: a soft mesh in the save's colours, with a light grain.
struct SamplePhoto: View {
    let colors: [UInt32]
    var body: some View {
        MeshGradient(width: 3, height: 3,
                     points: [[0, 0], [0.5, 0], [1, 0],
                              [0, 0.5], [0.62, 0.42], [1, 0.5],
                              [0, 1], [0.45, 1], [1, 1]],
                     colors: colors.map { Color(hex: $0) })
            .overlay(Grain().opacity(0.10).blendMode(.overlay))
    }
}

struct Grain: View {
    var body: some View {
        Canvas { ctx, size in
            var rng = SplitMix(seed: 7)
            let n = Int(size.width * size.height / 18)
            for _ in 0..<n {
                let x = Double(rng.next() % 10_000) / 10_000 * size.width
                let y = Double(rng.next() % 10_000) / 10_000 * size.height
                let w = Double(rng.next() % 100) / 100
                ctx.fill(Path(CGRect(x: x, y: y, width: 1, height: 1)), with: .color(white: w))
            }
        }
        .allowsHitTesting(false)
    }
}

struct SplitMix {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}
