import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Home: the binder's front page. Index tabs across the top file every section one tap away (what
/// waits to be filed, Collections, Lifestyle, then each kind you have); the sheet under them lists
/// what needs you, your newest saves as ruled lines, and one save to come back to.
struct HomeScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var settings = false
    @State private var appearance = false
    @State private var fixingAll = false
    @State private var collections: [SaveCollection] = []
    /// Recent, in the order you've dragged it into.
    @State private var recentOrder: [String] = []
    @State private var dragging: String?
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Environment(\.horizontalSizeClass) private var size
    @Environment(\.dynamicTypeSize) private var typeSize
    /// The two sections' tabs, in the order you've dragged them into (the Library's sections follow it).
    @State private var sectionOrder: [String] = HomeSections.order()

    private var lifestyleSaves: [Save] { model.glance?.lifestyle ?? model.index.lifestyle }
    /// Until the whole library is read, Home draws from the launch glance (newest saves, counts).
    private var newest: [Save] { model.glance?.recent ?? Array(model.saves.prefix(8)) }
    private var collectionCount: Int { model.glance?.collections ?? collections.count }
    private var lifestyleKinds: Int { model.glance?.lifestyleKinds ?? Set(lifestyleSaves.map(\.kind)).count }
    /// Kinds with something in them, most saves first (a tie keeps the app's usual order).
    private var kinds: [(kind: String, count: Int)] {
        KindStyle.lifestyle.map { ($0, model.index.kind($0).count) }.filter { $0.1 > 0 }
            .enumerated().sorted { $0.element.1 != $1.element.1 ? $0.element.1 > $1.element.1 : $0.offset < $1.offset }.map(\.element)
    }

    /// Saved over six weeks ago and not opened since (Home's "Come back to" in Chrome).
    private var comeBackTo: Save? { model.index.comeBackTo }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // At accessibility sizes the buttons drop below the name, so the name gets the full width.
                    (typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .trailing, spacing: 4)) : AnyLayout(HStackLayout(alignment: .top))) {
                        Wordmark()
                        if size != .regular {
                            // One piece of glass for the header's controls.
                            GlassEffectContainer(spacing: 10) {
                                HStack(spacing: 10) {
                                    if model.aiReady && !model.saves.isEmpty {
                                        headerButton("sparkles", "Fix everything with AI") { fixingAll = true }
                                            .disabled(model.aiRun != nil)
                                    }
                                    headerButton("paintpalette", "Appearance") { appearance = true }
                                    headerButton("gearshape", "Settings") { settings = true }
                                }
                            }
                            .padding(.top, 8)
                        }
                    }
                    .padding(.horizontal, 4)
                    VStack(alignment: .leading, spacing: -1) {
                        tabs.zIndex(1)
                        sheet
                    }
                }
                .padding(.horizontal, KSBinder.outer).padding(.bottom, 40)
            }
            .clearsTabBar()
            .safeAreaInset(edge: .top, spacing: 0) { TopScrim() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $settings) { SettingsScreen() }
        .confirmationDialog("Fix all \(model.saves.count) saves with AI?", isPresented: $fixingAll, titleVisibility: .visible) {
            Button("Fix everything") { Task { await model.fixWithAI(model.saves, screen: true) } }
        } message: {
            Text("\(model.aiReadsAgain) Every change can be undone. Fix one collection or Lifestyle view from its own page.")
        }
        .sheet(isPresented: $appearance) { AppearanceSheet() }
        .task(id: "\(model.saves.count)|\(model.collectionsChanged)") { collections = (try? model.library?.collections()) ?? [] }
        // The newest eight, in your order; a new save joins at the front.
        .onChange(of: newest.map(\.id), initial: true) { _, latest in
            recentOrder = latest.arranged(by: SavedOrder.get("recentOrder"), newFirst: true) { $0 }
        }
    }

    private func headerButton(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { GlassIcon(symbol) }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
    }

    /// The index tabs: Recent in front, then every other section, scrolling sideways when they outrun the
    /// sheet. At accessibility text sizes the others wrap onto rows above Recent, so none is off the screen.
    @ViewBuilder private var tabs: some View {
        let recent = IndexTab("Recent", front: true).accessibilityAddTraits([.isHeader, .isSelected])
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                Flow(spacing: 4) { otherTabs }.buttonStyle(PressStyle())
                recent
            }
        } else {
            ScrollView(.horizontal) {
                HStack(alignment: .bottom, spacing: 4) {
                    recent
                    otherTabs
                }
                .buttonStyle(PressStyle())
                .padding(.trailing, KSBinder.outer)
            }
            .scrollIndicators(.hidden)
            .padding(.trailing, -KSBinder.outer)
        }
    }

    /// What waits to be filed, the two sections in their kept order, then each kind that has saves.
    @ViewBuilder private var otherTabs: some View {
        if model.reviewCount > 0 {
            NavigationLink(value: Route.review) { IndexTab("To file", symbol: "tray", count: model.reviewCount) }
                .accessibilityHint("Opens the saves waiting for a collection")
        }
        ForEach(sectionOrder, id: \.self) { section in
            Group {
                if section == "collections" {
                    NavigationLink(value: Route.collections) { IndexTab("Collections", symbol: "bag", count: collectionCount) }
                        .accessibilityHint("Opens Collections")
                } else {
                    NavigationLink(value: Route.lifestyle) { IndexTab("Lifestyle", symbol: "sparkles", count: lifestyleKinds) }
                        .accessibilityHint("Opens Lifestyle")
                }
            }
            // Hold one and slide it past the other to swap them.
            .reorderable(section, in: $sectionOrder, dragging: $dragging, reduce: reduce) { SavedOrder.set(HomeSections.key, $0) }
        }
        ForEach(kinds, id: \.kind) { k in
            NavigationLink(value: Route.kind(k.kind)) {
                IndexTab(KindStyle(k.kind).plural, symbol: KindStyle(k.kind).symbol, count: k.count, kind: k.kind)
            }
            .accessibilityHint("Opens \(KindStyle(k.kind).plural)")
        }
    }

    private var sheet: some View {
        BinderSheet {
            SheetHeading("Recent", note: model.saves.isEmpty ? nil : model.saves.count == 1 ? "1 save in the binder" : "\(model.saves.count.formatted()) saves in the binder")
                .padding(.top, 16).padding(.bottom, 12)
            VStack(alignment: .leading, spacing: 8) {
                if model.reviewCount > 0 {
                    NavigationLink(value: Route.review) { NeedsCollectionStrip(count: model.reviewCount) }
                        .buttonStyle(PressStyle())
                }
                if showAppleNote { appleNote }
                FinishFixingButton()
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                if model.aiReady && !model.aiBacklog.isEmpty {
                    RunAIOnImportedButton()
                        .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).padding(.horizontal, 12)
                        .sheetNote()
                }
            }
            .padding(.bottom, 12)
            if let problem = model.problem {
                SheetRule()
                EmptyNote(symbol: "exclamationmark.triangle", text: problem).padding(.bottom, 24)
            } else if model.saves.isEmpty && model.loaded {
                SheetRule()
                EmptyNote(symbol: "bookmark", text: "Save something worth coming back to. Share a page, a post or a place to Internet Binder from any app.")
                    .padding(.bottom, 24)
            } else if newest.isEmpty {
                // Reading the library: lines the size of real ones, so nothing jumps when they arrive.
                ForEach(0..<4, id: \.self) { _ in
                    SheetRule()
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: KSBinder.pictureRadius, style: .continuous).fill(t.well).frame(width: KSBinder.picture, height: KSBinder.picture)
                        RoundedRectangle(cornerRadius: 4, style: .continuous).fill(t.well).frame(height: 14).frame(maxWidth: 180)
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: KSBinder.line)
                }
                .accessibilityHidden(true)
            }
            ForEach(recentOrder.compactMap { id in newest.first { $0.id == id } }) { save in
                SheetRule()
                NavigationLink(value: save) { SaveRow(save).matchedTransitionSource(id: save.id, in: zoom) }
                    .buttonStyle(RowPressStyle())
                    // Hold and slide to put Recent in your own order.
                    .reorderable(save.id, in: $recentOrder, dragging: $dragging, reduce: reduce) { SavedOrder.set("recentOrder", $0) }
                    // Long press: the same menu as the Library's lines.
                    .contextMenu { SaveMenu(save: save) }
                    .accessibilityAction(named: "Move to Trash") { Task { await model.trash(save) } }
            }
            if let save = comeBackTo {
                SheetRule()
                SheetHeading("Come back to").padding(.top, 24).padding(.bottom, 4)
                NavigationLink(value: save) { SaveRow(save).matchedTransitionSource(id: save.id, in: zoom) }
                    .buttonStyle(RowPressStyle())
                    .contextMenu { SaveMenu(save: save) }
            }
        }
    }

    /// Apple Intelligence's state, once per state: on a new install (or the first open after it arrived) it
    /// says it's on, or how to turn it on; dismissed, it comes back only when the state changes (turned on
    /// later, say). Never on a device that can't run it.
    @AppStorage("ks.appleAINoteSeen") private var appleNoteSeen = ""
    private var showAppleNote: Bool { model.loaded && model.appleAI != .unsupported && appleNoteSeen != model.appleAI.rawValue }

    private var appleNote: some View {
        let (title, line): (String, String) = switch model.appleAI {
        case .ready: ("Apple Intelligence is on", "It reads your saves on this iPhone and fixes what it can, as they come in. Nothing leaves your iPhone.")
        case .off: ("Turn on Apple Intelligence", "In the Settings app, under Apple Intelligence & Siri. Then your saves are read and fixed on this iPhone.")
        default: ("Apple Intelligence is getting ready", "Once it has downloaded, your saves are read and fixed on this iPhone.")
        }
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: "apple.intelligence").font(.body.weight(.semibold)).foregroundStyle(t.accent)
                .padding(.top, 12)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                Text(line).font(.footnote).foregroundStyle(t.inkMuted).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 12)
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            Button {
                withAnimation(reduce ? nil : .snappy) { appleNoteSeen = model.appleAI.rawValue }
            } label: {
                Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(t.inkMuted)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .padding(.leading, 12)
        .sheetNote()
        .accessibilityIdentifier("appleAINote")
    }
}

/// "Internet Binder" in the appearance's display face, with its line under it. Nocturne lights the
/// second word in amber.
struct Wordmark: View {
    @Environment(\.ks) private var t
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Group {
                if t.style == .nocturne {
                    Text("Internet ") + Text("Binder").foregroundStyle(t.accent)
                } else {
                    Text("Internet Binder")
                }
            }
            .font(KSFont.display())
            .foregroundStyle(t.ink)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel("Internet Binder")
            if let line = t.tagline {
                Text(line).font(t.style == .nocturne ? .subheadline.italic() : .subheadline).foregroundStyle(t.inkMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }
}

/// Home's two section tabs (and the Library's sections), in the order kept for them: Collections first
/// unless Lifestyle was dragged above it.
enum HomeSections {
    static let key = "homeSectionOrder"
    static func order(_ saved: String? = nil) -> [String] {
        ["collections", "lifestyle"].arranged(by: saved.map { $0.split(separator: "\n").map(String.init) } ?? SavedOrder.get(key)) { $0 }
    }
}
