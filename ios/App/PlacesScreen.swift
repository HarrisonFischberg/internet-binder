import SwiftUI
import MapKit
import KeepsakeKit
import KeepsakeUI

/// Places: by state, then city (Chrome's Places list), on a map, and Places review for any place that
/// has no name of its own or no state yet. Grouping and review reasons come from Chrome's places.js.
struct PlacesScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var mode: Mode = .list
    @State private var view: PlacesView?
    @State private var editing: Save?
    @State private var reading: String?
    @State private var selecting = false
    @State private var selected: Set<String> = []

    enum Mode: String, CaseIterable { case list = "List", map = "Map", review = "Review" }

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 14) {
                    // At accessibility sizes Select drops below the title, so the subtitle gets the full width.
                    (typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .trailing, spacing: 4)) : AnyLayout(HStackLayout(alignment: .center))) {
                        ScreenHeader(title: "Places", subtitle: subtitle)
                        if mode != .map && !shownPlaces.isEmpty { HeaderSelectButton(selecting: $selecting, selected: $selected) }
                    }
                    Picker("Show", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { m in
                            Text(m == .review && waiting > 0 ? "Review \(waiting)" : m.rawValue).tag(m)
                        }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: mode) {
                        Haptic.detent()
                        selecting = false
                        selected = []
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 12)
                switch mode {
                case .list: list
                case .map: map
                case .review: review
                }
            }
            if selecting {
                SaveSelectionBar(all: shownPlaces.map(\.id), selected: $selected, selecting: $selecting)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(KSMotion.settle, value: selecting)
        .toolbar(.hidden, for: .navigationBar)
        .task(id: model.saves.map(\.id).joined() + model.saves.map { $0.status ?? "" }.joined()) {
            view = try? await model.library?.places()
        }
        .sheet(item: $editing) { save in
            PlaceFixSheet(save: save) { Task { view = try? await model.library?.places() } }
        }
    }

    private var waiting: Int { view?.review.count ?? 0 }
    /// What Select all ticks: the list's places, or the ones waiting in review.
    private var shownPlaces: [Save] {
        mode == .review ? (view?.review.map(\.item) ?? []) : (view?.groups.flatMap { $0.cities.flatMap(\.items) } ?? [])
    }
    private var ready: Int { view?.groups.reduce(0) { $0 + $1.cities.reduce(0) { $0 + $1.items.count } } ?? 0 }
    private var subtitle: String {
        guard view != nil else { return "" }
        return waiting > 0 ? "\(ready) on your list · \(waiting) waiting in review" : "\(ready) on your list"
    }

    // MARK: list

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22, pinnedViews: [.sectionHeaders]) {
                if let view, view.groups.isEmpty {
                    EmptyNote(symbol: "mappin.and.ellipse", text: waiting > 0
                              ? "\(waiting) place\(waiting == 1 ? " is" : "s are") waiting in Places review for a name or a state."
                              : "Save a restaurant, café or anywhere you want to go and it shows up here, by state and city.")
                }
                ForEach(view?.groups ?? [], id: \.state) { group in
                    Section {
                        ForEach(group.cities, id: \.city) { city in
                            VStack(alignment: .leading, spacing: 8) {
                                if group.cities.count > 1 || !city.city.isEmpty {
                                    Text(city.city.isEmpty ? "Elsewhere in \(group.state)" : city.city)
                                        .font(.subheadline.weight(.semibold)).foregroundStyle(t.inkMuted)
                                }
                                ForEach(city.items) { place in row(place) }
                            }
                        }
                    } header: {
                        HStack(alignment: .firstTextBaseline) {
                            Text(group.state).font(KSFont.name(.title2)).foregroundStyle(t.ink)
                            Text("\(group.cities.reduce(0) { $0 + $1.items.count })").font(.subheadline).foregroundStyle(t.inkMuted)
                            Spacer()
                        }
                        .padding(.vertical, 6)
                        .background(TablePatch())
                        .accessibilityAddTraits(.isHeader)
                    }
                }
            }
            .padding(.horizontal, 18).padding(.bottom, selecting ? 140 : 40)
        }
    }

    @ViewBuilder private func row(_ place: Save) -> some View {
        let save = model.saves.first { $0.id == place.id } ?? place
        if selecting {
            let on = selected.contains(place.id)
            Button {
                Haptic.checked()
                if on { selected.remove(place.id) } else { selected.insert(place.id) }
            } label: {
                rowBody(place).selectionCheck(on, alignment: .trailing)
            }
            .buttonStyle(PressStyle())
            .accessibilityLabel(place.title)
        } else {
            NavigationLink(value: save) { rowBody(place).matchedTransitionSource(id: place.id, in: zoom) }
                .buttonStyle(PressStyle())
                .contextMenu { SaveMenu(save: save) { startSelecting(place.id) } }
                .swipeToDelete { Task { await model.trash(save) } }
        }
    }

    private func startSelecting(_ id: String) {
        Haptic.detent()
        selected = [id]
        selecting = true
    }

    private func rowBody(_ place: Save) -> some View {
        HStack(spacing: 14) {
            SaveImage(place, symbolSize: 18).frame(width: 56, height: 56).clipped()
                .ksSurface(radius: min(t.radius, 10), scale: 0.5)
            VStack(alignment: .leading, spacing: 3) {
                Text(place.title).font(KSFont.name(.headline)).foregroundStyle(t.ink)
                if let fact = place.fact, !fact.isEmpty { Text(fact).font(.footnote).foregroundStyle(t.inkMuted) }
            }
            Spacer()
            if place.status == "done" {
                Label("Been", systemImage: "checkmark.seal.fill").labelStyle(.iconOnly).foregroundStyle(t.stamp)
                    .accessibilityLabel("Been")
            }
        }
        .padding(10)
        .ksSurface()
    }

    // MARK: map

    private var map: some View { PlacesMap(places: (view?.groups ?? []).flatMap { $0.cities.flatMap(\.items) }) }

    // MARK: review

    private var review: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if waiting == 0 {
                    EmptyNote(symbol: "checkmark.circle", text: "Every place has a name and a state.")
                }
                ForEach(view?.review ?? [], id: \.item.id) { w in
                    if selecting {
                        let on = selected.contains(w.item.id)
                        Button {
                            Haptic.checked()
                            if on { selected.remove(w.item.id) } else { selected.insert(w.item.id) }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(w.item.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(2)
                                Text(w.reasons.map(Self.why).joined(separator: " · ")).font(.footnote).foregroundStyle(t.stamp)
                            }
                            .padding(14).padding(.trailing, 44).frame(maxWidth: .infinity, alignment: .leading).ksSurface()
                            .selectionCheck(on, alignment: .trailing)
                        }
                        .buttonStyle(PressStyle())
                        .accessibilityLabel(w.item.title)
                    } else {
                        reviewRow(w)
                    }
                }
            }
            .padding(.horizontal, 18).padding(.bottom, selecting ? 140 : 40)
        }
    }

    /// A place waiting in review. The top opens the save (its picture, caption and details); the post
    /// itself is one tap away, to see where it really is; Read again and Fix sit beside it.
    private func reviewRow(_ w: PlacesView.Waiting) -> some View {
        let save = model.saves.first { $0.id == w.item.id } ?? w.item
        return VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: save) {
                // At accessibility sizes the picture sits above the words, so the name is never cut short.
                Group {
                    if typeSize.isAccessibilitySize {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack { reviewThumb(save); Spacer(minLength: 0); reviewChevron }
                            reviewText(w)
                        }
                    } else {
                        HStack(spacing: 12) {
                            reviewThumb(save)
                            reviewText(w)
                            Spacer(minLength: 0)
                            reviewChevron
                        }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .accessibilityHint("Opens the save")
            // On one line while it fits; stacked at large text sizes.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { reviewActions(w, save: save) }
                VStack(alignment: .leading, spacing: 8) { reviewActions(w, save: save) }
            }
            // The buttons keep their usual size, like the save's own action row; a long press shows them large.
            .dynamicTypeSize(...DynamicTypeSize.large)
            .accessibilityShowsLargeContentViewer()
        }
        .padding(14).ksSurface()
        .contextMenu { SaveMenu(save: save) { startSelecting(w.item.id) } }
        .swipeToDelete { Task { await model.trash(save) } }
    }

    private func reviewThumb(_ save: Save) -> some View {
        SaveImage(save, symbolSize: 18).frame(width: 56, height: 56).clipped()
            .ksSurface(radius: min(t.radius, 10), scale: 0.5)
            .matchedTransitionSource(id: save.id, in: zoom)
    }

    private var reviewChevron: some View {
        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(t.inkMuted)
            .accessibilityHidden(true)
    }

    private func reviewText(_ w: PlacesView.Waiting) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(w.item.title).font(KSFont.name(.headline)).foregroundStyle(t.ink)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                .multilineTextAlignment(.leading)
            Text(w.reasons.map(Self.why).joined(separator: " · ")).font(.footnote).foregroundStyle(t.stamp)
        }
    }

    @ViewBuilder private func reviewActions(_ w: PlacesView.Waiting, save: Save) -> some View {
        let instagram = (save.host ?? "").hasSuffix("instagram.com")
        if let link = save.url.flatMap(URL.init(string:)), link.scheme?.hasPrefix("http") == true {
            Button(instagram ? "Open post" : "Open website", systemImage: instagram ? "camera" : "safari") { openURL(link) }
                .buttonStyle(ReviewActionStyle())
                .accessibilityLabel(instagram ? "Open the post for \(w.item.title) on Instagram" : "Open \(save.host ?? "the page") for \(w.item.title)")
        }
        // Chrome's Read again / Fix with AI: the caption read again on this iPhone, then your AI and
        // Lookups if they're on. Never changes what you typed.
        Button {
            readAgain(w.item)
        } label: {
            // The label keeps its width under the spinner, so the row doesn't jump.
            Text("Read again").opacity(reading == w.item.id ? 0 : 1)
                .overlay { if reading == w.item.id { ProgressView() } }
        }
        .buttonStyle(ReviewActionStyle())
        .disabled(reading != nil)
        .accessibilityLabel("Read \(w.item.title) again")
        Button("Fix") { editing = w.item }
            .buttonStyle(ReviewActionStyle())
            .accessibilityLabel("Fix \(w.item.title)")
    }

    /// Reads the place again and says what came of it, so a tap that finds nothing new still answers.
    private func readAgain(_ place: Save) {
        reading = place.id
        Task {
            _ = try? await model.library?.fixPlace(place.id)
            model.refresh()
            view = try? await model.library?.places()
            reading = nil
            if let still = view?.review.first(where: { $0.item.id == place.id }) {
                Haptic.detent()
                model.show(still.reasons.contains("no place name")
                           ? "Nothing new in the post. Tap Fix to name it yourself."
                           : "Nothing new in the post. Tap Fix to add its state or country.")
            } else {
                Haptic.settled()
                let state = view?.groups.first { $0.cities.contains { $0.items.contains { $0.id == place.id } } }?.state
                model.show(state.map { "\(place.title) is now under \($0)" } ?? "\(place.title) is on your list now")
            }
        }
    }

    static func why(_ reason: String) -> String {
        switch reason {
        case "no place name": "Needs the place's name"
        case "no state": "Needs a state or country"
        default: reason
        }
    }
}

/// Places review's Open post, Read again and Fix: outlined pills, the same as Select beside the title.
private struct ReviewActionStyle: ButtonStyle {
    @Environment(\.ks) private var t
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduce

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
            .padding(.horizontal, 14).frame(minHeight: 44)
            .background(t.paper, in: Capsule())
            .overlay(Capsule().strokeBorder(t.style == .pantry ? t.line : t.rule, lineWidth: t.style == .pantry ? 2 : 1))
            .opacity(enabled ? (configuration.isPressed && reduce ? 0.8 : 1) : 0.5)
            .scaleEffect(configuration.isPressed && !reduce ? 0.96 : 1)
            .animation(KSMotion.or(KSMotion.press, reduce: reduce), value: configuration.isPressed)
            .contentShape(Capsule())
    }
}

/// Name a place and say where it is, by hand. Edits are yours: AI and lookups won't change them.
struct PlaceFixSheet: View {
    let save: Save
    let done: () -> Void
    @Environment(LibraryModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var city = ""
    @State private var region = ""
    @State private var country = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Place") { TextField("Name", text: $name) }
                Section("Where") {
                    TextField("City", text: $city)
                    TextField("State or region", text: $region)
                    TextField("Country", text: $country)
                }
            }
            .navigationTitle("Fix place")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            var details: [String: Any] = [:]
                            if case .object(let o)? = save.details {
                                for (k, v) in o { details[k] = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(v), options: .fragmentsAllowed)) ?? NSNull() }
                            }
                            details["locality"] = city
                            details["region"] = region
                            details["country"] = country
                            // Yours: Read again, AI and lookups leave the name and place alone, and a name
                            // you keep as it was still counts as the place's name.
                            details["source"] = "you"
                            try? await model.library?.update(save.id, ["title": name, "details": details, "userFields": ["title"]])
                            model.refresh()
                            Haptic.settled()
                            done()
                            dismiss()
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                name = save.title
                city = save.details?["locality"]?.string ?? ""
                region = save.details?["region"]?.string ?? ""
                country = save.details?["country"]?.string ?? ""
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The places that have a pin, on Apple Maps; each pin opens its save. The Places tab's Map, and the
/// map behind the Map button on Lifestyle's Places.
struct PlacesMap: View {
    let places: [Save]
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t

    private var pinned: [(Save, CLLocationCoordinate2D)] {
        places.compactMap { s in
            guard let lat = s.details?["lat"]?.number, let lng = s.details?["lng"]?.number else { return nil }
            return (s, CLLocationCoordinate2D(latitude: lat, longitude: lng))
        }
    }

    /// Fits every pin; a lone pin opens on its neighbourhood rather than the street.
    private var start: MapCameraPosition {
        guard pinned.count == 1, let pin = pinned.first?.1 else { return .automatic }
        return .region(MKCoordinateRegion(center: pin, span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)))
    }

    var body: some View {
        Map(initialPosition: start) {
            ForEach(pinned, id: \.0.id) { place, pin in
                Annotation(place.title, coordinate: pin) {
                    NavigationLink(value: model.saves.first { $0.id == place.id } ?? place) {
                        // A 32 pt pin with a 44 pt target; the glyph is drawn in the colour that reads on the pin.
                        Image(systemName: place.status == "done" ? "checkmark" : "mappin")
                            .font(.subheadline.weight(.bold)).foregroundStyle(t.onKind)
                            .frame(width: 32, height: 32)
                            .background(t.kindFill("place"), in: Circle())
                            .overlay(Circle().strokeBorder(t.style == .pantry ? t.onKind : .white, lineWidth: 2))
                            .shadow(color: .black.opacity(0.3), radius: 3, y: 2)
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                    }
                    .accessibilityLabel(place.title)
                }
            }
        }
        .mapStyle(.standard(emphasis: .muted, pointsOfInterest: .excludingAll))
        .overlay {
            if pinned.isEmpty {
                Text("Places with a pin show up here.").font(KSFont.note).foregroundStyle(t.ink)
                    .padding(14).ksSurface(radius: 24)
            }
        }
        // Say when some places aren't on the map (no pin yet), so a short map doesn't look like a lost save.
        // At the top, so it never covers the Apple Maps logo and Legal link at the bottom.
        .overlay(alignment: .top) {
            if !pinned.isEmpty && pinned.count < places.count {
                Text("\(pinned.count) of \(places.count) on the map").font(KSFont.note).foregroundStyle(t.ink)
                    .padding(.horizontal, 14).padding(.vertical, 8).ksSurface(radius: 24)
                    .padding(.top, 12)
            }
        }
    }
}
