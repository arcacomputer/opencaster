import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { replaceTestOrigins, replaceTestMediaGuards, viteTestOriginPlugin } from './e2e-media-runtime.mjs';

const origin = 'http://127.0.0.1:5187';
const media = `${origin}/media/${'a'.repeat(64)}`;
const appPath = fileURLToPath(new URL('../src/App.tsx', import.meta.url));
const app = await fs.readFile(appPath, 'utf8');
const transformed = replaceTestMediaGuards(replaceTestOrigins(app, origin), appPath, origin);
const originsPath = fileURLToPath(new URL('../src/lib/appOrigins.ts', import.meta.url));
const originsSource = await fs.readFile(originsPath, 'utf8');
const publicOrigin = (source, name) => source.match(new RegExp(`^export const ${name} = '([^']+)';$`, 'm'))?.[1];
const primaryOrigin = publicOrigin(originsSource, 'APP_ORIGIN');
const legacyOrigin = publicOrigin(originsSource, 'LEGACY_APP_ORIGIN');
const rewrittenOrigins = replaceTestOrigins(originsSource, origin);
const imageExpression = source => source.match(/export function isUploadedMediaUrl[\s\S]*?return ([^\n]+);/)?.[1];
const photosGuard = (source, origins) => {
  const expression = source.match(/return ((?:url\.protocol|\(url\.protocol)[\s\S]*?);/)?.[1];
  expect(expression).toBeTruthy();
  const evaluate = new Function('url', 'APP_ORIGIN', 'LEGACY_APP_ORIGIN', `return ${expression};`);
  return url => evaluate(url, publicOrigin(origins, 'APP_ORIGIN'), publicOrigin(origins, 'LEGACY_APP_ORIGIN'));
};

describe('isolated media harness URL transformations', () => {
  it('uses the real shared draft image guard and adds only the configured loopback media origin in the harness', async () => {
    const draftPath = fileURLToPath(new URL('../src/lib/composerDraft.ts', import.meta.url));
    const source = await fs.readFile(draftPath, 'utf8');
    expect(source).toContain("import { isUploadedMediaUrl } from './appOrigins'");
    expect(source).toContain('value.images.every(isUploadedMediaUrl)');
    const changed = replaceTestMediaGuards(rewrittenOrigins, originsPath, origin);
    expect(imageExpression(changed)).toBeTruthy();
    const accepted = new Function('value', `return ${imageExpression(changed)};`);
    expect(accepted(media)).toBe(true);
    for (const rejected of [`${media}/extra`, `${media}?query=1`, `${media}#hash`, `${media}\n`, `${origin}/media/${'a'.repeat(63)}`, `http://127x0x0x1:5187/media/${'a'.repeat(64)}`, `http://127.0.0.1:5188/media/${'a'.repeat(64)}`, `http://user@127.0.0.1:5187/media/${'a'.repeat(64)}`]) expect(accepted(rejected)).toBe(false);
    const production = new Function('value', `return ${imageExpression(originsSource)};`);
    expect(production(media)).toBe(false);
    for (const productionOrigin of [primaryOrigin, legacyOrigin]) {
      const url = `${productionOrigin}/media/${'a'.repeat(64)}`;
      expect(production(url)).toBe(true); expect(accepted(url)).toBe(true);
    }
    for (const value of [undefined, null, {}, 123]) { expect(production(value)).toBe(false); expect(accepted(value)).toBe(false); }
    expect(replaceTestMediaGuards(source, draftPath, origin)).toBe(source);
    expect(replaceTestMediaGuards(originsSource, originsPath, primaryOrigin)).toBe(originsSource);
  });
  it('keeps casting URL validation strict while accepting only the isolated upload path', async () => {
    const authPath = fileURLToPath(new URL('../src/lib/auth.ts', import.meta.url));
    const source = await fs.readFile(authPath, 'utf8');
    const functionSource = source.match(/function assertHttpsUrl[\s\S]*?\n}\n/)?.[0];
    expect(functionSource).toBeTruthy();
    for (const credentials of ['url.username', '!!url.username']) {
      const variant = functionSource.replace(/(?:!!)?url\.username/, credentials);
      const transformedAuth = replaceTestMediaGuards(variant, authPath, origin);
      const rejectedExpression = transformedAuth.match(/if \((.*?)\) throw new Error\(\);/)?.[1];
      expect(rejectedExpression).toBeTruthy();
      const rejected = new Function('url', `return !!(${rejectedExpression});`);
      expect(rejected(new URL(media))).toBe(false);
      expect(rejected(new URL('https://example.com/photo.png'))).toBe(false);
      for (const unsafe of [
        `${origin}/channel/test`, `${origin}/media/${'a'.repeat(63)}`, `${media}/extra`,
        `http://localhost:5187/media/${'a'.repeat(64)}`, `http://127.0.0.1:5188/media/${'a'.repeat(64)}`,
        `http://attacker.test/media/${'a'.repeat(64)}`, `http://user@127.0.0.1:5187/media/${'a'.repeat(64)}`,
      ]) expect(rejected(new URL(unsafe))).toBe(true);
    }
    const productionExpression = functionSource.match(/if \((.*?)\) throw new Error\(\);/)?.[1];
    expect(new Function('url', `return !!(${productionExpression});`)(new URL(media))).toBe(true);
  });
  it('admits only the isolated hashed image URL through the Photos tab image guard', async () => {
    const apiPath = fileURLToPath(new URL('../src/lib/api.ts', import.meta.url));
    const source = await fs.readFile(apiPath, 'utf8');
    const replaced = replaceTestMediaGuards(replaceTestOrigins(source, origin), apiPath, origin);
    const accepted = photosGuard(replaced, rewrittenOrigins);
    expect(accepted(new URL(media))).toBe(true);
    for (const rejected of [`${origin}/photo.png`, `${origin}/media/${'a'.repeat(63)}`, `http://localhost:5187/media/${'a'.repeat(64)}`, `http://attacker.test/photo.png`]) expect(accepted(new URL(rejected))).toBe(false);
    const production = photosGuard(source, originsSource);
    expect(production(new URL(media))).toBe(false);
    for (const productionOrigin of [primaryOrigin, legacyOrigin]) expect(production(new URL(`${productionOrigin}/media/${'a'.repeat(64)}`))).toBe(true);
  });
  it('admits only the configured loopback hashed media path through the actual App URL expression', () => {
    const expression = transformed.match(/return (.*?) \? url\.href : undefined;/)?.[1];
    expect(expression).toBeTruthy();
    // Evaluate only this fixed, first-party boolean URL expression; no app or
    // browser runtime is created and no protocol/authentication code is stubbed.
    const accepted = new Function('url', `return ${expression};`);
    expect(accepted(new URL(media))).toBe(true);
    for (const rejected of [
      `${origin}/not-media/${'a'.repeat(64)}`, `${origin}/media/${'a'.repeat(63)}`,
      `http://localhost:5187/media/${'a'.repeat(64)}`, `http://127.0.0.1:5188/media/${'a'.repeat(64)}`,
      `http://attacker.example/media/${'a'.repeat(64)}`, 'javascript:alert(1)',
    ]) expect(accepted(new URL(rejected))).toBe(false);
    expect(accepted(new URL('https://example.com/image.png'))).toBe(true);
    const original = app.match(/return (.*?) \? url\.href : undefined;/)?.[1];
    expect(new Function('url', `return ${original};`)(new URL(media))).toBe(false);
  });

  it('uses the shared image classifier and admits only exact loopback media in the viewer', async () => {
    expect(app).toContain('hasImageEmbed({ ...cast, embeds: [{ url }] })');
    const viewerPath = fileURLToPath(new URL('../src/components/MediaViewer.tsx', import.meta.url));
    const viewer = await fs.readFile(viewerPath, 'utf8');
    const transformedViewer = replaceTestMediaGuards(replaceTestOrigins(viewer, origin), viewerPath, origin);
    const expression = transformedViewer.match(/return (\(url\.protocol.*?)\; } catch/)?.[1];
    expect(expression).toBeTruthy();
    const accepted = new Function('url', `return ${expression};`);
    expect(accepted(new URL(media))).toBe(true);
    for (const rejected of [`http://127x0x0x1:5187/media/${'a'.repeat(64)}`, `http://127.0.0.1:5188/media/${'a'.repeat(64)}`, `${media}/extra`, `${origin}/media/${'a'.repeat(63)}`, `http://user@127.0.0.1:5187/media/${'a'.repeat(64)}`]) expect(accepted(new URL(rejected))).toBe(false);
    expect(viewer).toContain("url.protocol === 'https:' && !url.username && !url.password");
  });

  it('never changes the fixed Hypersnap destination or arbitrary dependencies and refuses non-loopback test origins', async () => {
    const plugin = viteTestOriginPlugin(origin);
    expect(plugin.transform(app, '/external/node_modules/package/src/App.tsx')).toBeUndefined();
    const workerPath = fileURLToPath(new URL('../worker/index.ts', import.meta.url));
    const worker = plugin.transform(await fs.readFile(workerPath, 'utf8'), workerPath);
    const upstreamPath = fileURLToPath(new URL('../worker/upstream.ts', import.meta.url));
    const upstream = plugin.transform(await fs.readFile(upstreamPath, 'utf8'), upstreamPath);
    expect(upstream).toContain("const PUBLIC_ORIGIN = 'https://haatz.quilibrium.com'");
    expect(worker).toContain('fetchUpstream');
    expect(worker).toContain(`const CANONICAL_ORIGIN = '${origin}'`);
    expect(worker).toContain("const LEGACY_HOST = 'quorum.arca.computer'");
    for (const name of ['APP_ORIGIN', 'LEGACY_APP_ORIGIN', 'WORKER_ORIGIN']) expect(publicOrigin(rewrittenOrigins, name)).toBe(origin);
    expect(replaceTestOrigins(originsSource, primaryOrigin)).toBe(originsSource);
    for (const rejected of ['https://attacker.example', 'http://127.0.0.1.attacker.example:5187', 'http://user@127.0.0.1:5187', `${origin}/unexpected`]) expect(() => viteTestOriginPlugin(rejected)).toThrow('loopback');
  });
});
