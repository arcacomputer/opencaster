import { useEffect, useRef, useState } from 'react';
import { IconArrowUpRight } from '@tabler/icons-react';
import { HLS_CONNECT_ORIGINS, type PlaybackKind } from '@opencaster/client-core/castAttachments';
import { useNearViewport } from '../lib/useNearViewport';
import { Button } from './ui';
import '../link-embeds.scss';

export default function MediaEmbed({ url, kind }: { url: string; kind: PlaybackKind }) {
  const { container, visible } = useNearViewport();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const active = visible && !failed;
  const audio = kind === 'audio';
  const label = audio ? 'audio' : 'video';

  useEffect(() => {
    const video = videoRef.current;
    if (!active || kind !== 'hls' || !video) return;
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');
    let disposed = false;
    let detach: (() => void) | undefined;

    const fail = () => { if (!disposed) setFailed(true); };
    const tryNative = () => {
      if (nativeHls) video.src = url;
      else fail();
    };

    // Prefer native playback on browsers with known HLS support. A nonempty
    // canPlayType result alone also occurs on browsers with partial support.
    if (!HLS_CONNECT_ORIGINS.includes(new URL(url).origin) || (nativeHls && 'ManagedMediaSource' in window)) {
      tryNative();
    } else {
      void import('../lib/hlsPlayback').then(({ attachHls }) => {
        if (disposed) return;
        detach = attachHls(video, url, fail);
        if (!detach) tryNative();
      }).catch(() => { if (!disposed) tryNative(); });
    }

    return () => {
      disposed = true;
      detach?.();
      if (video.hasAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [active, kind, url]);

  return <div className={`rich-embed rich-embed--${label}`} ref={container}>
    {failed ? <div className="rich-embed__status">
      <span role="status">This {label} could not be played.</span>
      <Button variant="ghost" onClick={() => setFailed(false)}>Try again</Button>
    </div> : !visible ? <div className="rich-embed__media-placeholder" aria-hidden="true" /> : audio
      ? <audio className="rich-embed__media" aria-label="Attached audio" controls preload="metadata" src={url} onError={() => setFailed(true)} />
      : <video className="rich-embed__media" aria-label="Attached video" ref={videoRef} controls playsInline preload="metadata" src={kind === 'video' ? url : undefined} onError={() => setFailed(true)} />}
    <a className="rich-embed__original" href={url} target="_blank" rel="noopener noreferrer">
      <span>Open original {label}</span><IconArrowUpRight size={16} aria-hidden="true" />
    </a>
  </div>;
}
