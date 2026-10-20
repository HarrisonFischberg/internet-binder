import AVFoundation
import Observation
import SwiftUI

/// Music while cooking: ten original instrumentals bundled in App/Music (ios/tools/make-cooking-music.py
/// composes and renders them), shuffled and played one after another while Cooking mode is open.
/// The audio session is ambient, so the silent switch silences it and it mixes under anything else that is
/// playing instead of stopping it; when another app is already playing, it waits for a tap instead.
@MainActor @Observable
final class CookingMusic {
    static let enabledKey = "cookingMusic"
    static let volume: Float = 0.7

    struct Track: Equatable {
        let url: URL
        /// "cooking-01-butter-and-toast.m4a" -> "Butter & Toast"
        var title: String {
            url.deletingPathExtension().lastPathComponent.split(separator: "-").dropFirst(2)
                .map { $0 == "and" ? "&" : $0.capitalized }.joined(separator: " ")
        }
    }

    static let tracks: [Track] = (Bundle.main.urls(forResourcesWithExtension: "m4a", subdirectory: nil) ?? [])
        .filter { $0.lastPathComponent.hasPrefix("cooking-") }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }
        .map(Track.init)

    private(set) var current: Track?
    private(set) var playing = false
    private var order: [Track] = []
    private var index = 0
    private var player: AVAudioPlayer?
    private var heldByUser = false
    @ObservationIgnored private let relay = Relay()
    @ObservationIgnored private var interruptions: NSObjectProtocol?

    init() {
        relay.finished = { [weak self] in self?.skip() }
    }

    /// Opens Cooking mode's music: a fresh shuffle, starting unless something else is already playing.
    func start() {
        guard !Self.tracks.isEmpty, player == nil else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient)
        try? session.setActive(true)
        order = Self.tracks.shuffled()
        index = 0
        heldByUser = session.secondaryAudioShouldBeSilencedHint
        load(play: !heldByUser)
        interruptions = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let ended = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init(rawValue:)) == .ended
            MainActor.assumeIsolated { if ended { self?.resume() } else { self?.playing = false } }
        }
    }

    /// Closes it: a short fade, then silence.
    func stop() {
        if let interruptions { NotificationCenter.default.removeObserver(interruptions) }
        interruptions = nil
        guard let p = player else { return }
        player = nil; current = nil; playing = false
        p.setVolume(0, fadeDuration: 0.6)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
            p.stop()
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    func toggle() {
        guard let p = player else { return }
        if p.isPlaying { p.pause(); playing = false; heldByUser = true } else { heldByUser = false; fadeIn(p) }
    }

    func skip() {
        guard !order.isEmpty, player != nil else { return }
        index = (index + 1) % order.count
        if index == 0 { order.shuffle() }
        load(play: !heldByUser)
    }

    /// Back from the background or a phone call: carry on, unless the cook paused it.
    func resume() {
        guard let p = player, !heldByUser, !p.isPlaying else { return }
        fadeIn(p)
    }

    func suspend() {
        player?.pause()
        playing = false
    }

    private func load(play: Bool) {
        player?.stop()
        let track = order[index]
        current = track
        guard let p = try? AVAudioPlayer(contentsOf: track.url) else { player = nil; playing = false; return }
        p.delegate = relay
        p.prepareToPlay()
        player = p
        if play { fadeIn(p) } else { playing = false }
    }

    private func fadeIn(_ p: AVAudioPlayer) {
        p.volume = 0
        p.play()
        p.setVolume(Self.volume, fadeDuration: 1.2)
        playing = true
    }

    private final class Relay: NSObject, AVAudioPlayerDelegate {
        var finished: (@MainActor () -> Void)?
        func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
            Task { @MainActor [finished] in finished?() }
        }
    }
}

/// The small now-playing capsule under Cooking mode's header: pause, next song, and turn music off.
/// With music off it is one button that turns it back on.
struct CookingMusicBar: View {
    let music: CookingMusic
    @Binding var on: Bool
    @Environment(\.ks) private var t

    var body: some View {
        HStack(spacing: 0) {
            if on, let track = music.current {
                Image(systemName: "music.note").font(.footnote.weight(.semibold)).foregroundStyle(t.stamp)
                    .padding(.leading, 14).accessibilityHidden(true)
                Text(track.title).font(.footnote.weight(.semibold)).foregroundStyle(t.inkMuted).lineLimit(1)
                    .padding(.leading, 6).padding(.trailing, 2)
                    .accessibilityLabel("Now playing \(track.title)")
                button(music.playing ? "Pause music" : "Play music", music.playing ? "pause.fill" : "play.fill") { music.toggle() }
                button("Next song", "forward.fill") { music.skip() }
                button("Turn music off", "speaker.slash.fill") { on = false }
            } else if !on, !CookingMusic.tracks.isEmpty {
                Button { on = true } label: {
                    Label("Music", systemImage: "music.note").font(.footnote.weight(.semibold)).foregroundStyle(t.inkMuted)
                        .padding(.horizontal, 14).frame(height: 44)
                }
                .accessibilityLabel("Turn music on")
            }
        }
        .ksSurface(radius: 22, scale: 0.6)
        .opacity(on && music.current == nil ? 0 : 1)
    }

    private func button(_ label: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.footnote.weight(.semibold)).foregroundStyle(t.ink).frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }
}
