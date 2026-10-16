import UIKit
import SwiftUI
import UniformTypeIdentifiers
import KeepsakeKit
import KeepsakeUI

/// The Share Sheet way in. Saves first (one tap, no waiting), then a card shows where it went: flick
/// the slip to put it somewhere else, add a note, or undo. Stays open until you tap Done (or Undo).
final class ShareViewController: UIViewController {
    private let state = ShareState()

    override init(nibName: String?, bundle: Bundle?) {
        super.init(nibName: nibName, bundle: bundle)
        modalPresentationStyle = .overFullScreen
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        modalPresentationStyle = .overFullScreen
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        state.finish = { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) }
        let host = UIHostingController(rootView: ShareCard(state: state).keepsakeAppearance(Appearance.load()))
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await state.save(items: extensionContext?.inputItems as? [NSExtensionItem] ?? []) }
    }
}

@MainActor @Observable
final class ShareState {
    enum Phase { case saving, saved, duplicate, failed(String) }
    var phase: Phase = .saving
    var save: Save?
    var destinations: [Destination] = []
    var destination: String?          // Destination.value
    var destinationLabel = ""
    var touched = false
    var note = ""
    var finish: () -> Void = {}
    private var library: Library?

    func save(items: [NSExtensionItem]) async {
        let shared = await SharedContent.read(from: items)
        do {
            let library = try Library()
            self.library = library
            var product: [String: Any]
            if let page = shared.page { product = page } else { product = await library.sharedProduct(url: shared.url, title: shared.title, text: shared.text) }
            // A screenshot or photo with no link: its picture and the text read from it, on this device.
            if shared.page == nil, shared.url == nil, let image = shared.image {
                product = await ImageCapture.product(from: image)
            }
            let result = try await library.capture(product: product)
            if let dup = result.duplicateOf {
                save = dup
                destinationLabel = result.destination ?? KindStyle(dup.kind).label
                phase = .duplicate
                return
            }
            guard let s = result.save else { phase = .failed("Keepsake couldn't read what was shared."); return }
            save = s
            Haptic.saved()
            phase = .saved
            destinations = (try? await library.destinations()) ?? []
            let here = s.hasOwnView ? "kind:\(s.kind)" : s.collectionId
            destination = here
            destinationLabel = destinations.first { $0.value == here }?.label ?? (result.needsReview ? "Review" : result.destination ?? "")
            UIAccessibility.post(notification: .announcement, argument: "Saved to \(destinationLabel)")
        } catch {
            phase = .failed(error.localizedDescription)
            Haptic.refused()
        }
    }

    /// Flick to the next or previous place it could go.
    func step(_ delta: Int) {
        guard let save, let library, !destinations.isEmpty else { return }
        touched = true
        let i = destinations.firstIndex { $0.value == destination } ?? -1
        let next = destinations[(i + delta + destinations.count) % destinations.count]
        destination = next.value
        destinationLabel = next.label
        Haptic.detent()
        Task {
            _ = try? await library.put([save.id], in: next.value)
            Haptic.settled()
        }
    }

    func undo() {
        guard let save, let library else { finish(); return }
        Haptic.undo()
        Task {
            try? await library.undoSave(save.id)
            finish()
        }
    }

    func done() {
        guard let save, let library, !note.trimmingCharacters(in: .whitespaces).isEmpty else { finish(); return }
        Task {
            try? await library.update(save.id, ["note": note])
            finish()
        }
    }
}

/// What the host app shared: Safari's page reading (ShareExtract.js, Chrome's extract.js), or a URL,
/// a title and any text from another app.
struct SharedContent {
    var page: [String: Any]?
    var image: UIImage?
    var url: String?
    var title: String?
    var text: String?

    static func read(from items: [NSExtensionItem]) async -> SharedContent {
        var out = SharedContent()
        for item in items {
            if out.title == nil, let t = item.attributedContentText?.string, !t.isEmpty { out.title = t }
            for provider in item.attachments ?? [] {
                if out.page == nil, provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier),
                   let dict = try? await provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier) as? NSDictionary,
                   let results = dict[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any] {
                    if let json = results["product"] as? String, !json.isEmpty,
                       let product = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] {
                        out.page = product
                    }
                    out.url = out.url ?? (results["url"] as? String)
                    out.title = out.title ?? (results["title"] as? String)
                } else if out.url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                          let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    out.url = url.absoluteString
                } else if out.image == nil, provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
                          let item = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) {
                    if let img = item as? UIImage { out.image = img }
                    else if let u = item as? URL, let data = try? Data(contentsOf: u) { out.image = UIImage(data: data) }
                    else if let data = item as? Data { out.image = UIImage(data: data) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    // Many apps share a link inside text ("Look at this https://…").
                    if out.url == nil, let found = text.firstLink { out.url = found }
                    out.text = text
                }
            }
        }
        return out
    }
}

extension String {
    var firstLink: String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        return detector?.firstMatch(in: self, range: NSRange(startIndex..., in: self))?.url?.absoluteString
    }
}

struct ShareCard: View {
    let state: ShareState
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var appeared = false
    @State private var drag: CGFloat = 0
    @State private var writing = false
    @FocusState private var noteFocused: Bool

    // iOS presents a share extension as a full-height sheet, so the whole sheet is the table: the save
    // drawn large as its object, with the slip and actions at the bottom under the thumb.
    var body: some View {
        @Bindable var state = state
        ZStack {
            TableBackground()
            VStack(alignment: .leading, spacing: 18) {
                status
                Spacer(minLength: 8)
                if let save = state.save {
                    SaveObject(save)
                        .frame(maxWidth: 240)
                        .frame(maxWidth: .infinity)
                        .rotationEffect(.degrees(appeared || reduce ? -1.5 : -8))
                        .scaleEffect(appeared || reduce ? 1 : 0.85)
                        .opacity(appeared ? 1 : 0)
                } else if case .saving = state.phase {
                    ProgressView().frame(maxWidth: .infinity)
                }
                Spacer(minLength: 8)
                if case .saved = state.phase { slip }
                if writing {
                    TextField("Add a note", text: $state.note, axis: .vertical)
                        .focused($noteFocused)
                        .font(KSFont.note)
                        .padding(12).background(t.paper, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(t.rule))
                }
                HStack(spacing: 10) {
                    if case .saved = state.phase, !writing {
                        secondary("Add a note", "square.and.pencil") {
                            state.touched = true
                            writing = true
                            noteFocused = true
                        }
                    }
                    PrimarySlab("Done", symbol: "checkmark") { state.done() }
                }
            }
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)
        }
        .simultaneousGesture(TapGesture().onEnded { state.touched = true })
        .onAppear { withAnimation(KSMotion.or(KSMotion.lift, reduce: reduce).delay(0.05)) { appeared = true } }
    }

    @ViewBuilder private var status: some View {
        HStack(spacing: 8) {
            switch state.phase {
            case .saving:
                ProgressView().controlSize(.small)
                Text("Saving").font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
            case .saved:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(KindStyle("recipe").color)
                Text("Saved").font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                if state.save?.isFinishing == true { Text("· finishing details").font(.subheadline).foregroundStyle(t.inkMuted) }
            case .duplicate:
                Image(systemName: "bookmark.fill").foregroundStyle(t.accent)
                Text("Already saved in \(state.destinationLabel)").font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
            case .failed(let message):
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(t.stamp)
                Text(message).font(.subheadline).foregroundStyle(t.ink)
            }
            Spacer()
            if case .saved = state.phase {
                Button("Undo") { state.undo() }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.accent)
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .frame(minHeight: 30)
    }

    /// The destination slip: flick sideways (or tap the arrows) through Lifestyle views and collections.
    private var slip: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                arrow("chevron.left", -1)
                Spacer()
                VStack(spacing: 2) {
                    Text("Going to").font(KSFont.label).foregroundStyle(t.inkMuted)
                    HStack(spacing: 8) {
                        if let d = state.destinations.first(where: { $0.value == state.destination }), let k = d.kind {
                            Image(systemName: KindStyle(k).symbol).foregroundStyle(KindStyle(k).color)
                        }
                        Text(state.destinationLabel.isEmpty ? "Review" : state.destinationLabel)
                            .font(KSFont.name(.title2)).foregroundStyle(t.ink)
                            .contentTransition(.numericText())
                    }
                }
                .offset(x: drag)
                Spacer()
                arrow("chevron.right", 1)
            }
            dots
        }
        .padding(.horizontal, 12).padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background {
            ZStack {
                Rectangle().fill(t.paper)
                Rectangle().strokeBorder(KindStyle(state.save?.kind ?? "link").color.opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [4, 3])).padding(5)
            }
            .resting()
        }
        .gesture(DragGesture(minimumDistance: 8)
            .onChanged { drag = $0.translation.width * 0.4 }
            .onEnded { v in
                let flick = v.predictedEndTranslation.width
                withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) {
                    if flick < -60 { state.step(1) } else if flick > 60 { state.step(-1) }
                    drag = 0
                }
            })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Going to \(state.destinationLabel)")
        .accessibilityHint("Swipe up or down to choose another place for it.")
        .accessibilityAdjustableAction { dir in state.step(dir == .increment ? 1 : -1) }
    }

    private func arrow(_ symbol: String, _ delta: Int) -> some View {
        Button { withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { state.step(delta) } } label: {
            Image(systemName: symbol).font(.subheadline.weight(.bold)).foregroundStyle(t.inkMuted).frame(width: 44, height: 44)
        }
        .accessibilityHidden(true)
    }

    private var dots: some View {
        let all = state.destinations
        let i = all.firstIndex { $0.value == state.destination } ?? 0
        let window = all.indices.filter { abs($0 - i) <= 3 }
        return HStack(spacing: 6) {
            ForEach(window, id: \.self) { j in
                Capsule().fill(j == i ? KindStyle(all[j].kind ?? "link").color : t.ink.opacity(0.18))
                    .frame(width: j == i ? 18 : 6, height: 6)
            }
        }
        .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: state.destination)
        .accessibilityHidden(true)
    }

    private func secondary(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol).font(.subheadline.weight(.medium)).foregroundStyle(t.ink)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(RoundedRectangle(cornerRadius: 6).fill(t.paper).resting())
        }
        .buttonStyle(PressStyle())
    }
}
