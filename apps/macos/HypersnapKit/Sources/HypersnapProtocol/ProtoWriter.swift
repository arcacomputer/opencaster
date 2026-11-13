// Port of packages/protocol/src/protoWire.ts (MIT-licensed quorum-shared origin).
import Foundation

/// Minimal proto3 wire-format writer for the Farcaster Message/MessageData/body
/// shapes used here. Wire types: 0 = varint, 2 = length-delimited.
public struct ProtoWriter {
    private var buffer = [UInt8]()

    public init() {}

    public func bytes() -> [UInt8] { buffer }

    mutating func push(_ chunk: [UInt8]) {
        buffer.append(contentsOf: chunk)
    }

    mutating func varint(_ value: UInt64) {
        var v = value
        while v >= 0x80 {
            buffer.append(UInt8(v & 0x7f) | 0x80)
            v >>= 7
        }
        buffer.append(UInt8(v))
    }

    /// proto3 int32: negative values extend to a 10-byte varint (two's complement).
    /// Our uses (scopes, enums) are always non-negative.
    mutating func int32(_ value: Int32) {
        if value < 0 {
            varint(UInt64(bitPattern: Int64(value)))
        } else {
            varint(UInt64(value))
        }
    }

    mutating func tag(_ field: Int, _ wireType: Int) {
        varint(UInt64(field << 3 | wireType))
    }

    mutating func writeVarintField(_ field: Int, _ value: UInt64) {
        tag(field, 0)
        varint(value)
    }

    mutating func writeInt32Field(_ field: Int, _ value: Int32) {
        tag(field, 0)
        int32(value)
    }

    mutating func writeBytesField(_ field: Int, _ value: [UInt8]) {
        tag(field, 2)
        varint(UInt64(value.count))
        push(value)
    }

    mutating func writeStringField(_ field: Int, _ value: String) {
        if value.isEmpty { return } // proto3 default
        writeBytesField(field, Array(value.utf8))
    }

    mutating func writeSubMessage(_ field: Int, _ payload: [UInt8]) {
        tag(field, 2)
        varint(UInt64(payload.count))
        push(payload)
    }

    mutating func writePackedVarint(_ field: Int, _ values: [UInt64]) {
        if values.isEmpty { return }
        var inner = ProtoWriter()
        for v in values { inner.varint(v) }
        let packed = inner.bytes()
        tag(field, 2)
        varint(UInt64(packed.count))
        push(packed)
    }

    mutating func writePackedInt32(_ field: Int, _ values: [Int32]) {
        if values.isEmpty { return }
        var inner = ProtoWriter()
        for v in values { inner.int32(v) }
        let packed = inner.bytes()
        tag(field, 2)
        varint(UInt64(packed.count))
        push(packed)
    }
}
