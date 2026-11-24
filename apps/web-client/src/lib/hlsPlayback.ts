import Hls from 'hls.js';
import workerPath from 'hls.js/dist/hls.worker.js?url';

export function attachHls(video: HTMLVideoElement, url: string, onError: () => void): (() => void) | undefined {
  if (!Hls.isSupported()) return;
  const player = new Hls({ workerPath, capLevelToPlayerSize: true, maxBufferLength: 12, maxMaxBufferLength: 24, backBufferLength: 30 });
  player.on(Hls.Events.ERROR, (_event, error) => { if (error.fatal) onError(); });
  try {
    player.loadSource(url);
    player.attachMedia(video);
  } catch (error) {
    player.destroy();
    throw error;
  }
  return () => player.destroy();
}
