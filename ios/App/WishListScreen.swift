import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// The row on Home and Collections that opens the Wish List.
struct WishListLink: View {
    @Environment(\.ks) private var t
    var body: some View {
        NavigationLink(value: Route.wishList) {
            HStack(spacing: 14) {
                Image(systemName: "gift").font(.title3.weight(.semibold)).foregroundStyle(t.ink)
                    .frame(width: 40, height: 40)
                    .background(t.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Wish List").font(.headline).foregroundStyle(t.ink)
                    Text("Everything still to buy, and where it costs least.").font(.subheadline).foregroundStyle(t.inkMuted)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.body.weight(.bold)).foregroundStyle(t.inkMuted).accessibilityHidden(true)
            }
            .padding(14)
            .ksSurface(radius: 14)
        }
        .buttonStyle(PressStyle())
        .accessibilityIdentifier("wishList.link")
    }
}

/// Wish List: every save that's something to buy, from all your collections and Review, and the lowest
/// prices found for each. Nothing is looked up until you ask: Find deals on one save, or Check all, sends
/// the product's name to your own AI provider, which searches the web (shared/wishlist.js). Apple
/// Intelligence can't search, so without a key the list still gathers everything and says what's needed.
struct WishListScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var list: WishList?
    /// Rows showing every store, not only the lowest.
    @State private var open: Set<String> = []
    @State private var confirming = false
    @State private var settings = false
    @State private var showHidden = false
    /// The row whose product is being named.
    @State private var naming: WishList.Row?

    private var rows: [WishList.Row] { list?.rows ?? [] }
    private var canFind: Bool { list?.keyReady == true && list?.searchReady == true }
    private var toCheck: [String] { list?.toCheck ?? [] }

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenHeader(title: "Wish List", subtitle: subtitle)
                    if let list {
                        if rows.isEmpty {
                            EmptyNote(symbol: "gift", text: "Nothing to buy yet. Products you save show up here, with a button to find where each one costs least.")
                        } else {
                            if !canFind { keyNote(list) }
                            if canFind { checkAll }
                            LazyVStack(spacing: 14) {
                                ForEach(rows) { row in
                                    WishRow(row: row, zoom: zoom, canFind: canFind, open: Binding(
                                        get: { open.contains(row.id) },
                                        set: { on in if on { open.insert(row.id) } else { open.remove(row.id) } }),
                                        name: { naming = row })
                                }
                            }
                            if rows.contains(where: { $0.state == "found" }) {
                                Text("Prices are what each store showed when it was checked. Another size or colour, shipping, tax and coupons can change them, so confirm on the store's page before you buy.")
                                    .font(.footnote).foregroundStyle(t.inkMuted)
                            }
                            if let spent = spentLine(list) {
                                Text(spent).font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit()
                                    .accessibilityIdentifier("wishList.spent")
                            }
                        }
                        if !list.hidden.isEmpty { hidden(list.hidden) }
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
            }
            .clearsTabBar()
        }
        .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: list)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Find deals for \(toCheck.count) \(toCheck.count == 1 ? "item" : "items")?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Find deals for \(toCheck.count)") { Task { await model.findDeals(toCheck) } }
        } message: {
            Text(checkAllCost + "Your AI provider searches the web for each one, using your key. Keep the app open while it runs. You can stop any time.")
        }
        .sheet(item: $naming) { row in
            WishNameSheet(row: row, canFind: canFind && model.dealRun == nil)
        }
        .sheet(isPresented: $settings, onDismiss: { Task { await model.refreshAIReady(); await load() } }) { SettingsScreen() }
        // model.saves changes when any save does (a price, Purchased, a sync from another device).
        .task(id: "\(model.savesChanged)|\(model.dealsChanged)") { await load() }
        .onAppear { Task { await load() } }
    }

    private var subtitle: String? {
        guard list != nil, !rows.isEmpty else { return nil }
        return rows.count == 1 ? "1 thing to buy, from all your collections." : "\(rows.count) things to buy, from all your collections."
    }

    /// "About 35 cents on your key (about 3 cents each). " before Check all, when the model's price is known.
    private var checkAllCost: String {
        guard let each = list?.estimateEach, each > 0 else { return "Every item is a few searches, so a long list uses more of your key's credit. " }
        let n = toCheck.count
        return n == 1 ? "\(Self.about(each).capitalizedFirst) on your key. " : "\(Self.about(each * Double(n)).capitalizedFirst) on your key (\(Self.about(each)) each). "
    }

    /// "Deal lookups on this device this month: 14, about 42 cents on your key."
    private func spentLine(_ list: WishList) -> String? {
        let s = list.spend
        guard s.lookups > 0 else { return nil }
        let count = "Deal lookups on this device this month: \(s.lookups)"
        if s.usd <= 0 { return count + "." }
        return count + ", \(Self.about(s.usd)) on your key" + (s.unpriced > 0 ? " (\(s.unpriced) not priced)." : ".")
    }

    /// "about 3 cents", "about $1.20". Never "0 cents": a lookup always costs something.
    static func about(_ usd: Double) -> String {
        if usd < 0.995 {
            let cents = max(1, Int((usd * 100).rounded()))
            return "about \(cents) \(cents == 1 ? "cent" : "cents")"
        }
        return "about " + usd.formatted(.currency(code: "USD").precision(.fractionLength(2)))
    }

    /// Check all, or how far the run has got with Stop.
    @ViewBuilder private var checkAll: some View {
        if let run = model.dealRun, run.total > 1 {
            HStack(spacing: 12) {
                ProgressView(value: Double(run.done), total: Double(max(run.total, 1)))
                    .progressViewStyle(.circular).controlSize(.small).tint(t.ink)
                Text(run.stopping ? "Stopping…" : run.waiting ? "Your AI asked to slow down. Waiting…" : "Checking \(min(run.done + 1, run.total)) of \(run.total)")
                    .font(.subheadline.weight(.medium)).foregroundStyle(t.ink).monospacedDigit()
                Spacer(minLength: 0)
                if !run.stopping {
                    Button("Stop") { model.dealRun?.stopping = true }
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
            }
            .padding(.horizontal, 16).frame(minHeight: 52)
            .ksSurface(radius: 14)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("wishList.progress")
        } else if toCheck.isEmpty {
            Text("Everything here was checked in the last 12 hours.").font(.subheadline).foregroundStyle(t.inkMuted)
        } else {
            Button { confirming = true } label: {
                Label(toCheck.count == rows.count ? "Find deals for all \(toCheck.count)" : "Find deals for the \(toCheck.count) not checked lately", systemImage: "tag")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading).padding(.horizontal, 16)
                    .ksSurface(radius: 14)
            }
            .buttonStyle(PressStyle())
            .disabled(model.dealRun != nil)
            .accessibilityHint("Asks first. Your AI provider searches the web for each one.")
            .accessibilityIdentifier("wishList.checkAll")
        }
    }

    /// Why there are no Find deals buttons, and the way to get them.
    private func keyNote(_ list: WishList) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(list.keyReady ? "Finding deals needs Anthropic or OpenAI" : "Finding deals uses your own AI key")
                .font(.headline).foregroundStyle(t.ink)
            Text(list.keyReady
                 ? "Your custom endpoint can't search the web. Switch to Anthropic or OpenAI in Settings."
                 : "Add an Anthropic or OpenAI key in Settings to search stores for each product.")
                .font(.subheadline).foregroundStyle(t.inkMuted)
            Button("Open Settings") { settings = true }
                .buttonStyle(.bordered).frame(minHeight: 44)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ksSurface(radius: 14)
        .accessibilityIdentifier("wishList.keyNote")
    }

    /// What you took off the list, to put back.
    private func hidden(_ saves: [Save]) -> some View {
        DisclosureGroup(isExpanded: $showHidden) {
            ForEach(saves) { save in
                HStack(spacing: 12) {
                    Text(save.title).font(.subheadline).foregroundStyle(t.ink).lineLimit(2)
                    Spacer(minLength: 0)
                    Button("Put back") { Task { await model.setWishHidden(save, false) } }
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
            }
        } label: {
            Text("Hidden (\(saves.count))").font(.subheadline.weight(.semibold)).foregroundStyle(t.ink).frame(minHeight: 44)
        }
        .tint(t.ink)
        .accessibilityIdentifier("wishList.hidden")
    }

    private func load() async {
        guard let lib = model.library, let next = try? await lib.wishList() else { return }
        if next != list { list = next }
    }
}

/// One thing to buy: its picture and name (tap for the save), then its deals or the button that finds them.
private struct WishRow: View {
    let row: WishList.Row
    let zoom: Namespace.ID
    let canFind: Bool
    @Binding var open: Bool
    /// Opens the sheet where you say exactly which product this is.
    let name: () -> Void
    /// False on the save's own page, which already shows its picture and name: a "Prices" title instead.
    var showsSave = true
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.openURL) private var openURL

    private var save: Save { row.item }
    /// Being looked up right now.
    private var busy: Bool { model.dealRun?.current == save.id }
    private var running: Bool { model.dealRun != nil }

    nonisolated(unsafe) private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if showsSave { header } else { pricesTitle }
            status
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ksSurface(radius: 16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(showsSave ? "wishList.row" : "save.deals")
    }

    /// On the save's own page: what this card is, and the way to name the exact product.
    private var pricesTitle: some View {
        HStack(alignment: .center, spacing: 8) {
            Text("Prices at other stores").font(.headline).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Menu {
                Button("Name the exact product", systemImage: "pencil") { name() }.disabled(busy)
                Button("Hide from Wish List", systemImage: "eye.slash") { Task { await model.setWishHidden(save, true) } }
            } label: {
                Image(systemName: "ellipsis").font(.body.weight(.bold)).foregroundStyle(t.inkMuted)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("More for prices")
            .padding(.vertical, -8).padding(.trailing, -8)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 4) {
            NavigationLink(value: save) {
                HStack(alignment: .top, spacing: 12) {
                    SaveImage(save, symbolSize: 22)
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .matchedTransitionSource(id: save.id, in: zoom)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(save.title).font(.headline).foregroundStyle(t.ink).lineLimit(3).multilineTextAlignment(.leading)
                        Text(meta).font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit().multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(save.title)
            .accessibilityValue(meta)
            .accessibilityHint("Opens the save")
            Menu {
                Button("Name the exact product", systemImage: "pencil") { name() }.disabled(busy)
                Button("Mark purchased", systemImage: "bag.badge.checkmark") { Task { await model.markPurchased(save) } }
                Button("Hide from Wish List", systemImage: "eye.slash") { Task { await model.setWishHidden(save, true) } }
            } label: {
                Image(systemName: "ellipsis").font(.body.weight(.bold)).foregroundStyle(t.inkMuted)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("More for \(save.title)")
            .padding(.top, -8).padding(.trailing, -8)
        }
    }

    /// "Saved at $279.00 · Tech".
    private var meta: String {
        [row.savedPrice.isEmpty ? nil : "Saved at \(row.savedPrice)", row.collection.isEmpty ? "In Review" : row.collection]
            .compactMap { $0 }.joined(separator: " · ")
    }

    @ViewBuilder private var status: some View {
        if busy {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small).tint(t.ink)
                Text(model.dealRun?.waiting == true ? "Your AI asked to slow down. Waiting…" : "Searching stores…")
                    .font(.subheadline).foregroundStyle(t.inkMuted)
            }
            .frame(minHeight: 44)
            .accessibilityElement(children: .combine)
        } else {
            if row.state != "found", !row.wishName.isEmpty {
                // Your own words for it, which the next search uses.
                Text("Searching as: \(row.wishName)").font(.footnote).foregroundStyle(t.inkMuted)
                    .accessibilityIdentifier("wishList.searchingAs")
            }
            switch row.state {
            case "found": found
            case "none": nothing("No current prices found for this one.")
            case "unsure": unsure
            default:
                if canFind { findButton("Find deals", symbol: "tag") }
            }
        }
    }

    /// "Priced as: Sony WH-1000XM6, black" with the way to correct it.
    @ViewBuilder private var pricedAs: some View {
        // What the search says it priced, so a mismatch with what you meant shows; your words when it didn't say.
        let what = row.product.isEmpty ? row.wishName : row.product
        if !what.isEmpty {
            Button { name() } label: {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("Priced as: \(what)").font(.footnote).foregroundStyle(t.inkMuted).multilineTextAlignment(.leading)
                    Text("Fix").font(.footnote.weight(.semibold)).foregroundStyle(t.ink)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .accessibilityLabel("Priced as \(what)")
            .accessibilityHint("Say exactly which product this is")
            .accessibilityIdentifier("wishList.pricedAs")
        }
    }

    /// The search couldn't tell which product the save is: say which, right here.
    private var unsure: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Couldn't tell exactly which product this is.").font(.subheadline).foregroundStyle(t.ink)
            Button { name() } label: {
                Label("Say which product", systemImage: "pencil").font(.subheadline.weight(.semibold)).frame(minHeight: 32)
            }
            .buttonStyle(.bordered).buttonBorderShape(.capsule).tint(t.ink)
            .accessibilityIdentifier("wishList.sayWhich")
        }
    }

    private var found: some View {
        VStack(alignment: .leading, spacing: 8) {
            pricedAs
            if row.bestPrice.isEmpty && row.offers.contains(where: { !$0.outOfStock }) {
                Label("Only unusually low prices turned up. Check each store carefully before you buy.", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote).foregroundStyle(t.ink)
            } else if !row.saving.isEmpty {
                Text("\(row.saving) less than you saved it at" + (row.savingPct.map { " (\($0)% off)" } ?? ""))
                    .font(.footnote.weight(.bold)).foregroundStyle(t.onAccent)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(t.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            } else if !row.savedPrice.isEmpty && !row.bestPrice.isEmpty {
                Text("Nothing below the \(row.savedPrice) you saved it at.").font(.footnote).foregroundStyle(t.inkMuted)
            }
            VStack(spacing: 0) {
                ForEach(open ? row.offers : Array(row.offers.prefix(1))) { offer in
                    if offer.id != row.offers.first?.id { Divider().overlay(t.rule) }
                    offerRow(offer)
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 16) {
                    Text(checked).font(.footnote).foregroundStyle(t.inkMuted).lineLimit(1)
                    Spacer(minLength: 0)
                    footerButtons
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text(checked).font(.footnote).foregroundStyle(t.inkMuted)
                    HStack(spacing: 16) { footerButtons; Spacer(minLength: 0) }
                }
            }
        }
    }

    @ViewBuilder private var footerButtons: some View {
        if row.offers.count > 1 {
            Button(open ? "Show less" : "All \(row.offers.count) stores") { open.toggle() }
                .font(.footnote.weight(.semibold)).frame(minHeight: 44)
                .accessibilityIdentifier("wishList.stores")
        }
        if canFind {
            Button("Check again") { Task { await model.findDeals([save.id]) } }
                .font(.footnote.weight(.semibold)).frame(minHeight: 44)
                .disabled(running)
        }
    }

    /// A store and its price; tapping opens the store's page.
    private func offerRow(_ offer: WishList.Offer) -> some View {
        let detail = [offer.outOfStock ? "Out of stock" : nil, offer.sale.isEmpty ? nil : offer.sale,
                      offer.confirmed ? "Price on the store's page" : "Price from search results"].compactMap { $0 }.joined(separator: " · ")
        let warning = "Unusually low, and not a store we know. Check it before you buy."
        return HStack(alignment: .top, spacing: 0) {
            Button {
                if let url = URL(string: offer.url) { openURL(url) }
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .center, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(offer.store).font(.subheadline.weight(.semibold)).foregroundStyle(t.ink).multilineTextAlignment(.leading)
                            Text(detail).font(.footnote).foregroundStyle(t.inkMuted).multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: 8)
                        Text(offer.price).font(offer.lowest ? .headline : .subheadline.weight(.medium)).foregroundStyle(offer.outOfStock ? t.inkMuted : t.ink)
                            .monospacedDigit().strikethrough(offer.outOfStock)
                    }
                    if offer.doubt {
                        Label(warning, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote.weight(.medium)).foregroundStyle(t.ink).multilineTextAlignment(.leading)
                            .padding(.bottom, 6)
                    }
                }
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .accessibilityLabel("\(offer.store), \(offer.price)\(offer.lowest ? ", lowest price" : "")")
            .accessibilityValue(offer.doubt ? "\(detail). \(warning)" : detail)
            .accessibilityHint("Opens the store's page")
            .accessibilityIdentifier("wishList.offer")
            Menu {
                Button("Open the store's page", systemImage: "arrow.up.right") { if let url = URL(string: offer.url) { openURL(url) } }
                Button("Not the same item", systemImage: "hand.thumbsdown", role: .destructive) { Task { await model.removeOffer(save, offer) } }
            } label: {
                Image(systemName: "ellipsis").font(.footnote.weight(.bold)).foregroundStyle(t.inkMuted)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("More for \(offer.store), \(save.title)")
            .accessibilityIdentifier("wishList.offerMenu")
            .padding(.trailing, -10).padding(.top, 4)
        }
    }

    private func nothing(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(text).font(.subheadline).foregroundStyle(t.ink)
            HStack(spacing: 16) {
                Text(checked).font(.footnote).foregroundStyle(t.inkMuted)
                Spacer(minLength: 0)
                if canFind {
                    Button("Try again") { Task { await model.findDeals([save.id]) } }
                        .font(.footnote.weight(.semibold)).frame(minHeight: 44)
                        .disabled(running)
                }
            }
        }
    }

    private func findButton(_ title: String, symbol: String) -> some View {
        Button { Task { await model.findDeals([save.id]) } } label: {
            Label(title, systemImage: symbol).font(.subheadline.weight(.semibold)).frame(minHeight: 32)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(t.ink)
        .disabled(running)
        .accessibilityHint("Your AI provider searches the web for this product.")
        .accessibilityIdentifier("wishList.find")
    }

    /// "Checked 2 hours ago", and a nudge when that was days ago.
    private var checked: String {
        guard let s = row.checkedAt, let date = Self.iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return "" }
        return "Checked \(date.formatted(.relative(presentation: .named)))" + (row.old ? ". Prices may have moved." : "")
    }
}

/// A product's deals on its own page: the same prices and controls as its row on the Wish List, which
/// stays the place that gathers them all. Shows nothing for a save that is bought, hidden from the Wish
/// List or not something to buy, and nothing when there are no prices yet and no key to find them with.
struct DealPanel: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @Namespace private var zoom
    @State private var one: WishList.One?
    @State private var open = false
    @State private var naming: WishList.Row?

    private var canFind: Bool { one?.keyReady == true && one?.searchReady == true }

    var body: some View {
        // A stack, not a Group: it exists before the row loads, so the task below has a view to run on.
        VStack(spacing: 0) {
            if let row = one?.row, row.state != "unchecked" || canFind {
                WishRow(row: row, zoom: zoom, canFind: canFind, open: $open, name: { naming = row }, showsSave: false)
            }
        }
        .sheet(item: $naming) { row in
            WishNameSheet(row: row, canFind: canFind && model.dealRun == nil)
        }
        .task(id: "\(save.id)|\(model.savesChanged)|\(model.dealsChanged)") { await load() }
    }

    private func load() async {
        guard let lib = model.library, let next = try? await lib.wishRow(save.id) else { return }
        if next != one { one = next }
    }
}

/// The button at the top right of something to buy: the ways to give it more to go on. Fix with AI reads
/// the save again, Find Deals looks for prices, Add Product Link takes the store page you paste, and Name
/// the Exact Product says which one it is in your words.
struct ProductHelpMenu: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @State private var one: WishList.One?
    @State private var naming: WishList.Row?
    @State private var linking = false

    private var canFind: Bool { one?.keyReady == true && one?.searchReady == true }

    var body: some View {
        Menu {
            if model.aiReady {
                Button("Fix with AI", systemImage: "sparkles") { Task { await model.fixWithAI([save]) } }
                    .disabled(model.aiRun != nil)
            }
            if canFind, one?.row != nil {
                Button("Find Deals", systemImage: "tag") { Task { await model.findDeals([save.id]) } }
                    .disabled(model.dealRun != nil)
            }
            // Not for a recipe, a place or the like that happens to sit in a collection: those aren't one thing to buy.
            if save.kind == "product" || one?.row != nil {
                Button("Add Product Link…", systemImage: "link") { linking = true }
            }
            if let row = one?.row {
                Button("Name the Exact Product…", systemImage: "pencil") { naming = row }
                    .disabled(model.dealRun != nil)
            }
        } label: {
            Label("Improve", systemImage: "sparkles")
        }
        .accessibilityHint("Ways to add what's missing: a store link, the exact product, prices, or another read by AI.")
        .accessibilityIdentifier("save.improve")
        .task(id: "\(save.id)|\(model.savesChanged)|\(model.dealsChanged)") {
            guard let lib = model.library, let next = try? await lib.wishRow(save.id) else { return }
            if next != one { one = next }
        }
        .sheet(item: $naming) { row in
            WishNameSheet(row: row, canFind: canFind && model.dealRun == nil)
        }
        .sheet(isPresented: $linking) { ProductLinkSheet(save: save) }
    }
}

/// Add Product Link: paste the product's page in a store. The page is read once, without AI, and becomes
/// the save's shop page; its name, price and picture fill in what the save was missing. Undo on the toast.
private struct ProductLinkSheet: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var working = false
    @State private var problem = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Paste the product's page from a store. Its name, price and picture fill in what this save is missing, and Find deals then knows exactly which product you mean. You can undo it.")
                    .font(.subheadline).foregroundStyle(t.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    TextField("https://", text: $link)
                        .keyboardType(.URL).textContentType(.URL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($focused)
                        .onSubmit { start() }
                        .disabled(working)
                        .foregroundStyle(t.ink)
                        .padding(.horizontal, 16).frame(minHeight: 52)
                        .background(t.well, in: Capsule())
                        .overlay(Capsule().strokeBorder(focused ? t.accent : t.rule, lineWidth: focused ? 1.5 : 1))
                        .accessibilityLabel("Product link")
                        .accessibilityIdentifier("productLink.field")
                    // The system Paste button reads the clipboard only when tapped, so iOS never asks to allow it.
                    PasteButton(payloadType: URL.self) { urls in
                        if let url = urls.first { link = url.absoluteString; start() }
                    }
                    .labelStyle(.iconOnly)
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
                    .tint(t.accentForWhiteGlyph)
                    .disabled(working)
                    .accessibilityLabel("Paste the link you copied")
                }
                if !problem.isEmpty {
                    Label(problem, systemImage: "exclamationmark.circle")
                        .font(.subheadline).foregroundStyle(t.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("productLink.problem")
                }
                Spacer(minLength: 0)
                PrimarySlab(working ? "Reading the page…" : "Add Link", symbol: "link", kind: "product") { start() }
                    .overlay(alignment: .leading) {
                        if working { ProgressView().tint(t.onPrimary).padding(.leading, 24).accessibilityHidden(true) }
                    }
                    .disabled(!working && link.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("productLink.add")
            }
            .padding(20)
            .background(TableBackground())
            .navigationTitle("Add Product Link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) } }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(working)
        .onAppear { focused = true }
    }

    private func start() {
        guard !working, let lib = model.library else { return }
        let text = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        working = true
        problem = ""
        Task {
            defer { working = false }
            do {
                let r = try await lib.linkProduct(save.id, link: text)
                guard r.ok else {
                    problem = r.error ?? "Couldn't read that page."
                    Haptic.warning()
                    UIAccessibility.post(notification: .announcement, argument: problem)
                    return
                }
                Haptic.settled()
                model.refresh()
                model.dealsChanged += 1
                dismiss()
                let site = r.site ?? "the store"
                let said = r.read == true
                    ? "Linked to \(site)" + ((r.price ?? "").isEmpty ? "" : ": \(r.price ?? "")")
                    : "Linked to \(site). No price or details could be read from that page, so only the link was added."
                if let id = r.logId {
                    model.show(said) {
                        try? await lib.undoAI([id])
                        model.refresh()
                        model.dealsChanged += 1
                    }
                } else {
                    model.show(said)
                }
            } catch {
                problem = error.localizedDescription
            }
        }
    }
}

/// Where you say exactly which product a save is: brand, model, size, colour. Find deals searches for
/// these words instead of the save's title, which doesn't change.
private struct WishNameSheet: View {
    let row: WishList.Row
    let canFind: Bool
    @Environment(LibraryModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var current: String { row.wishName.isEmpty ? row.item.title : row.wishName }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Brand, model, size, colour", text: $text, axis: .vertical)
                        .lineLimit(2...5).focused($focused)
                        .accessibilityIdentifier("wishList.nameField")
                } header: {
                    Text("Exactly which product?")
                } footer: {
                    Text("Find deals searches for these words, so include the model and the size or colour you want. Your save keeps its own title. Prices found under the old name are cleared.")
                }
                if !row.product.isEmpty && row.product != text {
                    Section("The last search priced it as") {
                        Button(row.product) { text = row.product }.foregroundStyle(.primary)
                    }
                }
                if !row.wishName.isEmpty {
                    Section {
                        Button("Go back to the save's title") { save(row.item.title, find: false) }
                    }
                }
            }
            .navigationTitle("Name the product").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(canFind ? "Save and find deals" : "Save") { save(trimmed, find: canFind) }
                        .disabled(trimmed.isEmpty || (trimmed == current && row.state != "unsure" && row.state != "unchecked" && row.state != "none"))
                        .accessibilityIdentifier("wishList.nameSave")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { text = current; focused = true }
    }

    private func save(_ name: String, find: Bool) {
        dismiss()
        Task { await model.setWishName(row.item, name, find: find) }
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

extension LibraryModel {
    /// Find deals for these saves with your own key, one at a time (each is a web search by your provider),
    /// so the list fills in as it goes and Stop works. A provider that asks to slow down gets a pause and
    /// another try; a bad key or no credit ends the run, since every other save would fail the same way.
    func findDeals(_ ids: [String]) async {
        guard let lib = library, !ids.isEmpty, dealRun == nil else { return }
        dealRun = DealRun(total: ids.count)
        // A long list takes minutes: the screen stays on while it runs.
        let keptAwake = ids.count > 1 && !UIApplication.shared.isIdleTimerDisabled
        if keptAwake { UIApplication.shared.isIdleTimerDisabled = true }
        defer { if keptAwake { UIApplication.shared.isIdleTimerDisabled = false } }
        var found = 0, failed = 0
        var problem = ""
        var fatal = false
        for (n, id) in ids.enumerated() {
            if dealRun?.stopping == true { break }
            dealRun?.current = id
            var tries = 0
            var trying = true
            while trying {
                do {
                    if try await lib.findDeals(id) > 0 { found += 1 }
                    trying = false
                } catch {
                    let message = error.localizedDescription
                    if message.contains("(429)"), tries < 2, dealRun?.stopping != true {
                        tries += 1
                        dealRun?.waiting = true
                        for _ in 0..<30 where dealRun?.stopping != true { try? await Task.sleep(for: .seconds(1)) }
                        dealRun?.waiting = false
                        // Stop during the wait: no more requests.
                        if dealRun?.stopping == true { trying = false }
                    } else {
                        failed += 1
                        problem = message
                        fatal = message.range(of: #"\((401|403|429)\)|API key|base URL"#, options: .regularExpression) != nil
                        trying = false
                    }
                }
            }
            dealRun?.done = n + 1
            dealsChanged += 1
            if fatal { break }
        }
        let done = dealRun?.done ?? 0
        dealRun = nil
        dealsChanged += 1
        if ids.count == 1 {
            // The row itself says what was found; only a failure needs words.
            if failed > 0 { Haptic.refused(); show("Couldn't find deals: \(problem)") } else { Haptic.settled() }
            return
        }
        if fatal {
            Haptic.refused()
            show("Stopped after \(done) of \(ids.count): \(problem)")
        } else {
            Haptic.settled()
            show("Checked \(done) of \(ids.count). Found prices for \(found)\(failed > 0 ? ", \(failed) couldn't be checked" : "").")
        }
    }

    /// "Not the same item": that store's price goes (with Undo), and the store is skipped for this save from now on.
    func removeOffer(_ save: Save, _ offer: WishList.Offer) async {
        guard let lib = library, let undo = try? await lib.removeOffer(save.id, url: offer.url) else { return }
        dealsChanged += 1
        show("Removed. \(offer.store) is skipped for this one from now on.", undo: { @MainActor in
            try? await lib.restoreOffer(save.id, undo)
            self.dealsChanged += 1
        })
    }

    /// Says exactly which product a save is, for Find deals; the save's own title stays. Prices found
    /// under the old name are dropped, and `find` looks again straight away.
    func setWishName(_ save: Save, _ name: String, find: Bool) async {
        guard let lib = library else { return }
        try? await lib.setWishName(save.id, name)
        dealsChanged += 1
        if find { await findDeals([save.id]) }
    }

    /// Takes a save off the Wish List (with Undo), or puts it back. Its deals stay.
    func setWishHidden(_ save: Save, _ hidden: Bool) async {
        guard let lib = library else { return }
        try? await lib.setWishHidden([save.id], hidden)
        dealsChanged += 1
        guard hidden else { return }
        show("Hidden from your Wish List", undo: { @MainActor in
            try? await lib.setWishHidden([save.id], false)
            self.dealsChanged += 1
        })
    }

    /// Bought it: it leaves the Wish List and shows as Purchased in its collection.
    func markPurchased(_ save: Save) async {
        guard let lib = library else { return }
        try? await lib.update(save.id, ["purchased": true])
        refresh()
        dealsChanged += 1
        celebrate("Purchased!")
    }
}
