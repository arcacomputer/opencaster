/** Public synthetic configuration. Never point this at production data. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPrivateKey, createPublicKey } from 'node:crypto';

const folder = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'arca-hypersnap-e2e'));
if (![path.resolve(os.tmpdir()), '/tmp', '/private/tmp'].includes(path.dirname(folder)) || !/^arca-hypersnap-e2e[-_a-z0-9]*$/i.test(path.basename(folder))) throw new Error('Use a new temporary arca-hypersnap-e2e directory for this isolated fixture.');
const config = path.join(folder, 'nodes/1/hypersnap.toml');
await fs.mkdir(path.dirname(config), { recursive: true });
const privateKey = '06'.repeat(32); // public test key, never fund or reuse
const key = createPrivateKey({ key: Buffer.from('302e020100300506032b657004220420' + privateKey, 'hex'), format: 'der', type: 'pkcs8' });
const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
await fs.writeFile(config, `fc_network="Devnet"
admin_rpc_auth="arca-e2e:synthetic-test-only"
rpc_address="127.0.0.1:13383"
http_address="127.0.0.1:13381"
rocksdb_dir="${path.join(folder, 'nodes/1/.rocks')}"
l1_rpc_url=""
[statsd]
prefix="arca-e2e"
addr="127.0.0.1:8125"
use_tags=false
[gossip]
address="/ip4/127.0.0.1/udp/50051/quic-v1"
announce_address="/ip4/127.0.0.1/udp/50051/quic-v1"
announce_rpc_address="http://127.0.0.1:13383"
bootstrap_peers=""
enable_autodiscovery=false
[consensus]
private_key="${privateKey}"
block_time="1s"
shard_ids=[1]
num_shards=1
validator_sets=[{effective_at=0,validator_public_keys=["${publicKey}"],shard_ids=[0,1]}]
[onchain_events]
rpc_url=""
[base_onchain_events]
rpc_url=""
[snapshot]
endpoint_url=""
load_db_from_snapshot=false
[fnames]
disable=true
[hyper]
enabled=true
[api]
enabled=true
[api.social_graph]
enabled=true
[api.feeds]
enabled=true
[api.metrics]
enabled=true
[api.channels]
enabled=true
[api.search]
enabled=true
index_path="${path.join(folder, 'search-index')}"
[api.conversations]
enabled=true
[block_receiver]
enabled=true
[replication]
enable=false
`, { flag: 'wx', mode: 0o600 });
await fs.writeFile(path.join(folder, 'network.sb'), `(version 1)
(allow default)
(deny network*)
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))
`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ config, sandbox: path.join(folder, 'network.sb'), http: 'http://127.0.0.1:13381', rpc: 'http://127.0.0.1:13383', isolated: true }));
