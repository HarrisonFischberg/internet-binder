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
    @State private var mode: Mode = .list
    @State private var view: PlacesView?
    @State private var editing: Save?
    @State private var reading: String?

    enum Mode: String, CaseIterable { case list = "List", map = "Map", review = "Review" }

    var body: some View {
        ZStack {
            TableBackground()
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(title: "Places", subtitle: subtitle)
                    Picker("Show", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { m in
                            Text(m == .review && waiting > 0 ? "Review \(waiting)" : m.rawValue).tag(m)
                        }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: mode) { Haptic.detent() }
                }
                .padding(.horizontal, 18).padding(.bottom, 12)
                switch mode {
                case .list: list
                case .map: map
                case .review: review
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: model.saves.map(\.id).joined() + model.saves.map { $0.status ?? "" }.joined()) {
            view = try? await model.library?.places()
        }
        .sheet(item: $editing) { save in
            PlaceFixSheet(save: save) { Task { view = try? await model.library?.places() } }
        }
    }

    private var waiting: Int { view?.review.count ?? 0 }
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
                        .background(t.table)
                        .accessibilityAddTraits(.isHeader)
                    }
                }
            }
            .padding(.horizontal, 18).padding(.bottom, 40)
        }
    }

    private func row(_ place: Save) -> some View {
        NavigationLink(value: model.saves.first { $0.id == place.id } ?? place) {
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
            .matchedTransitionSource(id: place.id, in: zoom)
        }
        .buttonStyle(PressStyle())
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
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(w.item.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(2)
                            Text(w.reasons.map(Self.why).joined(separator: " · ")).font(.footnote).foregroundStyle(t.stamp)
                        }
                        Spacer()
                        VStack(spacing: 6) {
                            // Chrome's Read again / Fix with AI: the caption read again on this iPhone, then
                            // your AI and Lookups if they're on. Never changes what you typed.
                            Button {
                                readAgain(w.item)
                            } label: {
                                if reading == w.item.id { ProgressView() } else { Text("Read again") }
                            }
                            .buttonStyle(.bordered).frame(minHeight: 44)
                            .disabled(reading != nil)
                            .accessibilityLabel("Read \(w.item.title) again")
                            Button("Fix") { editing = w.item }
                                .buttonStyle(.bordered).frame(minHeight: 44)
                                .accessibilityLabel("Fix \(w.item.title)")
                        }
                    }
                    .padding(14).ksSurface()
                }
            }
            .padding(.horizontal, 18).padding(.bottom, 40)
        }
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

    var body: some View {
        Map {
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
    }
}
