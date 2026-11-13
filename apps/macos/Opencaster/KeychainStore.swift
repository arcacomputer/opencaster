// Generic-password Keychain storage for the persisted session record.
// Items are ThisDeviceOnly and non-syncable: the custody key and device
// signer seed must never leave this Mac or appear in iCloud Keychain.
import Foundation
import Security

enum KeychainError: Error, LocalizedError {
    case unexpectedStatus(OSStatus)
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .unexpectedStatus(let status):
            return "Keychain operation failed (\(status)): \(SecCopyErrorMessageString(status, nil) as String? ?? "unknown")"
        case .encodingFailed:
            return "Could not encode the session record."
        }
    }
}

struct KeychainStore {
    static let service = "com.arcacomputer.opencaster.session"

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "default",
        ]
    }

    static func save(_ record: SessionRecord) throws {
        guard let data = try? JSONEncoder().encode(record) else { throw KeychainError.encodingFailed }
        var attributes = query()
        attributes[kSecValueData as String] = data
        // Unlocked-device only, never synced, never migrated to another Mac.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        attributes[kSecAttrSynchronizable as String] = false
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let update = [kSecValueData as String: data]
            let updateStatus = SecItemUpdate(query() as CFDictionary, update as CFDictionary)
            guard updateStatus == errSecSuccess else { throw KeychainError.unexpectedStatus(updateStatus) }
        } else if status != errSecSuccess {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    static func load() throws -> SessionRecord? {
        var attributes = query()
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.unexpectedStatus(status)
        }
        return try JSONDecoder().decode(SessionRecord.self, from: data)
    }

    static func delete() throws {
        let status = SecItemDelete(query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}
