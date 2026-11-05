import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { IconArrowUpRight, IconLink } from '@tabler/icons-react';
import { linkEmbedProvider, type LinkEmbedProvider } from '@opencaster/client-core/linkEmbeds';
import { publicUrl } from '@opencaster/client-core/navigation';
import { quorumSocialPath } from '../lib/socialLinks';
import { Button } from './ui';
import '../link-embeds.scss';

function ProviderEmbed({ provider, dark }: { provider: LinkEmbedProvider; dark: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [height, setHeight] = useState(360);
  const [attempt, setAttempt] = useState(0);
  const label = { x: 'X', youtube: 'YouTube', vimeo: 'Vimeo', spotify: 'Spotify' }[provider.kind];
  const embedId = `opencaster-x-${provider.id}`;

  useEffect(() => {
    if (!container.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '300px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || status === 'unavailable' || (provider.kind !== 'x' && status === 'ready')) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function receive(event: MessageEvent) {
      // Accept only this provider frame's native lifecycle events. No script
      // from X runs in the app page, and other frames cannot resize this card.
      let data: unknown = event.data;
      if (provider.kind !== 'x' || !frame.current?.contentWindow || event.source !== frame.current.contentWindow || event.origin !== 'https://platform.twitter.com') return;
      if (typeof data === 'string') {
        if (data.length > 10_000) return;
        try { data = JSON.parse(data); } catch { return; }
      }
      if (!data || typeof data !== 'object') return;
      const value = (data as Record<string, unknown>)['twttr.embed'];
      if (!value || typeof value !== 'object') return;
      const message = value as Record<string, unknown>;
      if (message.jsonrpc !== '2.0' || message.id !== embedId || !Array.isArray(message.params) || message.params.length !== 1) return;
      const detail: unknown = message.params[0];
      if (!detail || typeof detail !== 'object') return;
      const info = detail as Record<string, unknown>;
      if (!info.data || typeof info.data !== 'object' || (info.data as Record<string, unknown>).tweet_id !== provider.id) return;
      if (message.method === 'twttr.private.resize') {
        if (typeof info.height !== 'number' || !Number.isFinite(info.height) || info.height < 1 || info.height > 1600) return;
        // X can report a rounded height below a fractional CSS pixel. Keep the
        // last row visible without introducing an internal frame scrollbar.
        setHeight(Math.min(1600, Math.max(240, Math.ceil(info.height) + 1)));
      } else if (message.method === 'twttr.private.rendered' || message.method === 'twttr.private.no_results') {
        clearTimeout(timer);
        setStatus(message.method === 'twttr.private.rendered' ? 'ready' : 'unavailable');
      }
    }
    window.addEventListener('message', receive);
    if (status === 'loading') timer = setTimeout(() => setStatus('unavailable'), 20_000);
    return () => { clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [visible, provider.id, provider.kind, embedId, attempt, status]);

  const src = provider.kind === 'x' ? `https://platform.twitter.com/embed/Tweet.html?${new URLSearchParams({ id: provider.id, dnt: 'true', hideThread: 'true', theme: dark ? 'dark' : 'light', lang: 'en', embedId })}` : provider.src;
  return <div className={`rich-embed rich-embed--${provider.kind}`} ref={container}>
    {status !== 'ready' && <div className="rich-embed__status" role="status">
      <span>{status === 'unavailable' ? `${label} embed unavailable. Open the original to view it.` : `Loading ${label}…`}</span>
      {status === 'unavailable' && <Button variant="ghost" onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }}>Try again</Button>}
    </div>}
    {visible && status !== 'unavailable' && <iframe key={attempt} ref={frame} src={src} title={provider.kind === 'x' ? 'Embedded X post' : `${label} player`}
      className="rich-embed__frame" height={provider.kind === 'x' ? height : provider.kind === 'spotify' ? 352 : undefined}
      scrolling={provider.kind === 'x' ? 'no' : undefined}
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
      allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy={provider.kind === 'youtube' ? 'strict-origin' : 'no-referrer'}
      onLoad={provider.kind === 'x' ? undefined : () => setStatus('ready')} onErrorCapture={() => setStatus('unavailable')} />}
    <a className="rich-embed__original" href={provider.url} target="_blank" rel="noopener noreferrer" title={provider.url}>
      <span>Open on {label}</span><IconArrowUpRight size={16} aria-hidden="true" />
    </a>
  </div>;
}

export default function LinkEmbed({ url, dark, onNavigate }: { url: string; dark: boolean; onNavigate(path: string): void }) {
  const localPath = quorumSocialPath(url);
  const provider = !localPath && linkEmbedProvider(url);
  if (provider) return <ProviderEmbed key={`${provider.url}:${provider.kind === 'x' ? dark : ''}`} provider={provider} dark={dark} />;
  const destination = new URL(localPath ? publicUrl(localPath) : url);
  let path = `${destination.pathname}${destination.search}${destination.hash}`;
  try { path = decodeURI(path); } catch { /* Keep malformed escapes readable as written. */ }
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (!localPath || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(localPath);
  }
  return <a className="link-embed link-embed--destination" href={localPath ?? url} target={localPath ? undefined : '_blank'} rel={localPath ? undefined : 'noopener noreferrer'}
    title={localPath ? `Original link: ${url}` : url} onClick={navigate}>
    <IconLink className="link-embed__icon" size={24} aria-hidden="true" />
    <span className="link-embed__caption"><small>{destination.hostname.replace(/^www\./, '')}</small><strong>{path === '/' ? 'Open website' : path}</strong></span>
    <IconArrowUpRight className="link-embed__arrow" size={17} aria-hidden="true" />
  </a>;
}
