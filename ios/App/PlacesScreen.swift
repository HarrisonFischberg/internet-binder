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
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var mode: Mode = .list
    @State private var view: PlacesView?
    @State private var editing: Save?
    @State private var reading: String?
    @State private var selecting = false
    @State private var selected: Set<String> = []
    /// Regions folded shut in the list (kept while the app runs).
    @State private var folded: Set<String> = []

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
                    SegmentedTabs(Mode.allCases.map { m in (m, m == .review && waiting > 0 ? "Review \(waiting)" : m.rawValue) }, selection: $mode)
                    .onChange(of: mode) {
                        Haptic.detent()
                        selecting = false
                        selected = []
                    }
                }
                .padding(.horizontal, 20).padding(.bottom, 12)
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
        .task(id: model.index.placesKey) {
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
        let saved = (ready + waiting).formatted()
        return waiting > 0 ? "\(saved) saved · \(waiting.formatted()) to review" : "\(saved) saved"
    }

    // MARK: list

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18, pinnedViews: [.sectionHeaders]) {
                if let view, view.groups.isEmpty {
                    EmptyNote(symbol: "mappin.and.ellipse", text: waiting > 0
                              ? "No places here yet. \(waiting) place\(waiting == 1 ? " is" : "s are") waiting in Review for a name or a state."
                              : "No places here yet. Save a restaurant, café or anywhere you want to go and it shows up here, by state and city.")
                } else if view == nil {
                    // Loading: rows the size of real ones, so nothing jumps when they arrive.
                    ForEach(0..<4, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: t.radius, style: .continuous).fill(t.well).frame(height: 88)
                    }
                    .accessibilityHidden(true)
                }
                ForEach(view?.groups ?? [], id: \.state) { group in
                    Section {
                        if !folded.contains(group.state) {
                            ForEach(group.cities, id: \.city) { city in
                                VStack(alignment: .leading, spacing: 10) {
                                    if group.cities.count > 1 || !city.city.isEmpty {
                                        Text(city.city.isEmpty ? "Elsewhere in \(group.state)" : city.city)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(t.style == .chromatic ? t.accent : t.inkMuted)
                                            .accessibilityAddTraits(.isHeader)
                                    }
                                    ForEach(city.items) { place in row(place, city: city.city) }
                                }
                            }
                        }
                    } header: {
                        regionHeader(group.state, count: group.cities.reduce(0) { $0 + $1.items.count })
                    }
                }
            }
            .padding(.horizontal, 20).padding(.bottom, selecting ? 140 : 40)
        }
    }

    /// A region's name and count; tap to fold it shut or open it again.
    private func regionHeader(_ state: String, count: Int) -> some View {
        let open = !folded.contains(state)
        return Button {
            Haptic.detent()
            withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) {
                if open { folded.insert(state) } else { folded.remove(state) }
            }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(state).font(KSFont.section()).foregroundStyle(t.ink)
                Text("\(count)").font(.subheadline).foregroundStyle(t.inkMuted).monospacedDigit()
                Spacer()
                Image(systemName: "chevron.up").font(.footnote.weight(.bold)).foregroundStyle(t.inkMuted)
                    .rotationEffect(.degrees(open ? 0 : 180))
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 2)
        .background(TablePatch())
        .accessibilityLabel("\(state), \(count) place\(count == 1 ? "" : "s")")
        .accessibilityValue(open ? "Expanded" : "Collapsed")
        .accessibilityHint(open ? "Folds this region shut." : "Opens this region.")
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private func row(_ place: Save, city: String) -> some View {
        let save = model.index.byId[place.id] ?? place
        if selecting {
            let on = selected.contains(place.id)
            Button {
                Haptic.checked()
                if on { selected.remove(place.id) } else { selected.insert(place.id) }
            } label: {
                rowBody(place, city: city, menu: false).selectionCheck(on, alignment: .trailing)
                    .overlay { if on { RoundedRectangle(cornerRadius: t.radius, style: .continuous).strokeBorder(t.accent, lineWidth: 2) } }
            }
            .buttonStyle(PressStyle())
            .accessibilityLabel(place.title)
            .accessibilityAddTraits(on ? .isSelected : [])
        } else {
            NavigationLink(value: save) { rowBody(place, city: city, menu: true).matchedTransitionSource(id: place.id, in: zoom) }
                .buttonStyle(PressStyle())
                // The row's menu, one tap away: laid over the row, outside its link.
                .overlay(alignment: .trailing) {
                    Menu { SaveMenu(save: save) { startSelecting(place.id) } } label: {
                        GlassIcon("ellipsis", size: 36, font: .footnote.weight(.bold)).frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("More for \(place.title)")
                    .padding(.trailing, 8)
                }
                .contextMenu { SaveMenu(save: save) { startSelecting(place.id) } }
                .swipeToDelete { Task { await model.trash(save) } }
        }
    }

    private func startSelecting(_ id: String) {
        Haptic.detent()
        selected = [id]
        selecting = true
    }

    /// Photo, name, then city and kind of place; the whole row opens the save.
    private func rowBody(_ place: Save, city: String, menu: Bool) -> some View {
        let detail = PlacesMap.detail(city, city: city, fact: place.fact)
        return HStack(spacing: 14) {
            SaveImage(place, symbolSize: 20).frame(width: 64, height: 64).clipped()
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(place.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(2)
                if !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(t.inkMuted).lineLimit(2) }
            }
            Spacer(minLength: 0)
            if place.status == "done" {
                Label("Been", systemImage: "checkmark.seal.fill").labelStyle(.iconOnly).foregroundStyle(t.stamp)
                    .accessibilityLabel("Been")
            }
        }
        .padding(.leading, 12).padding(.vertical, 12).padding(.trailing, menu ? 56 : 48)
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
        .ksSurface()
    }

    // MARK: map

    private var map: some View {
        PlacesMap(places: (view?.groups ?? []).flatMap { $0.cities.flatMap(\.items) }, waiting: waiting) { mode = .review }
    }

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
            .padding(.horizontal, 20).padding(.bottom, selecting ? 140 : 40)
        }
    }

    /// A place waiting in review. The top opens the save (its picture, caption and details); the post
    /// itself is one tap away, to see where it really is; Read again and Fix sit beside it.
    private func reviewRow(_ w: PlacesView.Waiting) -> some View {
        let save = model.index.byId[w.item.id] ?? w.item
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
            .background(t.well, in: Capsule())
            .overlay(Capsule().strokeBorder(t.rule, lineWidth: 1))
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

/// The places that have a pin, on Apple Maps, gathered into numbered clusters that come apart as you
/// zoom in. Tapping a pin selects it (larger, outlined, in the accent) and shows a card with its name,
/// where it is and Open; tapping a cluster zooms into it. The Places tab's Map, and the map behind the
/// Map button on Lifestyle's Places. "51 of 120 mapped" counts only places that have a pin.
struct PlacesMap: View {
    let places: [Save]
    /// Places waiting in Review, and how to get there (the Places tab only).
    var waiting = 0
    var onReview: (() -> Void)?
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var position: MapCameraPosition = .automatic
    @State private var region: MKCoordinateRegion?
    @State private var chosen: String?

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

    /// Pins that sit close together on screen at this zoom, as one cluster each.
    private var clusters: [PinCluster] {
        let pins = pinned
        guard let region, pins.count > 1 else { return pins.map { PinCluster(members: [$0.0], centre: $0.1) } }
        let cellLat = max(region.span.latitudeDelta / 8, 0.00001), cellLng = max(region.span.longitudeDelta / 6, 0.00001)
        var cells: [String: [(Save, CLLocationCoordinate2D)]] = [:]
        var keys: [String] = []
        for p in pins {
            let key = "\(Int((p.1.latitude / cellLat).rounded(.down)))|\(Int((p.1.longitude / cellLng).rounded(.down)))"
            if cells[key] == nil { keys.append(key) }
            cells[key, default: []].append(p)
        }
        return keys.map { k in
            let m = cells[k]!
            let lat = m.map(\.1.latitude).reduce(0, +) / Double(m.count), lng = m.map(\.1.longitude).reduce(0, +) / Double(m.count)
            return PinCluster(members: m.map(\.0), centre: CLLocationCoordinate2D(latitude: lat, longitude: lng))
        }
    }

    private var selectedSave: Save? { chosen.flatMap { id in pinned.first { $0.0.id == id }?.0 } }

    var body: some View {
        Map(position: $position) {
            ForEach(clusters) { c in
                Annotation(c.members.count == 1 ? c.members[0].title : "\(c.members.count) places", coordinate: c.centre) {
                    if c.members.count == 1 { pin(c.members[0]) } else { cluster(c) }
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(emphasis: .muted, pointsOfInterest: .excludingAll))
        .mapControls { MapScaleView() }
        .onMapCameraChange(frequency: .onEnd) { region = $0.region }
        .onAppear { position = start }
        // The selected place's card sits above the tab bar; the map's own logo and Legal link move up
        // above it rather than under it.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let save = selectedSave { card(save).padding(.horizontal, 16).padding(.bottom, 12).transition(.move(edge: .bottom).combined(with: .opacity)) }
        }
        .animation(KSMotion.or(KSMotion.sheet, reduce: reduce), value: chosen)
        .overlay {
            if pinned.isEmpty { emptyState }
        }
        // At the top, so it never covers the Apple Maps logo and Legal link at the bottom.
        .overlay(alignment: .top) {
            if !pinned.isEmpty {
                HStack {
                    Spacer()
                    Text(pinned.count < places.count ? "\(pinned.count.formatted()) of \(places.count.formatted()) mapped" : "\(pinned.count.formatted()) mapped")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink).monospacedDigit()
                        .padding(.horizontal, 14).frame(minHeight: 36)
                        .ksGlass(Capsule())
                    Spacer()
                }
                .overlay(alignment: .trailing) {
                    Button { showAll() } label: { GlassIcon("arrow.up.left.and.arrow.down.right", size: 44, font: .subheadline.weight(.bold)) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Show every place")
                }
                .padding(.horizontal, 16).padding(.top, 10)
            }
        }
    }

    /// One place: a disc in the place colour; chosen, it grows, takes the accent and an outline, and
    /// drops a point, so the choice never rests on colour alone.
    private func pin(_ place: Save) -> some View {
        let on = chosen == place.id
        return Button {
            Haptic.detent()
            chosen = on ? nil : place.id
        } label: {
            VStack(spacing: -3) {
                Image(systemName: place.status == "done" ? "checkmark" : "mappin")
                    .font((on ? Font.body : .subheadline).weight(.bold)).foregroundStyle(on ? t.onAccent : t.onKind)
                    .frame(width: on ? 42 : 30, height: on ? 42 : 30)
                    .background(on ? t.accent : t.kindFill("place"), in: Circle())
                    .overlay(Circle().strokeBorder(on ? t.ink : .white.opacity(0.9), lineWidth: on ? 3 : 2))
                if on { Image(systemName: "triangle.fill").font(.system(size: 10)).foregroundStyle(t.ink).rotationEffect(.degrees(180)) }
            }
            .shadow(color: .black.opacity(0.35), radius: 3, y: 2)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(place.title)
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(on ? "Selected. Its card is below the map." : "Shows its card.")
    }

    /// Several places close together: their count in a ring. Tap to zoom in until they come apart.
    private func cluster(_ c: PinCluster) -> some View {
        Button {
            Haptic.detent()
            zoom(into: c)
        } label: {
            Text("\(c.members.count)").font(.subheadline.weight(.bold)).monospacedDigit().foregroundStyle(t.ink)
                .frame(minWidth: 36, minHeight: 36).padding(.horizontal, c.members.count > 99 ? 6 : 0)
                .background(t.paper.opacity(0.92), in: Capsule())
                .overlay(Capsule().strokeBorder(t.style == .paper ? t.line : t.ink.opacity(0.85), lineWidth: 2))
                .shadow(color: .black.opacity(0.3), radius: 3, y: 2)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(c.members.count) places")
        .accessibilityHint("Zooms in to show them")
    }

    private func zoom(into c: PinCluster) {
        let coords = pinned.filter { p in c.members.contains { $0.id == p.0.id } }.map(\.1)
        guard let minLat = coords.map(\.latitude).min(), let maxLat = coords.map(\.latitude).max(),
              let minLng = coords.map(\.longitude).min(), let maxLng = coords.map(\.longitude).max() else { return }
        let span = MKCoordinateSpan(latitudeDelta: max((maxLat - minLat) * 1.8, 0.004), longitudeDelta: max((maxLng - minLng) * 1.8, 0.004))
        // Already as close as it goes (the same spot): pick the first, so its card answers the tap.
        if let region, region.span.latitudeDelta <= 0.006 { chosen = c.members.first?.id; return }
        withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) {
            position = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2), span: span))
        }
    }

    private func showAll() {
        Haptic.detent()
        chosen = nil
        withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { position = pinned.count == 1 ? start : .automatic }
    }

    /// The chosen place: picture, name, where it is, Open, and a close button.
    private func card(_ save: Save) -> some View {
        let open = model.index.byId[save.id] ?? save
        let where_ = [save.details?["locality"]?.string, save.details?["region"]?.string].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        let detail = Self.detail(where_, city: save.details?["locality"]?.string ?? "", fact: save.fact)
        return HStack(spacing: 14) {
            NavigationLink(value: open) {
                HStack(spacing: 14) {
                    SaveImage(save, symbolSize: 22).frame(width: 72, height: 72).clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(save.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(2)
                        if !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(t.inkMuted).lineLimit(2) }
                        Label("Open", systemImage: "arrow.up.right").font(.subheadline.weight(.semibold)).foregroundStyle(t.accent)
                            .labelStyle(.titleAndIcon).padding(.top, 2)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel([save.title, detail].filter { !$0.isEmpty }.joined(separator: ", "))
            .accessibilityHint("Opens the place")
            Button { chosen = nil } label: { GlassIcon("xmark", size: 36, font: .footnote.weight(.bold)).frame(width: 44, height: 44) }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
        }
        .padding(12)
        .ksSurface()
    }

    /// Where it is, then its fact; a place's fact starts with its city, so that part isn't said twice.
    static func detail(_ lead: String, city: String, fact: String?) -> String {
        var parts = (fact ?? "").components(separatedBy: " · ").filter { !$0.isEmpty }
        if !city.isEmpty, parts.first == city { parts.removeFirst() }
        return ([lead] + parts).filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// No pins at all: say so, and offer Review when places are waiting there for a place to be found.
    private var emptyState: some View {
        VStack(spacing: 12) {
            Text(places.isEmpty ? "No places here yet." : "None of your places has a pin yet.").font(.headline).foregroundStyle(t.ink)
                .multilineTextAlignment(.center)
            if waiting > 0, let onReview {
                Button("Review \(waiting) place\(waiting == 1 ? "" : "s")", action: onReview)
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.onAccent)
                    .padding(.horizontal, 18).frame(minHeight: 44)
                    .background(t.accent, in: Capsule())
            }
        }
        .padding(18).ksSurface()
        .padding(24)
    }
}

/// Pins drawn as one marker at this zoom.
struct PinCluster: Identifiable {
    let members: [Save]
    let centre: CLLocationCoordinate2D
    var id: String { members.map(\.id).joined(separator: ",") }
}
