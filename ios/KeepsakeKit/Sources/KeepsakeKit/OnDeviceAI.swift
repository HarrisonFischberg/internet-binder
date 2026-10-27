import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Apple Intelligence on this device: the first reader for every AI task (src/ai/provider.js onDeviceFirst,
/// reached through __native.appleAI in CoreEngine). Nothing it reads leaves the device; your provider and
/// key are only asked when it isn't here or can't help. No setting turns it on: it is used whenever the
/// system says the model is ready.
public enum OnDeviceAI {
    public enum Status: String, Sendable {
        /// The model is on this device and ready.
        case ready
        /// This device could run it, but Apple Intelligence is off in the Settings app.
        case off
        /// Apple Intelligence is on and its model is still downloading.
        case preparing
        /// This device can't run Apple Intelligence.
        case unsupported
    }

    public static var status: Status {
        #if DEBUG
        // UI tests and screenshots: -ks.appleAIStatus ready|off|preparing|unsupported
        if let forced = UserDefaults.standard.string(forKey: "ks.appleAIStatus"), let s = Status(rawValue: forced) { return s }
        #endif
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return .ready
            case .unavailable(.appleIntelligenceNotEnabled): return .off
            case .unavailable(.modelNotReady): return .preparing
            case .unavailable: return .unsupported
            }
        }
        #endif
        return .unsupported
    }

    /// Low Power Mode is on or the phone is hot: what runs by itself waits for a later open (you can still ask).
    public static var resting: Bool {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "ks.appleAIResting") { return true }
        #endif
        let info = ProcessInfo.processInfo
        return info.isLowPowerModeEnabled || info.thermalState == .serious || info.thermalState == .critical
    }

    public struct Failure: Error, LocalizedError {
        public let message: String
        public var errorDescription: String? { message }
    }

    /// One answer to one task. A new session each time, so one save never sees another's text.
    public static func respond(system: String, prompt: String, maxTokens: Int) async throws -> String {
        guard status == .ready else { throw Failure(message: "Apple Intelligence isn't ready on this device.") }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            do {
                let session = LanguageModelSession(instructions: system)
                let options = GenerationOptions(temperature: 0.2, maximumResponseTokens: max(64, maxTokens))
                return try await session.respond(to: prompt, options: options).content
            } catch {
                throw Failure(message: "Apple Intelligence couldn't answer: \(error.localizedDescription)")
            }
        }
        #endif
        throw Failure(message: "Apple Intelligence isn't available on this device.")
    }
}
