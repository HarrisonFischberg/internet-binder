import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Cooking: one step fills the screen, in large type, and the screen stays awake. Swipe or tap Next;
/// the ingredients are one tap away. The last step offers "Cooked".
struct CookingView: View {
    let save: Save
    let steps: [String]
    let ingredients: [String]
    let cooked: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var step = 0
    @State private var showIngredients = false
    @State private var checked: Set<Int> = []

    var body: some View {
        ZStack {
            TableBackground()
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly).font(.title3).frame(width: 44, height: 44)
                    Spacer()
                    Text("Step \(step + 1) of \(steps.count)").font(.subheadline.weight(.semibold)).foregroundStyle(t.inkMuted)
                        .contentTransition(.numericText())
                    Spacer()
                    Button("Ingredients", systemImage: "list.bullet") { showIngredients = true }
                        .labelStyle(.iconOnly).font(.title3).frame(width: 44, height: 44)
                        .disabled(ingredients.isEmpty)
                }
                .padding(.horizontal, 12)
                TabView(selection: $step) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, text in
                        ScrollView {
                            VStack(alignment: .leading, spacing: 16) {
                                Text("\(i + 1)").font(.system(size: 64, weight: .semibold, design: .serif)).foregroundStyle(t.stamp)
                                Text(text).font(.system(.title2, design: .serif)).foregroundStyle(t.ink).lineSpacing(6)
                            }
                            .padding(24)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .onChange(of: step) { Haptic.pageTurned() }
                HStack(spacing: 12) {
                    if step > 0 {
                        Button { withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { step -= 1 } } label: {
                            Image(systemName: "chevron.left").font(.headline).frame(width: 56, height: 56)
                                .background(t.paper, in: Circle()).overlay(Circle().strokeBorder(t.rule))
                        }
                        .accessibilityLabel("Previous step")
                    }
                    if step < steps.count - 1 {
                        PrimarySlab("Next step", symbol: "arrow.right") { withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { step += 1 } }
                    } else {
                        PrimarySlab("Mark as cooked", symbol: "checkmark.seal.fill") {
                            Haptic.stamped()
                            cooked()
                            dismiss()
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 8)
            }
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        .sheet(isPresented: $showIngredients) {
            NavigationStack {
                List(Array(ingredients.enumerated()), id: \.offset) { i, line in
                    Button {
                        Haptic.checked()
                        if checked.contains(i) { checked.remove(i) } else { checked.insert(i) }
                    } label: {
                        Label(line, systemImage: checked.contains(i) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(checked.contains(i) ? t.inkMuted : t.ink)
                    }
                    .accessibilityAddTraits(checked.contains(i) ? .isSelected : [])
                }
                .navigationTitle("Ingredients").navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.medium, .large])
        }
    }
}
