// Wire-format decode and validation tests for HypersnapAPI.
// The cast fixture is a real haatz response (trimmed), including unknown
// keys the node adds beyond the client's declared fields.
import Foundation
import Testing
@testable import HypersnapAPI

private let castFixture = """
{
  "cast": {
    "object": "cast",
    "hash": "cd5f0b4407a6320044d359e4b3b7bd349135d2e2",
    "parent_author": { "fid": null },
    "author": {
      "object": "user",
      "fid": 316323,
      "username": "smshakil",
      "display_name": "Base Global Foundation",
      "custody_address": "0x7df2e71d3229bceeabe40c1b7f664cb6d6efb8f2",
      "pfp_url": "https://cdn.recaster.org/cast/d1163882.png",
      "registered_at": "2024-02-07T12:07:17.000Z",
      "profile": { "bio": { "text": "Community builder" } },
      "follower_count": 30505,
      "following_count": 6788,
      "verifications": ["0x46f25ac4dd7612e77374f9902187d59de454bc33"],
      "auth_addresses": [],
      "verified_addresses": {
        "eth_addresses": ["0x46f25ac4dd7612e77374f9902187d59de454bc33"],
        "sol_addresses": ["84pT5y8fyJqKoGewBxBtU7F2RURat9riNSMPVUMp3Hnv"],
        "primary": { "eth_address": "0x46f25ac4dd7612e77374f9902187d59de454bc33" }
      },
      "verified_accounts": []
    },
    "text": "Hello Farcaster",
    "timestamp": "2026-11-13T03:43:39.000Z",
    "embeds": [
      { "url": "https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/abc/original" },
      { "cast_id": { "fid": 2, "hash": "0x19f4b1a1a3e5e34b4f3a4b1a1a3e5e34b4f3a4b1" } }
    ],
    "type": "cast",
    "reactions": { "likes_count": 53, "recasts_count": 51, "likes": [], "recasts": [] },
    "replies": { "count": 52 },
    "thread_hash": "cd5f0b4407a6320044d359e4b3b7bd349135d2e2"
  }
}
"""

@Suite("HypersnapAPI decoding")
struct DecodingTests {
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    private struct CastWrap: Decodable { let cast: Cast? }

    @Test func decodesRealCastPayload() throws {
        let wrap = try decoder.decode(CastWrap.self, from: Data(castFixture.utf8))
        let cast = try #require(wrap.cast)
        #expect(cast.hash == "cd5f0b4407a6320044d359e4b3b7bd349135d2e2")
        #expect(cast.author.fid == 316323)
        #expect(cast.author.username == "smshakil")
        #expect(cast.author.displayName == "Base Global Foundation")
        #expect(cast.author.verifiedAddresses?.ethAddresses?.count == 1)
        #expect(cast.reactions.likesCount == 53)
        #expect(cast.replies.count == 52)
        #expect(cast.parentAuthor?.fid == nil)
        #expect(cast.embeds.count == 2)
        #expect(cast.embeds[0] == .url("https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/abc/original"))
        #expect(cast.embeds[1] == .castId(fid: 2, hash: "0x19f4b1a1a3e5e34b4f3a4b1a1a3e5e34b4f3a4b1"))
        #expect(hasImageEmbed(cast))
    }
}

@Suite("Input validation")
struct ValidationTests {
    @Test func castHash() throws {
        #expect(isCastHash("cd5f0b4407a6320044d359e4b3b7bd349135d2e2"))
        #expect(isCastHash("0xcd5f0b4407a6320044d359e4b3b7bd349135d2e2"))
        #expect(isCastHash("0xCD5F0B4407A6320044D359E4B3B7BD349135D2E2"))
        #expect(!isCastHash("cd5f0b44"))
        #expect(!isCastHash("0xcd5f0b4407a6320044d359e4b3b7bd349135d2e2ff"))
        #expect(!isCastHash("zz5f0b4407a6320044d359e4b3b7bd349135d2e2"))
        #expect(throws: ApiInputError.invalidCastHash) { try hashValue("0x1234") }
        #expect(try hashValue("0xCD5F0B4407A6320044D359E4B3B7BD349135D2E2") == "cd5f0b4407a6320044d359e4b3b7bd349135d2e2")
    }

    @Test func pageToken() {
        #expect(validPageToken("YWJjZA=="))
        #expect(validPageToken("YWJj"))
        #expect(!validPageToken("YWJjZA==YWJj"))    // padding only allowed at the end
        #expect(!validPageToken(""))
        #expect(!validPageToken("YWJjZA"))          // not a multiple of 4
        #expect(!validPageToken("Y=JjZA=="))        // padding mid-group
        #expect(!validPageToken("YWJjZA==="))       // >2 padding
        #expect(!validPageToken("YWJj??=="))
    }

    @Test func decimalCursor() {
        #expect(validDecimalCursor("0"))
        #expect(validDecimalCursor("18446744073709551615"))
        #expect(!validDecimalCursor("18446744073709551616"))
        #expect(!validDecimalCursor("12a4"))
        #expect(!validDecimalCursor(""))
    }
}
