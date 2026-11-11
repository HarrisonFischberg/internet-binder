import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Design exploration (branch design/explore, Debug builds only): `-design A|B|C` redraws Home and a
/// recipe's page in one of three directions (DesignA.swift, DesignB.swift, DesignC.swift). Without the
/// argument, and in Release, the app is unchanged.
///   -designOpen "<title prefix>"   opens that save from Home once the library is read
///   -designChecked <n>             ticks a recipe's first n ingredients (in the shipping page too)
///   -designDone "<title prefix>"   marks that save done
enum DesignSwitch {
    #if DEBUG
    static let variant = UserDefaults.standard.string(forKey: "design")
    static let checked = Set(0..<UserDefaults.standard.integer(forKey: "designChecked"))
    #else
    static let variant: String? = nil
    static let checked: Set<Int> = []
    #endif

    #if DEBUG
    @MainActor static func stage(_ model: LibraryModel) async {
        let d = UserDefaults.standard
        guard d.string(forKey: "designOpen") != nil || d.string(forKey: "designDone") != nil else { return }
        while !model.loaded || model.saves.isEmpty { try? await Task.sleep(for: .milliseconds(200)) }
        if let title = d.string(forKey: "designDone"), let s = model.saves.first(where: { $0.title.hasPrefix(title) }), s.status != "done" {
            await model.setDone(s, true)
        }
        if let title = d.string(forKey: "designOpen"), let s = model.saves.first(where: { $0.title.hasPrefix(title) }) {
            model.opening = (stack: "home", id: s.id)
        }
    }
    #endif
}

/// Home, or a direction's Home.
struct HomeRoot: View {
    let zoom: Namespace.ID
    var body: some View {
        #if DEBUG
        switch DesignSwitch.variant {
        case "A": DesignAHome()
        case "B": DesignBHome()
        case "C": DesignCHome()
        default: HomeScreen(zoom: zoom)
        }
        #else
        HomeScreen(zoom: zoom)
        #endif
    }
}

/// A save's page, or a direction's recipe page.
struct SaveRoot: View {
    let save: Save
    var body: some View {
        #if DEBUG
        switch (save.kind == "recipe" ? DesignSwitch.variant : nil) {
        case "A": DesignARecipe(save: save)
        case "B": DesignBRecipe(save: save)
        case "C": DesignCRecipe(save: save)
        default: SaveDetailScreen(save: save)
        }
        #else
        SaveDetailScreen(save: save)
        #endif
    }
}
