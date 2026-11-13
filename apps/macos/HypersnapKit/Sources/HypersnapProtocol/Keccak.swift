// Keccak-256 (legacy Keccak padding 0x01, not SHA3-256's 0x06).
// Compact implementation in the tiny_sha3 style; verified against EIP-712 golden vectors.
import Foundation

public enum Keccak {
    private static let rate = 136 // bytes, for 256-bit output (1088-bit rate)

    private static let rotc: [Int] = [
        1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
        27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
    ]
    private static let piln: [Int] = [
        10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
        15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
    ]
    private static let roundConstants: [UInt64] = [
        0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
        0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
        0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
        0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
        0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
        0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
    ]

    private static func keccakF(_ st: inout [UInt64]) {
        var bc = [UInt64](repeating: 0, count: 5)
        for round in 0..<24 {
            // Theta
            for i in 0..<5 {
                bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20]
            }
            for i in 0..<5 {
                let t = bc[(i + 4) % 5] ^ bc[(i + 1) % 5].rotatedLeft(1)
                for j in stride(from: 0, through: 24, by: 5) {
                    st[j + i] ^= t
                }
            }
            // Rho + Pi
            var t = st[1]
            for i in 0..<24 {
                let j = piln[i]
                let tmp = st[j]
                st[j] = t.rotatedLeft(rotc[i])
                t = tmp
            }
            // Chi
            for j in stride(from: 0, through: 24, by: 5) {
                for i in 0..<5 { bc[i] = st[j + i] }
                for i in 0..<5 {
                    st[j + i] = bc[i] ^ ((~bc[(i + 1) % 5]) & bc[(i + 2) % 5])
                }
            }
            // Iota
            st[0] ^= roundConstants[round]
        }
    }

    /// Keccak-256 digest of `input` (32 bytes).
    public static func keccak256(_ input: [UInt8]) -> [UInt8] {
        var st = [UInt64](repeating: 0, count: 25)
        var offset = 0

        // Absorb full rate blocks.
        while input.count - offset >= rate {
            for i in 0..<(rate / 8) {
                var lane: UInt64 = 0
                for b in 0..<8 {
                    lane |= UInt64(input[offset + i * 8 + b]) << (8 * b)
                }
                st[i] ^= lane
            }
            keccakF(&st)
            offset += rate
        }

        // Final block with pad10*1 (domain 0x01).
        var block = [UInt8](repeating: 0, count: rate)
        let remaining = input.count - offset
        if remaining > 0 {
            block.replaceSubrange(0..<remaining, with: input[offset..<input.count])
        }
        block[remaining] ^= 0x01
        block[rate - 1] ^= 0x80
        for i in 0..<(rate / 8) {
            var lane: UInt64 = 0
            for b in 0..<8 {
                lane |= UInt64(block[i * 8 + b]) << (8 * b)
            }
            st[i] ^= lane
        }
        keccakF(&st)

        // Squeeze 32 bytes little-endian.
        var out = [UInt8](repeating: 0, count: 32)
        for i in 0..<4 {
            var lane = st[i]
            for b in 0..<8 {
                out[i * 8 + b] = UInt8(lane & 0xff)
                lane >>= 8
            }
        }
        return out
    }

    public static func keccak256(_ string: String) -> [UInt8] {
        keccak256(Array(string.utf8))
    }
}

extension UInt64 {
    @inline(__always) func rotatedLeft(_ n: Int) -> UInt64 {
        (self << n) | (self >> (64 - n))
    }
}
