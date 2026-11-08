# App-specific values for release.sh, fastlane and the screenshot scripts. Safe to commit: no secrets here.
# Secrets (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH) come from ~/.zshrc, never from this file.
APP_NAME="Internet Binder"            # shown on framed screenshots
BUNDLE_ID="com.harrisonfischberg.keepsake"
TEAM_ID="KTV2G3Z883"
SCHEME="Keepsake"                     # shared scheme (ios/tools/make-xcodeproj.py writes it)
XCODE_PROJECT="ios/Keepsake.xcodeproj"
XCODE_WORKSPACE=""
SCREENSHOT_TEST="KeepsakeUITests/AppStoreScreenshotsUITests"  # -only-testing target for store-screenshots.sh
SCREENSHOT_SIMULATOR="Pro Max"        # iPhone 6.9-inch: first available simulator whose name contains this
SCREENSHOT_IPAD="iPad Pro 13"         # iPad 13-inch (the app is universal, so the store needs iPad shots too)
