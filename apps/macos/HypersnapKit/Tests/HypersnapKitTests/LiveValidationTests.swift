// Opt-in live checks against the node's /v1/validateMessage, which validates
// without merging — nothing is published. Run with HYPERSNAP_LIVE=1.
// The signer is a throwaway key that is never registered, so the node is
// expected to get past decoding/hash/signature checks and reject on signer.
import Foundation
import Testing
@testable import HypersnapAPI
@testable import HypersnapProtocol

@Suite("Live validateMessage (dry run)", .enabled(if: ProcessInfo.processInfo.environment["HYPERSNAP_LIVE"] == "1"))
struct LiveValidationTests {
    let client = HypersnapClient()

    private func validate(_ body: MessageBody, type: MessageType) async -> String {
        do {
            let key = try Ed25519Key()
            let message = try buildSignedMessage(type: type, fid: 2, body: body, signer: key)
            let response = try await client.validateMessage(message.envelope)
            return "OK \(response.raw)"
        } catch {
            return "ERR \(error)"
        }
    }

    @Test func dummyCastAdd() async {
        let result = await validate(.castAdd(CastAddInput(text: "opencaster macOS dry run")), type: .castAdd)
        print("castAdd →", result)
        #expect(!result.contains("Invalid protobuf"))
    }

    @Test func dummyReply() async throws {
        let parent = CastParent.castId(fid: 2, hash: try hexToBytes("854c9bf8d865cb9d25c5855149addc498e82084e"))
        let result = await validate(.castAdd(CastAddInput(text: "dry run reply", parent: parent)), type: .castAdd)
        print("reply →", result)
        #expect(!result.contains("Invalid protobuf"))
    }

    @Test func dummyLike() async throws {
        let target = HypersnapProtocol.ReactionTarget.castId(fid: 2, hash: try hexToBytes("854c9bf8d865cb9d25c5855149addc498e82084e"))
        let result = await validate(.reaction(type: .like, target: target), type: .reactionAdd)
        print("like →", result)
        #expect(!result.contains("Invalid protobuf"))
    }
}
