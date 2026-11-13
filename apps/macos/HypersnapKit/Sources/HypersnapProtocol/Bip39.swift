// BIP-39 mnemonic validation + seed derivation (PBKDF2-HMAC-SHA512, 2048 rounds).
// The custody phrase is handled in memory only and wiped after key derivation.
import CryptoKit
import Foundation

public enum MnemonicError: Error, Equatable {
    case wordlistUnavailable
    case invalidWordCount(Int)
    case unknownWord(String)
    case invalidChecksum
}

extension MnemonicError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .wordlistUnavailable:
            return "The English wordlist could not be loaded."
        case .invalidWordCount(let count):
            return "Enter a valid 24-word English recovery phrase (\(count) words entered)."
        case .unknownWord(let word):
            return "“\(word)” is not in the English recovery wordlist. Check its spelling and word order."
        case .invalidChecksum:
            return "Enter a valid 24-word English recovery phrase. Check its spelling and word order."
        }
    }
}

public enum Bip39 {
    public static func wordlist() throws -> [String] {
        guard let url = Bundle.module.url(forResource: "bip39-english", withExtension: "txt"),
              let data = try? String(contentsOf: url, encoding: .utf8) else {
            throw MnemonicError.wordlistUnavailable
        }
        let words = data.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
        guard words.count == 2048 else { throw MnemonicError.wordlistUnavailable }
        return words
    }

    /// Normalize like the TS signer: NFKD, trim, lowercase, collapse whitespace.
    public static func normalize(_ phrase: String) -> String {
        phrase.decomposedStringWithCompatibilityMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    /// Validate a normalized phrase: allowed word counts, all-English words, checksum.
    public static func validate(normalized: String, requiredWords: Int = 24) throws {
        let words = normalized.split(separator: " ").map(String.init)
        guard words.count == requiredWords else { throw MnemonicError.invalidWordCount(words.count) }
        let list = try wordlist()
        let index = Dictionary(uniqueKeysWithValues: list.enumerated().map { ($1, $0) })
        var bits = ""
        bits.reserveCapacity(words.count * 11)
        for word in words {
            guard let i = index[word] else { throw MnemonicError.unknownWord(word) }
            bits += String(i, radix: 2).leftPadded(to: 11)
        }
        // 24 words → 264 bits = 256 entropy + 8 checksum.
        let entropyBits = words.count * 11 * 32 / 33
        let checksumBits = words.count * 11 - entropyBits
        var entropy = [UInt8](repeating: 0, count: entropyBits / 8)
        for i in 0..<entropyBits {
            if bits[bits.index(bits.startIndex, offsetBy: i)] == "1" {
                entropy[i / 8] |= UInt8(1 << (7 - (i % 8)))
            }
        }
        let checksum = Array(SHA256.hash(data: entropy))
        let expected = checksum[0] >> (8 - checksumBits)
        var actual: UInt8 = 0
        for i in 0..<checksumBits {
            if bits[bits.index(bits.startIndex, offsetBy: entropyBits + i)] == "1" {
                actual |= UInt8(1 << (checksumBits - 1 - i))
            }
        }
        guard expected == actual else { throw MnemonicError.invalidChecksum }
    }

    /// BIP-39 seed: PBKDF2-HMAC-SHA512(mnemonic, "mnemonic" + passphrase, 2048, 64B).
    public static func seed(normalized: String, passphrase: String = "") -> [UInt8] {
        let password = Array(normalized.utf8)
        let salt = Array(("mnemonic" + passphrase).utf8)
        // PBKDF2 with dkLen == hLen(64): DK = T1 = U_2048.
        var block1 = salt
        block1.append(contentsOf: [0, 0, 0, 1])
        var u = Array(HMAC<SHA512>.authenticationCode(for: block1, using: SymmetricKey(data: password)))
        var result = u
        for _ in 1..<2048 {
            u = Array(HMAC<SHA512>.authenticationCode(for: u, using: SymmetricKey(data: password)))
            for i in 0..<64 { result[i] ^= u[i] }
        }
        return result
    }
}

private extension String {
    func leftPadded(to length: Int) -> String {
        count >= length ? self : String(repeating: "0", count: length - count) + self
    }
}
