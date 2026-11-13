// Port of packages/protocol/src byte helpers (MIT-licensed quorum-shared origin).
import Foundation

public enum ByteError: Error, Equatable {
    case oddLengthHex
    case invalidHex(String)
    case negativeUint256
    case invalidAddressLength(Int)
}

public func hexToBytes(_ hex: String) throws -> [UInt8] {
    var stripped = hex.lowercased()
    if stripped.hasPrefix("0x") { stripped.removeFirst(2) }
    if stripped.count % 2 != 0 { throw ByteError.oddLengthHex }
    var out = [UInt8]()
    out.reserveCapacity(stripped.count / 2)
    var i = stripped.startIndex
    while i < stripped.endIndex {
        let j = stripped.index(i, offsetBy: 2)
        guard let b = UInt8(stripped[i..<j], radix: 16) else { throw ByteError.invalidHex(hex) }
        out.append(b)
        i = j
    }
    return out
}

public func bytesToHex(_ bytes: [UInt8]) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
}

public func bytesToHex(_ bytes: Data) -> String { bytesToHex([UInt8](bytes)) }

func concat(_ arrays: [UInt8]...) -> [UInt8] {
    var out = [UInt8]()
    for a in arrays { out.append(contentsOf: a) }
    return out
}

/// Encode a non-negative integer into a 32-byte big-endian word.
func toUint256(_ value: UInt64) -> [UInt8] {
    var out = [UInt8](repeating: 0, count: 32)
    var n = value
    for i in stride(from: 31, through: 0, by: -1) {
        out[i] = UInt8(n & 0xff)
        n >>= 8
    }
    return out
}

/// Encode a 20-byte address into a 32-byte left-padded word.
func addressTo32(_ addressHex: String) throws -> [UInt8] {
    var stripped = addressHex.lowercased()
    if stripped.hasPrefix("0x") { stripped.removeFirst(2) }
    guard stripped.count == 40 else { throw ByteError.invalidAddressLength(stripped.count) }
    let bytes = try hexToBytes(stripped)
    var out = [UInt8](repeating: 0, count: 32)
    out.replaceSubrange(12..<32, with: bytes)
    return out
}
