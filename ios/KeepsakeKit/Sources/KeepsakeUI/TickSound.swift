import Foundation

/// The Sound setting's soft tick, drawn in code as a small WAV so there is no file to ship: a short wooden
/// tock (two sine partials with a quick fall-off). It used to be system sound 1104, the keyboard click,
/// which iOS keeps silent whenever Keyboard Clicks is off in Settings, so turning Sound on often did nothing.
public enum TickSound {
    public static let sampleRate = 44_100
    public static let duration = 0.07

    /// 16-bit mono PCM in a RIFF/WAVE header, ready for `AVAudioPlayer(data:)`.
    public static let wav: Data = {
        let count = Int(Double(sampleRate) * duration)
        var pcm = Data(capacity: count * 2)
        for i in 0..<count {
            let t = Double(i) / Double(sampleRate)
            let attack = min(1, t / 0.002)
            let body = sin(2 * .pi * 880 * t) * exp(-t / 0.018) + 0.45 * sin(2 * .pi * 1760 * t) * exp(-t / 0.008)
            let sample = Int16(max(-1, min(1, 0.55 * attack * body)) * Double(Int16.max))
            withUnsafeBytes(of: sample.littleEndian) { pcm.append(contentsOf: $0) }
        }
        var out = Data()
        func put(_ s: String) { out.append(contentsOf: Array(s.utf8)) }
        func put32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
        func put16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
        put("RIFF"); put32(UInt32(36 + pcm.count)); put("WAVE")
        put("fmt "); put32(16); put16(1); put16(1); put32(UInt32(sampleRate)); put32(UInt32(sampleRate * 2)); put16(2); put16(16)
        put("data"); put32(UInt32(pcm.count))
        out.append(pcm)
        return out
    }()
}
