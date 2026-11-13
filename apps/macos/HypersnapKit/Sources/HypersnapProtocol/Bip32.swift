// BIP-32 HD private derivation — the custody path m/44'/60'/0'/0/0.
import CryptoKit
import Foundation

public enum Bip32Error: Error {
    case invalidSeed
    case invalidPath(String)
    case derivationFailed
}

public struct HDNode {
    public let privateKey: [UInt8] // 32 bytes
    public let chainCode: [UInt8]  // 32 bytes

    public static func master(seed: [UInt8], secp: Secp256k1) throws -> HDNode {
        let i = Array(HMAC<SHA512>.authenticationCode(for: seed, using: SymmetricKey(data: Array("Bitcoin seed".utf8))))
        let priv = Array(i[0..<32])
        guard secp.verifyPrivateKey(priv) else { throw Bip32Error.invalidSeed }
        return HDNode(privateKey: priv, chainCode: Array(i[32..<64]))
    }

    public func child(index: UInt32, secp: Secp256k1) throws -> HDNode {
        var data = [UInt8]()
        if index >= 0x8000_0000 {
            data.append(0)
            data.append(contentsOf: privateKey)
        } else {
            data.append(contentsOf: try secp.publicKeyCompressed(privateKey: privateKey))
        }
        data.append(UInt8(index >> 24))
        data.append(UInt8((index >> 16) & 0xff))
        data.append(UInt8((index >> 8) & 0xff))
        data.append(UInt8(index & 0xff))
        let i = Array(HMAC<SHA512>.authenticationCode(for: data, using: SymmetricKey(data: chainCode)))
        guard let priv = secp.privateKeyTweakAdd(privateKey: privateKey, tweak: Array(i[0..<32])),
              secp.verifyPrivateKey(priv) else { throw Bip32Error.derivationFailed }
        return HDNode(privateKey: priv, chainCode: Array(i[32..<64]))
    }

    /// Derive along a path like "m/44'/60'/0'/0/0".
    public func derive(path: String, secp: Secp256k1) throws -> HDNode {
        var node = self
        let segments = path.split(separator: "/").map(String.init)
        for (i, segment) in segments.enumerated() {
            if i == 0 {
                guard segment == "m" || segment == "M" else { throw Bip32Error.invalidPath(path) }
                continue
            }
            let hardened = segment.hasSuffix("'") || segment.hasSuffix("h") || segment.hasSuffix("H")
            let numberPart = hardened ? String(segment.dropLast()) : segment
            guard let index = UInt32(numberPart), index < 0x8000_0000 else { throw Bip32Error.invalidPath(path) }
            node = try node.child(index: index + (hardened ? 0x8000_0000 : 0), secp: secp)
        }
        return node
    }
}
