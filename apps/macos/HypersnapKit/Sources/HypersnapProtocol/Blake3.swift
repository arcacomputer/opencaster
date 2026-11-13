// BLAKE3 — pure Swift port of the reference implementation.
// Supports the unkeyed hash mode with arbitrary output length (XOF).
// Verified against the node-approved keyadd-golden.json vectors.
import Foundation

public enum Blake3 {
    static let blockLen = 64
    static let chunkLen = 1024
    public static let outLen = 32
    static let keyLen = 32

    static let chunkStart: UInt8 = 1 << 0
    static let chunkEnd: UInt8 = 1 << 1
    static let parent: UInt8 = 1 << 2
    static let root: UInt8 = 1 << 3
    static let keyedHash: UInt8 = 1 << 4
    static let deriveKeyContext: UInt8 = 1 << 5
    static let deriveKeyMaterial: UInt8 = 1 << 6

    static let iv: [UInt32] = [
        0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
        0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
    ]

    static let msgPermutation: [Int] = [
        2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8,
    ]

    @inline(__always) static func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 {
        (x >> n) | (x << (32 - n))
    }

    @inline(__always) static func g(_ state: inout [UInt32], _ a: Int, _ b: Int, _ c: Int, _ d: Int, _ mx: UInt32, _ my: UInt32) {
        state[a] = state[a] &+ state[b] &+ mx
        state[d] = rotr(state[d] ^ state[a], 16)
        state[c] = state[c] &+ state[d]
        state[b] = rotr(state[b] ^ state[c], 12)
        state[a] = state[a] &+ state[b] &+ my
        state[d] = rotr(state[d] ^ state[a], 8)
        state[c] = state[c] &+ state[d]
        state[b] = rotr(state[b] ^ state[c], 7)
    }

    @inline(__always) static func round(_ state: inout [UInt32], _ m: [UInt32]) {
        g(&state, 0, 4, 8, 12, m[0], m[1])
        g(&state, 1, 5, 9, 13, m[2], m[3])
        g(&state, 2, 6, 10, 14, m[4], m[5])
        g(&state, 3, 7, 11, 15, m[6], m[7])
        g(&state, 0, 5, 10, 15, m[8], m[9])
        g(&state, 1, 6, 11, 12, m[10], m[11])
        g(&state, 2, 7, 8, 13, m[12], m[13])
        g(&state, 3, 4, 9, 14, m[14], m[15])
    }

    static func permute(_ m: [UInt32]) -> [UInt32] {
        var out = [UInt32](repeating: 0, count: 16)
        for i in 0..<16 { out[i] = m[msgPermutation[i]] }
        return out
    }

    /// The compression function. Returns 16 words.
    static func compress(cv: [UInt32], block: [UInt32], counter: UInt64, blockLen: UInt32, flags: UInt8) -> [UInt32] {
        var state = [UInt32](repeating: 0, count: 16)
        for i in 0..<8 { state[i] = cv[i] }
        state[8] = iv[0]
        state[9] = iv[1]
        state[10] = iv[2]
        state[11] = iv[3]
        state[12] = UInt32(truncatingIfNeeded: counter)
        state[13] = UInt32(truncatingIfNeeded: counter >> 32)
        state[14] = blockLen
        state[15] = UInt32(flags)

        var m = block
        for r in 0..<7 {
            round(&state, m)
            if r < 6 { m = permute(m) }
        }
        var out = [UInt32](repeating: 0, count: 16)
        for i in 0..<8 {
            out[i] = state[i] ^ state[i + 8]
            out[i + 8] = state[i + 8] ^ cv[i]
        }
        return out
    }

    static func wordsFromLittleEndianBytes(_ bytes: [UInt8]) -> [UInt32] {
        var words = [UInt32](repeating: 0, count: 16)
        for i in 0..<16 {
            var w: UInt32 = 0
            for b in 0..<4 {
                let idx = i * 4 + b
                if idx < bytes.count { w |= UInt32(bytes[idx]) << (8 * b) }
            }
            words[i] = w
        }
        return words
    }

    struct Output {
        var inputCV: [UInt32]   // 8 words
        var blockWords: [UInt32] // 16 words
        var counter: UInt64
        var blockLen: UInt32
        var flags: UInt8

        func chainingValue() -> [UInt32] {
            Array(Blake3.compress(cv: inputCV, block: blockWords, counter: counter, blockLen: blockLen, flags: flags).prefix(8))
        }

        /// Root output bytes: seek = byte offset into the XOF stream.
        func rootBytes(seek: UInt64, count: Int) -> [UInt8] {
            var out = [UInt8]()
            out.reserveCapacity(count)
            var blockCounter = seek / UInt64(Blake3.blockLen)
            var offsetInBlock = Int(seek % UInt64(Blake3.blockLen))
            while out.count < count {
                let words = Blake3.compress(cv: inputCV, block: blockWords, counter: blockCounter, blockLen: blockLen, flags: flags | Blake3.root)
                var block = [UInt8](repeating: 0, count: Blake3.blockLen)
                for i in 0..<16 {
                    var w = words[i]
                    for b in 0..<4 {
                        block[i * 4 + b] = UInt8(w & 0xff)
                        w >>= 8
                    }
                }
                for b in block[offsetInBlock..<Blake3.blockLen] {
                    if out.count >= count { break }
                    out.append(b)
                }
                offsetInBlock = 0
                blockCounter += 1
            }
            return out
        }
    }

    struct ChunkState {
        var cv: [UInt32]       // 8 words
        var chunkCounter: UInt64
        var buf = [UInt8](repeating: 0, count: Blake3.blockLen)
        var bufLen = 0
        var blocksCompressed = 0
        var flags: UInt8

        var length: Int { blocksCompressed * Blake3.blockLen + bufLen }

        func startFlag() -> UInt8 { blocksCompressed == 0 ? Blake3.chunkStart : 0 }

        mutating func update(_ input: ArraySlice<UInt8>) -> ArraySlice<UInt8> {
            var rest = input
            while !rest.isEmpty {
                if bufLen == Blake3.blockLen {
                    let out = Output(
                        inputCV: cv, blockWords: Blake3.wordsFromLittleEndianBytes(buf),
                        counter: chunkCounter, blockLen: UInt32(Blake3.blockLen), flags: flags | startFlag()
                    )
                    cv = out.chainingValue()
                    blocksCompressed += 1
                    buf = [UInt8](repeating: 0, count: Blake3.blockLen)
                    bufLen = 0
                }
                let want = Blake3.blockLen - bufLen
                let take = min(want, rest.count)
                buf.replaceSubrange(bufLen..<(bufLen + take), with: rest.prefix(take))
                bufLen += take
                rest = rest.dropFirst(take)
            }
            return rest
        }

        func output() -> Output {
            Output(
                inputCV: cv,
                blockWords: Blake3.wordsFromLittleEndianBytes(Array(buf.prefix(bufLen))),
                counter: chunkCounter,
                blockLen: UInt32(bufLen),
                flags: flags | startFlag() | Blake3.chunkEnd
            )
        }
    }

    /// One-shot hash with `outLen`-byte output. Matches noble `blake3(data, {dkLen})`.
    public static func hash(_ input: [UInt8], outLen: Int = outLen) -> [UInt8] {
        var h = Hasher()
        h.update(input)
        return h.rootBytes(seek: 0, count: outLen)
    }

    /// 20-byte truncated BLAKE3 — Hypersnap's blake3_20 message hash.
    public static func hash20(_ input: [UInt8]) -> [UInt8] {
        hash(input, outLen: 20)
    }

    struct Hasher {
        var chunk: ChunkState
        var key: [UInt32] // 8 words — the IV for unkeyed hashing
        var cvStack: [[UInt8]] = [] // each 32 bytes
        var flags: UInt8

        /// Unkeyed hasher: key = IV.
        init(flags: UInt8 = 0) {
            self.key = Blake3.iv
            self.flags = flags
            self.chunk = ChunkState(cv: Blake3.iv, chunkCounter: 0, flags: flags)
        }

        static func cvBytes(_ words: [UInt32]) -> [UInt8] {
            var out = [UInt8](repeating: 0, count: Blake3.outLen)
            for i in 0..<8 {
                var w = words[i]
                for b in 0..<4 {
                    out[i * 4 + b] = UInt8(w & 0xff)
                    w >>= 8
                }
            }
            return out
        }

        func parentCV(left: [UInt8], right: [UInt8]) -> [UInt8] {
            let blockWords = Blake3.wordsFromLittleEndianBytes(left + right)
            let out = Blake3.compress(cv: key, block: blockWords, counter: 0, blockLen: UInt32(Blake3.blockLen), flags: flags | Blake3.parent)
            return Blake3.Hasher.cvBytes(Array(out.prefix(8)))
        }

        mutating func addChunkCV(_ newCVIn: [UInt8], totalChunksIn: UInt64) {
            var newCV = newCVIn
            var totalChunks = totalChunksIn
            while totalChunks & 1 == 0 {
                let left = cvStack.removeLast()
                newCV = parentCV(left: left, right: newCV)
                totalChunks >>= 1
            }
            cvStack.append(newCV)
        }

        mutating func update(_ input: [UInt8]) {
            var rest = input[...]
            while !rest.isEmpty {
                if chunk.length == Blake3.chunkLen {
                    let chunkCV = chunk.output().chainingValue()
                    let totalChunks = chunk.chunkCounter + 1
                    addChunkCV(Blake3.Hasher.cvBytes(chunkCV), totalChunksIn: totalChunks)
                    chunk = ChunkState(cv: key, chunkCounter: totalChunks, flags: flags)
                }
                let want = Blake3.chunkLen - chunk.length
                let take = min(want, rest.count)
                _ = chunk.update(rest.prefix(take))
                rest = rest.dropFirst(take)
            }
        }

        func rootBytes(seek: UInt64, count: Int) -> [UInt8] {
            var output = chunk.output()
            var parents = cvStack.count
            while parents > 0 {
                parents -= 1
                let left = cvStack[parents]
                let right = Blake3.Hasher.cvBytes(output.chainingValue())
                output = Output(
                    inputCV: key,
                    blockWords: Blake3.wordsFromLittleEndianBytes(left + right),
                    counter: 0,
                    blockLen: UInt32(Blake3.blockLen),
                    flags: flags | Blake3.parent
                )
            }
            return output.rootBytes(seek: seek, count: count)
        }
    }
}
