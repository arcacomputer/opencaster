// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HypersnapKit",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "HypersnapKit", targets: ["HypersnapAPI"]),
        .library(name: "HypersnapProtocol", targets: ["HypersnapProtocol"]),
    ],
    dependencies: [
        .package(url: "https://github.com/21-DOT-DEV/swift-secp256k1", from: "0.9.0"),
        .package(url: "https://github.com/jedisct1/swift-sodium", from: "0.9.0"),
    ],
    targets: [
        .target(
            name: "HypersnapProtocol",
            dependencies: [
                .product(name: "libsecp256k1", package: "swift-secp256k1"),
                .product(name: "Sodium", package: "swift-sodium"),
            ],
            resources: [.copy("Resources/bip39-english.txt")]
        ),
        .target(
            name: "HypersnapAPI",
            dependencies: ["HypersnapProtocol"]
        ),
        .testTarget(
            name: "HypersnapKitTests",
            dependencies: ["HypersnapProtocol", "HypersnapAPI"],
            resources: [.copy("Resources")]
        ),
    ]
)
