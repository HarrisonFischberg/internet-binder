import AVFoundation
import Observation
import SwiftUI

/// Music while cooking: ten freely licensed recordings (jazz, soft guitar, classical piano) bundled in
/// App/Music, listed with their credits and licenses in App/Music/cooking-music.json (and ios/MUSIC-CREDITS.md),
/// shuffled and played one after another at 20% volume while Cooking mode is open.
/// It starts on its own when Cooking opens, in the ambient session, so with the phone on silent it plays
/// muted and the bar asks "Tap to unmute music". That tap (or a volume press, play, or turning music on
/// from the bar) is asking to hear it, so the session moves to playback, which Silent mode does not mute.
/// Either way it mixes under anything else that is playing instead of stopping it; when another app is
/// already playing, it waits for a tap.
@MainActor @Observable
final class CookingMusic {
    static let enabledKey = "cookingMusic"
    static let volume: Float = 0.2

    /// One song and its credit, as cooking-music.json lists it.
    struct Track: Equatable, Decodable {
        let file: String
        let title: String
        let artist: String
        let license: String
        let licenseURL: String
        let source: String
        var url: URL? { Bundle.main.url(forResource: file, withExtension: nil) }
    }

    /// Every song whose file is bundled, in the credits' order.
    static let tracks: [Track] = {
        guard let url = Bundle.main.url(forResource: "cooking-music", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Track].self, from: data) else { return [] }
        return list.filter { $0.url != nil }
    }()

    private(set) var current: Track?
    private(set) var playing = false
    /// False while the session is ambient, where Silent mode mutes it: the bar asks to unmute.
    private(set) var audible = false
    private var order: [Track] = []
    private var index = 0
    private var player: AVAudioPlayer?
    private var heldByUser = false
    @ObservationIgnored private let relay = Relay()
    @ObservationIgnored private var interruptions: NSObjectProtocol?
    @ObservationIgnored private var volumeButtons: NSKeyValueObservation?

    init() {
        relay.finished = { [weak self] in self?.skip() }
    }

    /// Opens Cooking mode's music: a fresh shuffle, starting unless something else is already playing.
    /// `audible` (the cook turned music on just now) skips the muted-on-silent start.
    func start(audible: Bool = false) {
        guard !Self.tracks.isEmpty, player == nil else { return }
        let session = AVAudioSession.sharedInstance()
        if audible { makeAudible() } else { try? session.setCategory(.ambient) }
        try? session.setActive(true)
        // A volume press changes outputVolume; at the very top or bottom of the range it does not, so a tap on play also works.
        volumeButtons = session.observe(\.outputVolume) { [weak self] _, _ in
            Task { @MainActor in self?.makeAudible() }
        }
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
        volumeButtons?.invalidate()
        volumeButtons = nil
        guard let p = player else { return }
        player = nil; current = nil; playing = false; audible = false
        p.setVolume(0, fadeDuration: 0.6)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            p.stop()
            guard self?.player == nil else { return }  // turned straight back on
            let session = AVAudioSession.sharedInstance()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            // Back to ambient, so the Sound setting's tick goes quiet in Silent mode again.
            try? session.setCategory(.ambient)
        }
    }

    func toggle() {
        guard let p = player else { return }
        if p.isPlaying { p.pause(); playing = false; heldByUser = true } else { heldByUser = false; makeAudible(); fadeIn(p) }
    }

    /// "Tap to unmute music": heard from now on, even with the phone on silent, and playing.
    func unmute() {
        guard let p = player else { return }
        heldByUser = false
        makeAudible()
        if !p.isPlaying { fadeIn(p) }
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

    /// Playback mixed with others: heard even with the phone on silent.
    private func makeAudible() {
        let session = AVAudioSession.sharedInstance()
        audible = true
        guard session.category != .playback else { return }
        try? session.setCategory(.playback, options: .mixWithOthers)
    }

    private func load(play: Bool) {
        player?.stop()
        let track = order[index]
        current = track
        guard let url = track.url, let p = try? AVAudioPlayer(contentsOf: url) else { player = nil; playing = false; return }
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
/// Until the music is audible it is a "Tap to unmute music" button instead (Silent mode mutes the
/// ambient start). With music off it is one button that turns it back on.
struct CookingMusicBar: View {
    let music: CookingMusic
    @Binding var on: Bool
    @Environment(\.ks) private var t

    var body: some View {
        HStack(spacing: 0) {
            if on, music.current != nil, !music.audible {
                Button { music.unmute() } label: {
                    Label("Tap to unmute music", systemImage: "speaker.wave.2.fill")
                        .font(.footnote.weight(.semibold)).foregroundStyle(t.stamp)
                        .padding(.leading, 14).padding(.trailing, 6).frame(height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Unmute music")
                .accessibilityHint("Plays quietly, even with your iPhone on silent")
                button("Turn music off", "xmark") { on = false }
            } else if on, let track = music.current {
                Image(systemName: "music.note").font(.footnote.weight(.semibold)).foregroundStyle(t.stamp)
                    .padding(.leading, 14).accessibilityHidden(true)
                HStack(spacing: 6) {
                    Text(track.title).fontWeight(.semibold).foregroundStyle(t.ink).layoutPriority(1)
                    Text(track.artist).foregroundStyle(t.inkMuted)
                }
                .font(.footnote).lineLimit(1)
                .padding(.leading, 6).padding(.trailing, 2)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Now playing \(track.title) by \(track.artist)")
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
        .ksGlass(Capsule())
        .opacity(on && music.current == nil ? 0 : 1)
        .animation(.snappy, value: music.audible)
    }

    private func button(_ label: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.footnote.weight(.semibold)).foregroundStyle(t.ink).frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }
}
