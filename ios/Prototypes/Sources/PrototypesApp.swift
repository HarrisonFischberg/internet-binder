import SwiftUI

enum Screen: String, CaseIterable, Identifiable {
    case library, place, recipe, share
    var id: String { rawValue }
}

@main
struct PrototypesApp: App {
    var body: some Scene {
        WindowGroup { Root() }
    }
}

/// Launch with `-direction postcard|cabinet|daylight -screen library|place|recipe|share -shot YES`
/// to render one screen for a screenshot; without `-shot`, a small switcher floats on top.
struct Root: View {
    @Environment(\.colorScheme) private var scheme
    @State private var direction = Direction(rawValue: UserDefaults.standard.string(forKey: "direction") ?? "") ?? .postcard
    @State private var screen = Screen(rawValue: UserDefaults.standard.string(forKey: "screen") ?? "") ?? .library
    private let shot = UserDefaults.standard.bool(forKey: "shot")

    var body: some View {
        Group {
            switch screen {
            case .library: LibraryScreen()
            case .place: PlaceScreen()
            case .recipe: RecipeScreen()
            case .share: ShareScreen()
            }
        }
        .id("\(direction.rawValue)-\(screen.rawValue)")
        .environment(\.theme, Theme(direction: direction, dark: scheme == .dark))
        .overlay(alignment: .topTrailing) {
            if !shot {
                Menu {
                    Picker("Direction", selection: $direction) {
                        ForEach(Direction.allCases) { Text($0.title).tag($0) }
                    }
                    Picker("Screen", selection: $screen) {
                        ForEach(Screen.allCases) { Text($0.rawValue.capitalized).tag($0) }
                    }
                } label: {
                    Image(systemName: "paintpalette").padding(10).background(.thinMaterial, in: Circle())
                }
                .padding(.trailing, 70)
            }
        }
    }
}
