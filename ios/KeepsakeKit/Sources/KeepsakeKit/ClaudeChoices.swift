import Foundation

/// The Claude models and effort levels Settings offers: the same lists as provider.js MODELS and EFFORTS
/// (a test checks they match the shared code).
public enum ClaudeChoices {
    /// Cheapest first. Haiku 5.5 is the default.
    public static let models: [(id: String, name: String, note: String)] = [
        ("claude-haiku-5-5", "Claude Haiku 5.5", "Fastest and cheapest. Plenty for tidying saves."),
        ("claude-sonnet-5-5", "Claude Sonnet 5.5", "Sharper at reading pictures and pages."),
        ("claude-opus-5-5", "Claude Opus 5.5", "Most careful. Costs more per save."),
        ("claude-fable-5-1", "Claude Fable 5.1", "Most capable, and the most expensive."),
    ]
    /// How hard the model thinks before answering. Medium is the default.
    public static let efforts: [(id: String, name: String)] = [("low", "Low"), ("medium", "Medium"), ("high", "High")]
}
