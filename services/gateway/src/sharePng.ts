import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';

let ready: Promise<void> | undefined;

/** Isolated from normal page delivery; Wasm is loaded only for preview images. */
export async function renderSharePng(svg: string, font: Uint8Array): Promise<Uint8Array> {
  await (ready ??= initWasm(wasm));
  const renderer = new Resvg(svg, {
    font: { fontBuffers: [font], defaultFontFamily: 'Inter' },
    fitTo: { mode: 'width', value: 1200 },
  });
  let image: ReturnType<typeof renderer.render> | undefined;
  try { image = renderer.render(); return image.asPng(); }
  finally { image?.free(); renderer.free(); }
}
