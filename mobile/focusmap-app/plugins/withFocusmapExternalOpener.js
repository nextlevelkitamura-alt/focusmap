const fs = require("fs");
const path = require("path");
const { IOSConfig, withXcodeProject } = require("expo/config-plugins");

const SWIFT_FILE_NAME = "FocusmapExternalOpener.swift";
const OBJC_FILE_NAME = "FocusmapExternalOpener.m";
const BRIDGING_HEADER_FILE_NAME = "Focusmap-Bridging-Header.h";
const BRIDGING_IMPORT = "#import <React/RCTBridgeModule.h>";

const SWIFT_SOURCE = `import Foundation
import UIKit
import Security
import UniformTypeIdentifiers

@objc(FocusmapExternalOpener)
class FocusmapExternalOpener: NSObject {
  private let authSessionService = "com.focusmap.mobile.auth-session"
  private let authSessionAccount = "focusmap-session"

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }

  @objc(openUniversalLink:resolver:rejecter:)
  func openUniversalLink(
    urlString: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: urlString) else {
      reject("invalid_url", "Invalid URL", nil)
      return
    }

    DispatchQueue.main.async {
      UIApplication.shared.open(url, options: [.universalLinksOnly: true]) { success in
        if success {
          resolve(true)
        } else {
          reject("universal_link_unavailable", "Universal link was not handled by an installed app", nil)
        }
      }
    }
  }

  @objc(saveAuthSession:resolver:rejecter:)
  func saveAuthSession(
    session: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard JSONSerialization.isValidJSONObject(session) else {
      reject("invalid_session", "Invalid auth session payload", nil)
      return
    }

    do {
      let data = try JSONSerialization.data(withJSONObject: session, options: [])
      try saveAuthSessionData(data)
      resolve(true)
    } catch {
      reject("save_failed", "Failed to save auth session", error)
    }
  }

  @objc(loadAuthSession:rejecter:)
  func loadAuthSession(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let data = loadAuthSessionData() else {
      resolve(nil)
      return
    }

    do {
      let object = try JSONSerialization.jsonObject(with: data, options: [])
      guard let session = object as? [String: Any] else {
        resolve(nil)
        return
      }
      resolve(session)
    } catch {
      reject("load_failed", "Failed to load auth session", error)
    }
  }

  @objc(clearAuthSession:rejecter:)
  func clearAuthSession(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      try clearAuthSessionData()
      resolve(true)
    } catch {
      reject("clear_failed", "Failed to clear auth session", error)
    }
  }

  @objc(copyCodexHandoff:imageUrl:resolver:rejecter:)
  func copyCodexHandoff(
    text: String,
    imageUrl: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let normalizedText = text
      .replacingOccurrences(of: "\\r\\n", with: "\\n")
      .replacingOccurrences(of: "\\r", with: "\\n")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    if normalizedText.isEmpty {
      resolve(false)
      return
    }

    loadClipboardImageData(imageUrl) { imageData in
      DispatchQueue.main.async {
        var item: [String: Any] = [
          UTType.plainText.identifier: normalizedText,
          UTType.utf8PlainText.identifier: normalizedText
        ]
        if let imageData {
          item[UTType.png.identifier] = imageData
        }
        UIPasteboard.general.items = [item]
        resolve(true)
      }
    }
  }

  @objc(copyCodexImage:resolver:rejecter:)
  func copyCodexImage(
    imageUrl: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    loadClipboardImageData(imageUrl) { imageData in
      DispatchQueue.main.async {
        guard let imageData else {
          resolve(false)
          return
        }
        UIPasteboard.general.items = [[UTType.png.identifier: imageData]]
        resolve(true)
      }
    }
  }

  private func loadClipboardImageData(_ value: String?, completion: @escaping (Data?) -> Void) {
    guard let rawValue = value?.trimmingCharacters(in: .whitespacesAndNewlines), !rawValue.isEmpty else {
      completion(nil)
      return
    }

    if rawValue.hasPrefix("data:image/"), let commaIndex = rawValue.firstIndex(of: ",") {
      let encoded = String(rawValue[rawValue.index(after: commaIndex)...])
      guard let data = Data(base64Encoded: encoded), let image = UIImage(data: data) else {
        completion(nil)
        return
      }
      completion(image.pngData())
      return
    }

    guard let url = URL(string: rawValue), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
      completion(nil)
      return
    }

    URLSession.shared.dataTask(with: url) { data, response, _ in
      guard
        let data,
        data.count <= 12 * 1024 * 1024,
        let httpResponse = response as? HTTPURLResponse,
        (200..<300).contains(httpResponse.statusCode),
        let image = UIImage(data: data)
      else {
        completion(nil)
        return
      }
      completion(image.pngData())
    }.resume()
  }

  private func authSessionKeychainQuery() -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: authSessionService,
      kSecAttrAccount as String: authSessionAccount
    ]
  }

  private func saveAuthSessionData(_ data: Data) throws {
    let query = authSessionKeychainQuery()
    SecItemDelete(query as CFDictionary)

    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

    let status = SecItemAdd(item as CFDictionary, nil)
    if status != errSecSuccess {
      throw NSError(
        domain: "FocusmapExternalOpener",
        code: Int(status),
        userInfo: [NSLocalizedDescriptionKey: "Keychain save failed: \\(status)"]
      )
    }
  }

  private func loadAuthSessionData() -> Data? {
    var query = authSessionKeychainQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess else { return nil }
    return result as? Data
  }

  private func clearAuthSessionData() throws {
    let status = SecItemDelete(authSessionKeychainQuery() as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound {
      throw NSError(
        domain: "FocusmapExternalOpener",
        code: Int(status),
        userInfo: [NSLocalizedDescriptionKey: "Keychain delete failed: \\(status)"]
      )
    }
  }
}
`;

const OBJC_SOURCE = `${BRIDGING_IMPORT}

@interface RCT_EXTERN_MODULE(FocusmapExternalOpener, NSObject)

RCT_EXTERN_METHOD(openUniversalLink:(NSString *)urlString
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(copyCodexHandoff:(NSString *)text
                  imageUrl:(NSString *)imageUrl
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(copyCodexImage:(NSString *)imageUrl
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(saveAuthSession:(NSDictionary *)session
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(loadAuthSession:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearAuthSession:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
`;

function ensureContainsLine(filePath, line) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (existing.includes(line)) return;

  const next = existing.trim()
    ? `${existing.trimEnd()}\n${line}\n`
    : `//\n// Use this file to import your target's public headers that you would like to expose to Swift.\n//\n${line}\n`;
  fs.writeFileSync(filePath, next);
}

function ensureSourceFile(project, projectName, fileName) {
  const projectRelativePath = path.join(projectName, fileName);
  if (project.hasFile(projectRelativePath)) return;

  IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
    filepath: projectRelativePath,
    groupName: projectName,
    project,
  });
}

function ensureSwiftBuildSettings(project, projectName) {
  const buildConfigurations = project.pbxXCBuildConfigurationSection();
  const bridgingHeaderPath = `${projectName}/${BRIDGING_HEADER_FILE_NAME}`;
  const infoPlistPath = `${projectName}/Info.plist`;

  for (const [key, config] of Object.entries(buildConfigurations)) {
    if (key.endsWith("_comment") || !config.buildSettings) continue;
    if (config.buildSettings.INFOPLIST_FILE !== infoPlistPath) continue;

    config.buildSettings.SWIFT_OBJC_BRIDGING_HEADER = `"${bridgingHeaderPath}"`;
    config.buildSettings.SWIFT_VERSION = config.buildSettings.SWIFT_VERSION || "5.0";
  }
}

function withFocusmapExternalOpener(config) {
  return withXcodeProject(config, config => {
    const projectName = config.modRequest.projectName;
    const iosRoot = config.modRequest.platformProjectRoot;
    const sourceRoot = path.join(iosRoot, projectName);

    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, SWIFT_FILE_NAME), SWIFT_SOURCE);
    fs.writeFileSync(path.join(sourceRoot, OBJC_FILE_NAME), OBJC_SOURCE);
    ensureContainsLine(path.join(sourceRoot, BRIDGING_HEADER_FILE_NAME), BRIDGING_IMPORT);

    ensureSourceFile(config.modResults, projectName, SWIFT_FILE_NAME);
    ensureSourceFile(config.modResults, projectName, OBJC_FILE_NAME);
    ensureSwiftBuildSettings(config.modResults, projectName);

    return config;
  });
}

module.exports = withFocusmapExternalOpener;
