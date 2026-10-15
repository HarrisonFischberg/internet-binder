#!/usr/bin/env python3
"""Writes ios/Keepsake.xcodeproj/project.pbxproj.

The project is generated (no XcodeGen/Tuist installed; see replica/m3/decisions.md D2). Targets use
folder-synchronized groups, so adding a Swift file needs no change here. Edit this script to change
targets or build settings, then run: python3 ios/tools/make-xcodeproj.py
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'Keepsake.xcodeproj', 'project.pbxproj')

T = {  # target key: (name, product, productType, folder, bundle id, extra settings)
 'app':   ('Keepsake', 'Keepsake.app', 'com.apple.product-type.application', 'App', 'com.harrisonfischberg.keepsake',
           {'INFOPLIST_FILE': 'Config/App-Info.plist', 'INFOPLIST_KEY_CFBundleDisplayName': 'Keepsake', 'INFOPLIST_KEY_UILaunchScreen_Generation': 'YES',
            'INFOPLIST_KEY_UIApplicationSceneManifest_Generation': 'YES',
            'INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone': '"UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"',
            'INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad': '"UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"',
            'CODE_SIGN_ENTITLEMENTS': 'Config/Keepsake.entitlements', 'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon',
            'ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES': '"AppIconLinen AppIconInk"',
            'LD_RUNPATH_SEARCH_PATHS': '("$(inherited)", "@executable_path/Frameworks")'}),
 'share': ('KeepsakeShare', 'KeepsakeShare.appex', 'com.apple.product-type.app-extension', 'ShareExtension', 'com.harrisonfischberg.keepsake.share',
           {'INFOPLIST_FILE': 'Config/Share-Info.plist', 'INFOPLIST_KEY_CFBundleDisplayName': 'Keepsake', 'CODE_SIGN_ENTITLEMENTS': 'Config/Share.entitlements',
            'APPLICATION_EXTENSION_API_ONLY': 'YES', 'SKIP_INSTALL': 'YES',
            'LD_RUNPATH_SEARCH_PATHS': '("$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks")'}),
 'uitests': ('KeepsakeUITests', 'KeepsakeUITests.xctest', 'com.apple.product-type.bundle.ui-testing', 'UITests', 'com.harrisonfischberg.keepsake.uitests',
           {'TEST_TARGET_NAME': 'Keepsake', 'LD_RUNPATH_SEARCH_PATHS': '("$(inherited)", "@executable_path/Frameworks", "@loader_path/Frameworks")'}),
 'widgets': ('KeepsakeWidgets', 'KeepsakeWidgets.appex', 'com.apple.product-type.app-extension', 'Widgets', 'com.harrisonfischberg.keepsake.widgets',
           {'INFOPLIST_FILE': 'Config/Widgets-Info.plist', 'INFOPLIST_KEY_CFBundleDisplayName': 'Keepsake', 'CODE_SIGN_ENTITLEMENTS': 'Config/Widgets.entitlements',
            'APPLICATION_EXTENSION_API_ONLY': 'YES', 'SKIP_INSTALL': 'YES',
            'LD_RUNPATH_SEARCH_PATHS': '("$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks")'}),
}

n = [0]
def oid():
    n[0] += 1
    return 'BB%022X' % n[0]

# Package products each target links: KeepsakeKit everywhere, the KeepsakeUI look where there are screens.
PRODUCTS = {'app': ['KeepsakeKit', 'KeepsakeUI'], 'share': ['KeepsakeKit', 'KeepsakeUI'], 'widgets': ['KeepsakeKit', 'KeepsakeUI'], 'uitests': []}
ids = {k: {x: oid() for x in ['product', 'group', 'target', 'src', 'fw', 'res', 'cfgs', 'debug', 'release']} for k in T}
for k in T:
    ids[k]['pkgs'] = [(p, oid(), oid()) for p in PRODUCTS[k]]  # (product, dependency id, build file id)
for k in ('share', 'widgets'):
    ids[k].update(embed=oid(), proxy=oid(), dep=oid())
ids['uitests'].update(appproxy=oid(), appdep=oid())
P = dict(project=oid(), main=oid(), products=oid(), pkg=oid(), cfgs=oid(), debug=oid(), release=oid(), embedphase=oid())

o = []
add = o.append
add('// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 77;\n\tobjects = {\n')
for k, (name, prod, ptype, folder, bid, extra) in T.items():
    i = ids[k]
    ftype = 'wrapper.application' if prod.endswith('.app') else 'wrapper.cfbundle' if prod.endswith('.xctest') else '"wrapper.app-extension"'
    add(f'\t\t{i["product"]} /* {prod} */ = {{isa = PBXFileReference; explicitFileType = {ftype}; includeInIndex = 0; path = {prod}; sourceTree = BUILT_PRODUCTS_DIR; }};\n')
    add(f'\t\t{i["group"]} /* {folder} */ = {{isa = PBXFileSystemSynchronizedRootGroup; path = {folder}; sourceTree = "<group>"; }};\n')
    for pname, dep, bf in i['pkgs']:
        add(f'\t\t{dep} /* {pname} */ = {{isa = XCSwiftPackageProductDependency; package = {P["pkg"]}; productName = {pname}; }};\n')
        add(f'\t\t{bf} /* {pname} in Frameworks */ = {{isa = PBXBuildFile; productRef = {dep}; }};\n')
    add(f'\t\t{i["src"]} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; }};\n')
    add(f'\t\t{i["fw"]} = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = ({", ".join(bf for _, _, bf in i["pkgs"])}); runOnlyForDeploymentPostprocessing = 0; }};\n')
    add(f'\t\t{i["res"]} = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; }};\n')
    if k == 'uitests':
        add(f'\t\t{i["appproxy"]} = {{isa = PBXContainerItemProxy; containerPortal = {P["project"]}; proxyType = 1; remoteGlobalIDString = {ids["app"]["target"]}; remoteInfo = Keepsake; }};\n')
        add(f'\t\t{i["appdep"]} = {{isa = PBXTargetDependency; target = {ids["app"]["target"]}; targetProxy = {i["appproxy"]}; }};\n')
    if k in ('share', 'widgets'):
        add(f'\t\t{i["embed"]} /* {prod} in Embed Foundation Extensions */ = {{isa = PBXBuildFile; fileRef = {i["product"]}; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};\n')
        add(f'\t\t{i["proxy"]} = {{isa = PBXContainerItemProxy; containerPortal = {P["project"]}; proxyType = 1; remoteGlobalIDString = {i["target"]}; remoteInfo = {name}; }};\n')
        add(f'\t\t{i["dep"]} = {{isa = PBXTargetDependency; target = {i["target"]}; targetProxy = {i["proxy"]}; }};\n')
    phases = [i['src'], i['fw'], i['res']] + ([P['embedphase']] if k == 'app' else [])
    deps = [ids[x]['dep'] for x in ('share', 'widgets')] if k == 'app' else [i['appdep']] if k == 'uitests' else []
    add(f'\t\t{i["target"]} /* {name} */ = {{isa = PBXNativeTarget; buildConfigurationList = {i["cfgs"]}; buildPhases = ({", ".join(phases)}); buildRules = (); dependencies = ({", ".join(deps)}); fileSystemSynchronizedGroups = ({i["group"]}); name = {name}; packageProductDependencies = ({", ".join(dep for _, dep, _ in i["pkgs"])}); productName = {name}; productReference = {i["product"]}; productType = "{ptype}"; }};\n')
    base = {'CODE_SIGN_STYLE': 'Automatic', 'DEVELOPMENT_TEAM': 'KTV2G3Z883', '"CODE_SIGN_IDENTITY[sdk=iphonesimulator*]"': '"-"',
            'CURRENT_PROJECT_VERSION': '1', 'MARKETING_VERSION': '0.1', 'GENERATE_INFOPLIST_FILE': 'YES',
            'PRODUCT_BUNDLE_IDENTIFIER': bid, 'PRODUCT_NAME': '"$(TARGET_NAME)"', 'SWIFT_VERSION': '5.0', 'TARGETED_DEVICE_FAMILY': '"1,2"',
            'SWIFT_EMIT_LOC_STRINGS': 'YES', 'ENABLE_PREVIEWS': 'YES'}
    base.update(extra)
    s = '; '.join(f'{a} = {b}' for a, b in base.items())
    add(f'\t\t{i["debug"]} /* Debug */ = {{isa = XCBuildConfiguration; buildSettings = {{{s}; }}; name = Debug; }};\n')
    add(f'\t\t{i["release"]} /* Release */ = {{isa = XCBuildConfiguration; buildSettings = {{{s}; }}; name = Release; }};\n')
    add(f'\t\t{i["cfgs"]} = {{isa = XCConfigurationList; buildConfigurations = ({i["debug"]}, {i["release"]}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};\n')

add(f'\t\t{P["embedphase"]} /* Embed Foundation Extensions */ = {{isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = 13; files = ({ids["share"]["embed"]}, {ids["widgets"]["embed"]}); name = "Embed Foundation Extensions"; runOnlyForDeploymentPostprocessing = 0; }};\n')
add(f'\t\t{P["pkg"]} /* KeepsakeKit */ = {{isa = XCLocalSwiftPackageReference; relativePath = KeepsakeKit; }};\n')
add(f'\t\t{P["products"]} /* Products */ = {{isa = PBXGroup; children = ({", ".join(ids[k]["product"] for k in T)}); name = Products; sourceTree = "<group>"; }};\n')
add(f'\t\t{P["main"]} = {{isa = PBXGroup; children = ({", ".join(ids[k]["group"] for k in T)}, {P["products"]}); sourceTree = "<group>"; }};\n')
common = 'ALWAYS_SEARCH_USER_PATHS = NO; CLANG_ENABLE_MODULES = YES; ENABLE_USER_SCRIPT_SANDBOXING = YES; IPHONEOS_DEPLOYMENT_TARGET = 27.0; SDKROOT = iphoneos; SWIFT_STRICT_CONCURRENCY = minimal; LOCALIZATION_PREFERS_STRING_CATALOGS = YES'
add(f'\t\t{P["debug"]} /* Debug */ = {{isa = XCBuildConfiguration; buildSettings = {{{common}; DEBUG_INFORMATION_FORMAT = dwarf; ENABLE_TESTABILITY = YES; GCC_OPTIMIZATION_LEVEL = 0; ONLY_ACTIVE_ARCH = YES; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; }}; name = Debug; }};\n')
add(f'\t\t{P["release"]} /* Release */ = {{isa = XCBuildConfiguration; buildSettings = {{{common}; DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym"; SWIFT_COMPILATION_MODE = wholemodule; VALIDATE_PRODUCT = YES; }}; name = Release; }};\n')
add(f'\t\t{P["cfgs"]} = {{isa = XCConfigurationList; buildConfigurations = ({P["debug"]}, {P["release"]}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};\n')
add(f'\t\t{P["project"]} /* Project object */ = {{isa = PBXProject; attributes = {{BuildIndependentTargetsInParallel = 1; LastSwiftUpdateCheck = 2700; LastUpgradeCheck = 2700; }}; buildConfigurationList = {P["cfgs"]}; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = {P["main"]}; minimizedProjectReferenceProxies = 1; packageReferences = ({P["pkg"]}); preferredProjectObjectVersion = 77; productRefGroup = {P["products"]}; projectDirPath = ""; projectRoot = ""; targets = ({", ".join(ids[k]["target"] for k in T)}); }};\n')
add(f'\t}};\n\trootObject = {P["project"]};\n}}\n')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    f.write(''.join(o))
print(f'wrote {os.path.normpath(OUT)}')
