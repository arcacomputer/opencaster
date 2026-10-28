import { useEffect, useRef, useState } from 'react';
import { IconArrowLeft, IconArrowRight, IconArrowUpRight } from '@tabler/icons-react';
import { Button, Modal } from './ui';

export interface CastImage { url: string; alt: string }

/** Images remain public attachments; viewing them never calls a wallet or API. */
export default function MediaViewer({ images, initialIndex, onClose }: { images: readonly CastImage[]; initialIndex: number; onClose(): void }) {
  const safeImages = images.filter(image => {
    try { const url = new URL(image.url); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }).slice(0, 2);
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, safeImages.length - 1)));
  const [failed, setFailed] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const image = safeImages[index];
  function move(direction: number) { setIndex(current => (current + direction + safeImages.length) % safeImages.length); }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || safeImages.length < 2 || document.activeElement?.closest('dialog') !== container.current?.closest('dialog')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setIndex(current => (current + (event.key === 'ArrowLeft' ? -1 : 1) + safeImages.length) % safeImages.length); }
    }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [safeImages.length]);
  return <Modal title="Cast images" onClose={onClose} wide>
    <div className="media-viewer" ref={container}>
      {image ? <>
        <div className="media-viewer__stage">{failed === image.url ? <p role="status">This image could not be loaded. You can try opening the original.</p> : <img key={image.url} src={image.url} alt={image.alt} referrerPolicy="no-referrer" onError={() => setFailed(image.url)} />}</div>
        <div className="media-viewer__controls">
          <Button variant="secondary" aria-label="Previous image" disabled={safeImages.length < 2} onClick={() => move(-1)}><IconArrowLeft size={18} /></Button>
          <span role="status">{index + 1} of {safeImages.length}</span>
          <Button variant="secondary" aria-label="Next image" disabled={safeImages.length < 2} onClick={() => move(1)}><IconArrowRight size={18} /></Button>
          <a className="button button--ghost" href={image.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open original<IconArrowUpRight size={16} /></a>
        </div>
      </> : <p role="status">No image is available.</p>}
    </div>
  </Modal>;
}
