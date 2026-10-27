import SwiftUI
import UniformTypeIdentifiers
import KeepsakeKit
import KeepsakeUI

/// Settings: Apple Intelligence, your own AI key, Lookups, the change log, import and export, privacy, and erase.
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

    /// The Claude models on offer and their effort levels (KeepsakeKit's ClaudeChoices, checked against provider.js).
    static let claudeModels = ClaudeChoices.models
    static let efforts = ClaudeChoices.efforts

    private var syncSection: some View {
        Section {
            Toggle("Sync with iCloud", isOn: Binding(get: { model.syncOn }, set: { model.setSync($0) }))
                .accessibilityIdentifier("syncToggle")
            if model.syncOn {
                if let run = model.syncRun {
                    Button {
                        model.workShowing = true
                    } label: {
                        LabeledContent("Status") {
                            Text("Sending \(run.done) of \(run.total)…").monospacedDigit().accessibilityIdentifier("syncStatus")
                        }
                    }
                    .accessibilityHint("Shows the progress screen.")
                } else {
                    LabeledContent("Status") {
                        Text(syncStatusText).accessibilityIdentifier("syncStatus")
                    }
                }
                if case .failed? = model.syncStatus {
                    Button("Try Again") { model.syncNow() }.accessibilityIdentifier("syncRetry")
                }
            }
        } header: {
            Text("iCloud")
        } footer: {
            Text("Keeps your saves, collections, what it learned and your AI settings the same on your iPhone and Mac. They go to your own iCloud, encrypted: Apple stores them but can't read them. Your AI key stays on each device.")
        }
    }

    private var syncStatusText: String {
        switch model.syncStatus {
        case nil: "Starting…"
        case .syncing?: "Syncing…"
        case .upToDate(let at)?: "Up to date, \(at.formatted(.relative(presentation: .named)))"
        case .signedOut?: "Sign in to iCloud in the Settings app"
        case .failed(let message)?: message
        }
    }

    enum Consent: Identifiable { case ai, lookup(String); var id: String { switch self { case .ai: "ai"; case .lookup(let k): k } } }

    var body: some View {
        NavigationStack {
            Form {
                syncSection
                appleSection
                aiSection
                lookupsSection
                instagramSection
                Section {
                    Toggle("Music while cooking", isOn: $cookingMusic)
                } footer: { Text("Ten quiet, original tunes play while you follow a recipe step by step. They stay silent when your iPhone is on silent and never stop a podcast or song you're already playing.") }
                noticesSection
                Section {
                    NavigationLink("What it learned") { LearnedScreen() }
                } header: { Text("Sorting") } footer: { Text("When you move a save or file one from Review, Internet Binder remembers which words and shops go where.") }
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
                } footer: { Text(model.syncOn ? "Internet Binder has no account and no server. Your library stays on this iPhone and in your own iCloud." : "Internet Binder has no account and no server. Your library stays on this iPhone.") }
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
            // The progress screen opens over Settings while it's up (Fix everything, turning sync on).
            .modifier(WorkCover(host: .settings))
            .onAppear { model.workHost = .settings }
            .onDisappear { model.workHost = .root }
            .confirmationDialog("Fix all \(model.saves.count) saves with AI?", isPresented: $fixingAll, titleVisibility: .visible) {
                Button("Fix everything") { Task { await model.fixWithAI(model.saves, screen: true) } }
            } message: {
                Text("\(model.aiReadsAgain) Every change can be undone.")
            }
        }
    }

    // MARK: AI

    /// Apple Intelligence (OnDeviceAI): reads every save by itself, on this iPhone. No switch: it's on
    /// whenever the system says it's ready, and this says why when it isn't.
    private var appleSection: some View {
        Section {
            LabeledContent("Apple Intelligence") {
                Text(appleStatusText).accessibilityIdentifier("appleAIStatus")
            }
            if model.aiReady && !model.saves.isEmpty {
                Button("Fix every save with AI", systemImage: "sparkles") { fixingAll = true }
                    .disabled(model.aiRun != nil)
            }
            RunAIOnImportedButton()
        } header: { Text("AI") } footer: {
            Text(appleFooter)
        }
    }

    private var appleStatusText: String {
        switch model.appleAI {
        case .ready: "On"
        case .off: "Off"
        case .preparing: "Getting ready"
        case .unsupported: "Not on this device"
        }
    }

    private var appleFooter: String {
        switch model.appleAI {
        case .ready: "Reads your saves on this iPhone as they come in and whenever you open the app: what each one is, its details, a cleaner title and a collection. Nothing leaves your iPhone. What it can't work out stays as it is."
        case .off: "Turn on Apple Intelligence in the Settings app (Apple Intelligence & Siri), and Internet Binder reads your saves on this iPhone by itself. Nothing leaves your iPhone."
        case .preparing: "Apple Intelligence is still downloading. Once it's ready, Internet Binder reads your saves on this iPhone by itself."
        case .unsupported: "This device can't run Apple Intelligence. Add your own AI key below to have saves read."
        }
    }

    private var aiSection: some View {
        Section {
            Toggle("Use your own key", isOn: Binding(get: { aiOn }, set: { on in
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
            }
        } header: { Text("Your own AI key") } footer: {
            Text(model.appleAI == .ready
                 ? "Off by default. For what Apple Intelligence can't do: when you tap Fix with AI, Claude or another provider looks at the picture, searches the web for a product's shop page or where to watch, and sorts out what Apple Intelligence left. Your key stays in this iPhone's Keychain and is never exported."
                 : "Off by default. Uses your own key, kept in this iPhone's Keychain and never exported. Sends only what each feature says, to the provider you choose.")
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
        case .ai: "Use your own AI key?"
        case .lookup("places"): "Look up places on OpenStreetMap?"
        case .lookup("media"): "Look up films and shows on Wikidata?"
        default: "Look up books on Open Library?"
        }
    }
    private var points: [String] {
        switch consent {
        case .ai: [
            "Uses your own key with the provider you choose. Internet Binder has no AI server.",
            "Where your iPhone has Apple Intelligence, it reads new saves by itself, on this iPhone, and your key is only used when you tap Fix with AI or Run AI.",
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
                .overlay(alignment: .top) { Rectangle().fill(t.rule).frame(height: 1) }
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

/// What sorting picked up from your moves (Chrome's Settings → Categorization): its words grouped
/// under the collection they file into, then shops. Swipe one away to forget it; Clear forgets all,
/// both with Undo. Learning stays on this iPhone; Chrome and Safari learn on their own.
struct LearnedScreen: View {
    @Environment(LibraryModel.self) private var model
    @State private var learned: LearnedView?

    /// The words under each collection, collections in the order of their strongest word.
    private var groups: [(name: String, terms: [LearnedView.Term])] {
        var order: [String] = [], by: [String: [LearnedView.Term]] = [:]
        for t in learned?.terms ?? [] {
            if by[t.collectionId] == nil { order.append(t.collectionId) }
            by[t.collectionId, default: []].append(t)
        }
        return order.compactMap { id in by[id].map { ($0[0].collectionName, $0) } }
    }

    var body: some View {
        List {
            if let l = learned {
                if l.terms.isEmpty && l.retailers.isEmpty {
                    Section {
                        Text("Nothing learned yet.").font(.headline)
                        Text("Move a save to another collection, or file one from Review, and Internet Binder picks up the pattern for next time.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        Text(summary(l)).font(.subheadline).foregroundStyle(.secondary)
                    }
                    ForEach(groups, id: \.name) { g in
                        Section(g.name) {
                            ForEach(g.terms, id: \.self) { t in
                                Text(t.term)
                                    .accessibilityLabel("\(t.term) goes to \(g.name)")
                                    .forgettable { forget(t.term, shop: false) }
                            }
                        }
                    }
                    if !l.retailers.isEmpty {
                        Section("Shops") {
                            ForEach(l.retailers, id: \.self) { r in
                                LabeledContent(r.host, value: r.collectionName)
                                    .accessibilityElement(children: .ignore)
                                    .accessibilityLabel("\(r.host) goes to \(r.collectionName)")
                                    .forgettable { forget(r.host, shop: true) }
                            }
                        }
                    }
                    Section {
                        Button("Clear what it learned", role: .destructive) { clear() }
                    } footer: { Text("Your collections and their keywords are kept.") }
                }
            } else {
                Section { ForEach(0..<6, id: \.self) { _ in Text("placeholder word") } }.redacted(reason: .placeholder)
            }
        }
        .navigationTitle("What it learned")
        // Settings is a sheet, which covers the app's own toast: show Forget's Undo here.
        .overlay(alignment: .bottom) { ToastView().padding(.horizontal, 16).padding(.bottom, 24) }
        .task { await load() }
    }

    private func summary(_ l: LearnedView) -> String {
        let moves = "\(l.moveCount) \(l.moveCount == 1 ? "move" : "moves")"
        let words = l.termCount > l.terms.count ? "The \(l.terms.count) strongest of \(l.termCount) words" : "\(l.termCount) \(l.termCount == 1 ? "word" : "words")"
        return "\(words) and \(l.retailers.count) \(l.retailers.count == 1 ? "shop" : "shops"), from \(moves). Swipe one away if it files saves in the wrong place."
    }

    private func forget(_ key: String, shop: Bool) {
        Task {
            guard let library = model.library, let undo = try? await library.forgetLearned(key, shop: shop) else { return }
            Haptic.settled()
            await load()
            model.show("Forgot \(key)") { try? await library.restoreLearned(undo); await load() }
        }
    }

    private func clear() {
        Task {
            guard let library = model.library, let undo = try? await library.clearLearned() else { return }
            Haptic.settled()
            await load()
            model.show("Cleared what it learned") { try? await library.restoreLearned(undo); await load() }
        }
    }

    private func load() async { learned = try? await model.library?.learned() }
}

private extension View {
    /// Swipe to forget, with the same action on long-press (the non-gesture way in).
    func forgettable(_ forget: @escaping () -> Void) -> some View {
        swipeActions { Button("Forget", systemImage: "minus.circle", role: .destructive, action: forget) }
            .contextMenu { Button("Forget", systemImage: "minus.circle", role: .destructive, action: forget) }
    }
}

/// Every network path in plain words (mirrors PRIVACY.md for iOS).
struct PrivacyScreen: View {
    var body: some View {
        List {
            Section("On this iPhone") {
                Text("Your saves, collections, goals and settings live in Internet Binder's storage on this device. No account, no Internet Binder server, no analytics.")
                Text("Apple Intelligence reads your saves on this device. What it reads never leaves it.")
                Text("Your AI key is kept in the Keychain on this device and never exported.")
            }
            Section("When Internet Binder uses the network") {
                Text("Pictures of your saves load from the sites they came from, as a web page loads them. A small copy is kept on this iPhone so the picture stays if the site removes it.")
                Text("Maps are drawn by Apple Maps. Directions open Apple Maps with the place's name and address.")
                Text("Your own AI key and each Lookup: only when you turn them on, and only what their switch says.")
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
                    Text(model.syncOn
                         ? "This deletes every save, collection, goal and setting on this iPhone. Sync with iCloud turns off first, so iCloud and your other devices keep theirs: turn sync back on to bring them back here."
                         : "This deletes every save, collection, goal and setting on this iPhone. It can't be undone. Export first if you might want them back.")
                    TextField("Type ERASE to confirm", text: $typed).textInputAutocapitalization(.characters)
                }
                Button("Erase everything", role: .destructive) {
                    Task {
                        // Erasing here never erases iCloud: sync stops first.
                        if model.syncOn { model.setSync(false) }
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
