//
//  AppDelegate.swift
//  Keepsake
//
//  Created by Harrison Fischberg on 10/16/26.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        // The icon chosen in the window, in the Dock (the bundle keeps Pantry Pop).
        if AppIcon.current != .pantry { AppIcon.current.apply() }
        #if DEBUG
        // Screenshots: -appearance light|dark, whatever the Mac is set to.
        if let look = UserDefaults.standard.string(forKey: "appearance") {
            NSApplication.shared.appearance = NSAppearance(named: look == "dark" ? .darkAqua : .aqua)
        }
        #endif
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

}
