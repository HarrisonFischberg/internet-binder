import SwiftUI
import UniformTypeIdentifiers
import KeepsakeKit
import KeepsakeUI

/// Settings: Optional AI, Lookups, the change log, import and export, privacy, and erase.
/// Everything that sends anything anywhere is off until turned on, and says exactly what it sends
/// (the same wording as Chrome's PRIVACY.md).
struct SettingsScreen: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var settings: [String: Any] = [:]
    @State private var aiOn = false
    @State private var readPosts = true
    @State private var provider = "anthropic"
    @State private var aiModel = SettingsScreen.claudeModels[0].id
    @State private var effort = "medium"
    @State private var key = ""
    @State private var lookups: [String: Bool] = ["places": false, "media": false, "books": false]
    @State private var consent: Consent?
    @State private var exportDoc: ExportDocument?
    @State private var importing = false
    @State private var erasing = false
    @State private var testResult: String?
    @AppStorage(CookingMusic.enabledKey) private var cookingMusic = true
    @State private var saveNotices = SaveNotice.enabled
    @State private var noticesBlocked = false
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var phase
    @State private var fixingAll = false

    /// The Claude models on offer, cheapest first (provider.js MODELS). Haiku 5.5 is the default.
    static let claudeModels: [(id: String, name: String, note: String)] = [
        ("claude-haiku-5-5", "Claude Haiku 5.5", "Fastest and cheapest. Plenty for tidying saves."),
        ("claude-sonnet-5-5", "Claude Sonnet 5.5", "Sharper at reading pictures and pages."),
        ("claude-opus-5-5", "Claude Opus 5.5", "Most careful. Costs more per save."),
        ("claude-fable-5-1", "Claude Fable 5.1", "Most capable, and the most expensive."),
    ]
    /// How hard the model thinks before answering (provider.js EFFORTS). Medium is the default.
    static let efforts: [(id: String, name: String)] = [("low", "Low"), ("medium", "Medium"), ("high", "High")]

    enum Consent: Identifiable { case ai, lookup(String); var id: String { switch self { case .ai: "ai"; case .lookup(let k): k } } }

    var body: some View {
        NavigationStack {
            Form {
                aiSection
                lookupsSection
                instagramSection
                Section {
                    Toggle("Music while cooking", isOn: $cookingMusic)
                } footer: { Text("Ten quiet, original tunes play while you follow a recipe step by step. They stay silent when your iPhone is on silent and never stop a podcast or song you're already playing.") }
                noticesSection
                Section {
                    NavigationLink("Change log") { ChangeLogScreen() }
                } footer: { Text("Every change AI made, with Undo.") }
                Section("Your library") {
                    NavigationLink("Trash") { TrashScreen() }
                    Button("Export library", systemImage: "square.and.arrow.up") { Task { await export() } }
                    Button("Import from Chrome", systemImage: "square.and.arrow.down") { importing = true }
                }
                Section {
                    NavigationLink("Privacy") { PrivacyScreen() }
                    Button("Erase everything", role: .destructive) { erasing = true }
                } footer: { Text("Internet Binder has no account and no server. Your library stays on this iPhone.") }
                Section {} footer: {
                    Text("Internet Binder \(Self.version)")
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("appVersion")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
            .sheet(item: $consent) { c in ConsentSheet(consent: c) { accepted in Task { await decide(c, accepted) } } }
            .fileExporter(isPresented: Binding(get: { exportDoc != nil }, set: { if !$0 { exportDoc = nil } }), document: exportDoc, contentType: .json,
                          defaultFilename: "internet-binder-export-\(Date.now.formatted(.iso8601.year().month().day()))") { _ in exportDoc = nil }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { r in if case .success(let url) = r { Task { await model.importFile(url) } } }
            .sheet(isPresented: $erasing) { EraseSheet() }
            .confirmationDialog("Fix all \(model.saves.count) saves with AI?", isPresented: $fixingAll, titleVisibility: .visible) {
                Button("Fix everything") { dismiss(); Task { await model.fixWithAI(model.saves) } }
            } message: {
                Text("Your AI provider reads each save again: what it is from its picture, a product's shop page, and where it goes. Every change can be undone.")
            }
        }
    }

    // MARK: AI

    private var aiSection: some View {
        Section {
            Toggle("Optional AI", isOn: Binding(get: { aiOn }, set: { on in
                if on { consent = .ai } else { Task { aiOn = false; try? await model.library?.updateSettings(["ai": ["on": false]]); await model.refreshAIReady() } }
            }))
            if aiOn {
                // A new provider starts on its own default model. (Bindings, not onChange, so loading
                // the saved settings never writes them back.)
                Picker("Provider", selection: Binding(get: { provider }, set: { p in
                    guard p != provider else { return }
                    provider = p
                    aiModel = Self.claudeModels[0].id
                    Task { try? await model.library?.updateSettings(["ai": ["provider": p, "model": ""]]) }
                })) {
                    Text("Anthropic").tag("anthropic")
                    Text("OpenAI").tag("openai")
                }
                if provider == "anthropic" {
                    Picker("Model", selection: Binding(get: { aiModel }, set: { m in
                        aiModel = m
                        Task { try? await model.library?.updateSettings(["ai": ["model": m]]) }
                    })) {
                        ForEach(Self.claudeModels, id: \.id) { m in Text(m.name).tag(m.id) }
                        if !Self.claudeModels.contains(where: { $0.id == aiModel }) { Text(aiModel).tag(aiModel) }
                    }
                    Picker("Effort", selection: Binding(get: { effort }, set: { e in
                        effort = e
                        Task { try? await model.library?.updateSettings(["ai": ["effort": e]]) }
                    })) {
                        ForEach(Self.efforts, id: \.id) { e in Text(e.name).tag(e.id) }
                    }
                    if let note = Self.claudeModels.first(where: { $0.id == aiModel })?.note {
                        Text("\(note) Effort is how long it thinks first; Medium suits most saves.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                SecureField("Your API key", text: $key)
                    .textContentType(.password).autocorrectionDisabled().textInputAutocapitalization(.never)
                    .onSubmit { Task { try? await model.library?.setAIKey(key); await model.refreshAIReady() } }
                Button("Save key and test") {
                    Task {
                        try? await model.library?.setAIKey(key)
                        await model.refreshAIReady()
                        do { try await model.library?.testAI(); testResult = "Connected." } catch { testResult = error.localizedDescription }
                    }
                }
                if let testResult { Text(testResult).font(.footnote).foregroundStyle(.secondary) }
                if model.aiReady && !model.saves.isEmpty {
                    Button("Fix every save with AI", systemImage: "sparkles") { fixingAll = true }
                        .disabled(model.aiRun != nil)
                }
                RunAIOnImportedButton()
            }
        } header: { Text("Optional AI") } footer: {
            Text("Off by default. Uses your own key, kept in this iPhone's Keychain and never exported. Sends only what each feature says, to the provider you choose.")
        }
    }

    /// "Saved to …" notifications after a Share Sheet save (SaveNotice).
    private var noticesSection: some View {
        Section {
            Toggle("Notify after saving", isOn: Binding(get: { saveNotices }, set: { on in
                saveNotices = on
                SaveNotice.enabled = on
                if on { Task { await SaveNotice.ask(); noticesBlocked = await SaveNotice.blocked() } }
            }))
            if saveNotices && noticesBlocked {
                Button("Allow notifications in iOS Settings", systemImage: "bell.badge") {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                }
            }
        } header: { Text("Notifications") } footer: {
            Text(saveNotices && noticesBlocked
                 ? "Notifications are off for Internet Binder in iOS Settings, so nothing shows after a save."
                 : "After you save from the Share Sheet, a notification drops in from the top saying where it went. Tap it to open that save in Internet Binder.")
        }
        .task(id: phase) { noticesBlocked = await SaveNotice.blocked() }
    }

    /// "2.1.1 (1)": the version and build, from the app's bundle.
    static var version: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let v = info["CFBundleShortVersionString"] as? String ?? "?"
        let b = info["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    // MARK: Lookups

    private var lookupsSection: some View {
        Section {
            lookupToggle("places", "Places: OpenStreetMap")
            lookupToggle("media", "Films & shows: Wikidata")
            lookupToggle("books", "Books: Open Library")
        } header: { Text("Lookups") } footer: {
            Text("Off by default. Fill in a place's address and pin, a film's details or a book's from free public sources. Only missing details are filled; nothing you typed is changed.")
        }
    }

    // MARK: Instagram

    /// Chrome's Read post details (settings.instagram.readPostDetails, on unless turned off).
    private var instagramSection: some View {
        Section {
            Toggle("Read posts you share", isOn: Binding(get: { readPosts }, set: { on in
                readPosts = on
                Task { try? await model.library?.updateSettings(["instagram": ["readPostDetails": on]]) }
            }))
        } header: { Text("Instagram") } footer: {
            Text("When you share a post or reel, Internet Binder opens its public page once, without your account or cookies, to save its caption, creator, date and picture. Turn off to save just the link.")
        }
    }

    private func lookupToggle(_ key: String, _ title: String) -> some View {
        Toggle(title, isOn: Binding(get: { lookups[key] ?? false }, set: { on in
            if on { consent = .lookup(key) } else { Task { lookups[key] = false; try? await model.library?.updateSettings(["lookups": [key: false]]) } }
        }))
    }

    // MARK: actions

    private func load() async {
        guard let lib = model.library, let s = try? await lib.settings() else { return }
        settings = s
        let ai = s["ai"] as? [String: Any] ?? [:]
        aiOn = ai["on"] as? Bool ?? false
        provider = ai["provider"] as? String ?? "anthropic"
        let m = ai["model"] as? String ?? ""
        aiModel = m.isEmpty ? Self.claudeModels[0].id : m
        effort = ai["effort"] as? String ?? "medium"
        key = (try? await lib.aiKey()) ?? ""
        readPosts = (s["instagram"] as? [String: Any])?["readPostDetails"] as? Bool ?? true
        let l = s["lookups"] as? [String: Any] ?? [:]
        for k in lookups.keys { lookups[k] = l[k] as? Bool ?? false }
    }

    private func decide(_ c: Consent, _ accepted: Bool) async {
        guard accepted, let lib = model.library else { return }
        switch c {
        case .ai:
            try? await lib.updateSettings(["ai": ["on": true, "provider": provider]])
            aiOn = true
            await model.refreshAIReady()
        case .lookup(let k):
            try? await lib.updateSettings(["lookups": [k: true]])
            lookups[k] = true
            Task { try? await lib.finishSaves(); model.refresh() }
        }
        Haptic.settled()
    }

    private func export() async {
        guard let data = try? await model.library?.exportData() else { return }
        exportDoc = ExportDocument(data: data)
    }
}

/// What turning a network feature on sends, in plain words, before it's on.
struct ConsentSheet: View {
    let consent: SettingsScreen.Consent
    let decide: (Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.ks) private var t

    private var title: String {
        switch consent {
        case .ai: "Turn on Optional AI?"
        case .lookup("places"): "Look up places on OpenStreetMap?"
        case .lookup("media"): "Look up films and shows on Wikidata?"
        default: "Look up books on Open Library?"
        }
    }
    private var points: [String] {
        switch consent {
        case .ai: [
            "Uses your own key with the provider you choose. Internet Binder has no AI server.",
            "After a save: its title, caption or description, hashtags, location tag, site and the thumbnail stored on this iPhone, to work out what it is (a recipe, workout, place…) and fill in its card. What the post doesn't say is drafted and marked AI draft. You can undo every change.",
            "Something to buy (an Instagram or Facebook post of a product, say) is worked out from its picture, since a post's caption can be wrong. Your provider searches the web for the product, and Internet Binder reads the one shop page it found, without cookies, for its name, price and details. The card shows the shop's facts first and the AI's summary beside them.",
            "Its price, shop and your collection names also go, to tidy the title and pick a collection.",
            "Nothing else is fetched from the pages a post links to on this iPhone.",
            "Nothing is sent until you add a key. Turning this off stops it at once.",
        ]
        case .lookup("places"): ["Each place's name and city (and street, if known) goes to nominatim.openstreetmap.org, at most one a second.", "Only a result with the same name in the same area is used.", "No cookies, no account."]
        case .lookup("media"): ["The title (and year, if known) of films and shows goes to www.wikidata.org.", "Posters load from Wikimedia Commons.", "No cookies, no account."]
        default: ["The title (and author, if known) of books goes to openlibrary.org.", "Covers load from covers.openlibrary.org.", "No cookies, no account."]
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(title).font(KSFont.name(.title2))
                    ForEach(points, id: \.self) { p in
                        Label(p, systemImage: "arrow.up.right.circle").font(.body)
                    }
                }
                .foregroundStyle(t.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            // The buttons sit on their own solid bar under the text, so the text scrolls above them and
            // never runs underneath (the sheet's glass showed it through before).
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HStack(spacing: 12) {
                    Button("Not now") { decide(false); dismiss() }.buttonStyle(.bordered).frame(minHeight: 44)
                    PrimarySlab("Turn on", symbol: "checkmark") { decide(true); dismiss() }
                }
                .dynamicTypeSize(...DynamicTypeSize.large)
                .padding(16)
                .frame(maxWidth: .infinity)
                .background(t.table.ignoresSafeArea(edges: .bottom))
                .overlay(alignment: .top) { Rectangle().fill(t.style == .pantry ? t.line : t.rule).frame(height: t.style == .pantry ? 2 : 1) }
            }
            .background(t.table.ignoresSafeArea())
            .onAppear { Haptic.warning() }
        }
        .presentationDetents([.large])
    }
}

/// AI's changes, newest first, each with Undo (Chrome's change log).
struct ChangeLogScreen: View {
    @Environment(LibraryModel.self) private var model
    @State private var log: [AIChange] = []
    var body: some View {
        List {
            if log.isEmpty { Text("AI hasn't changed anything.").foregroundStyle(.secondary) }
            ForEach(log) { e in
                VStack(alignment: .leading, spacing: 4) {
                    Text(e.itemTitle ?? "A save").font(.headline)
                    ForEach(e.changes, id: \.self) { c in
                        Text("\(c.field): \(c.from ?? "") → \(c.to ?? "")").font(.footnote).foregroundStyle(.secondary)
                    }
                    if e.undone { Text("Undone").font(.caption).foregroundStyle(.secondary) }
                    else {
                        Button("Undo") { Task { try? await model.library?.undoAI([e.id]); await load(); model.refresh() } }
                            .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                    }
                }
            }
        }
        .navigationTitle("Change log")
        .task { await load() }
    }
    private func load() async { log = (try? await model.library?.aiLog()) ?? [] }
}

/// Every network path in plain words (mirrors PRIVACY.md for iOS).
struct PrivacyScreen: View {
    var body: some View {
        List {
            Section("On this iPhone") {
                Text("Your saves, collections, goals and settings live in Internet Binder's storage on this device. No account, no Internet Binder server, no analytics.")
                Text("Your AI key is kept in the Keychain on this device and never exported.")
            }
            Section("When Internet Binder uses the network") {
                Text("Pictures of your saves load from the sites they came from, as a web page loads them. A small copy is kept on this iPhone so the picture stays if the site removes it.")
                Text("Maps are drawn by Apple Maps. Directions open Apple Maps with the place's name and address.")
                Text("Optional AI and each Lookup: only when you turn them on, and only what their switch says.")
                Text("Sharing from Safari: Internet Binder reads the page you shared, on this iPhone.")
                Text("Sharing an Instagram post or reel: Internet Binder opens that post's public page once, without your account or cookies, to save its caption and picture. You can turn this off under Instagram.")
            }
        }
        .navigationTitle("Privacy")
    }
}

/// Erase needs the action typed out (components.md TypedConfirm).
struct EraseSheet: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This deletes every save, collection, goal and setting on this iPhone. It can't be undone. Export first if you might want them back.")
                    TextField("Type ERASE to confirm", text: $typed).textInputAutocapitalization(.characters)
                }
                Button("Erase everything", role: .destructive) {
                    Task {
                        try? await model.library?.eraseEverything()
                        ThumbnailStore.shared.removeAll()
                        model.refresh()
                        Haptic.trashed()
                        dismiss()
                    }
                }
                .disabled(typed != "ERASE")
            }
            .navigationTitle("Erase everything").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

/// The export file: Chrome's own export format (keepsake-export, schema 3).
struct ExportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

/// The Trash: deleted saves wait 30 days (Chrome's rule), restorable until then.
struct TrashScreen: View {
    @Environment(LibraryModel.self) private var model
    @State private var trashed: [Save] = []
    var body: some View {
        List {
            if trashed.isEmpty { Text("The Trash is empty.").foregroundStyle(.secondary) }
            ForEach(trashed) { s in
                HStack {
                    VStack(alignment: .leading) {
                        Text(s.title).font(.headline)
                        Text(KindStyle(s.kind).label).font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Restore") {
                        Task { try? await model.library?.restore([s.id]); model.refresh(); await load() }
                    }
                    .buttonStyle(.bordered).frame(minHeight: 44)
                    .accessibilityLabel("Restore \(s.title)")
                }
            }
        }
        .navigationTitle("Trash")
        .task { await load() }
    }
    private func load() async { trashed = (try? model.library?.saves(trash: true)) ?? [] }
}
