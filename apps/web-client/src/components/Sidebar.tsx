import { IconBell, IconBookmark, IconCompass, IconHash, IconLayoutList, IconMoon, IconPencil, IconPin, IconSearch, IconSettings, IconShieldLock, IconSparkles, IconSun, IconUsers } from '@tabler/icons-react';
import { Button } from './ui';
import type { Channel, User } from '@opencaster/client-core/api';
import { feedPath, type AppRoute } from '@opencaster/client-core/navigation';
import type { SavedFeed } from '@opencaster/client-core/customFeeds';
import type { WalletSession } from '../lib/auth';
import { NODE_SUPPORT_URL } from '../lib/nodeSupport';
import { Avatar } from './CastCard';
import { localClick, NavLink } from './NavLink';

export const sourceUrl = 'https://github.com/arcacomputer/opencaster';

type SidebarProps = { view: AppRoute['kind']; channel: string; profile: User | null; session: WalletSession | null; bookmarkCount: number; pinnedFeeds: SavedFeed[]; savedFeedId?: string; savedChannels: Channel[]; channels: Channel[]; dark: boolean; onToggleTheme(): void; onNavigate(path: string): void; onOpenChannel(channel: Channel): void; onCompose(): void; onDeviceSettings(): void; onSignIn(): void };
export default function Sidebar({ view, channel, profile, session, bookmarkCount, pinnedFeeds, savedFeedId, savedChannels, channels, dark, onToggleTheme, onNavigate, onOpenChannel, onCompose, onDeviceSettings, onSignIn }: SidebarProps) {
  return <aside className={`sidebar ${pinnedFeeds.length ? 'sidebar--feeds' : ''}`}>
    <a data-analytics="nav-discover" href="/" onClick={event => localClick(event, () => onNavigate('/'))} className="wordmark"><img src="/opencaster-symbol.svg" alt="" />Opencaster</a>
    <p className="brand-credit">Powered by <a href="https://arca.computer" target="_blank" rel="noopener noreferrer">Arca Computer</a></p>
    <div className="network-label"><span className="status-dot" /> Runs on Hypersnap <span className="beta">BETA</span></div>
    <nav aria-label="Main navigation">
      <Button data-analytics="nav-discover" variant="ghost" className={`nav-item ${view === 'discover' ? 'active' : ''}`} onClick={() => onNavigate('/')}><IconCompass size={21} />Discover <IconSparkles size={15} className="nav-spark" /></Button>
      <Button data-analytics="nav-following" variant="ghost" className={`nav-item ${view === 'following' ? 'active' : ''}`} onClick={() => onNavigate('/following')}><IconUsers size={21} />Following</Button>
      <NavLink data-analytics="nav-feeds" className={`button button--ghost nav-item ${view === 'feeds' || view === 'feed' ? 'active' : ''}`} href="/feeds" aria-current={view === 'feeds' ? 'page' : undefined} onNavigate={onNavigate}><IconLayoutList size={21} />Feeds</NavLink>
      <Button data-analytics="nav-search" variant="ghost" className={`nav-item ${view === 'search' ? 'active' : ''}`} onClick={() => onNavigate('/search')}><IconSearch size={21} />Search</Button>
      <Button data-analytics="nav-notifications" variant="ghost" className={`nav-item ${view === 'notifications' ? 'active' : ''}`} onClick={() => onNavigate('/notifications')}><IconBell size={21} />Notifications</Button>
      <Button data-analytics="nav-channels" variant="ghost" className={`nav-item ${view === 'channels' ? 'active' : ''}`} onClick={() => onNavigate('/channels')}><IconHash size={21} />Channels</Button>
      <Button data-analytics="nav-bookmarks" variant="ghost" className={`nav-item ${view === 'bookmarks' ? 'active' : ''}`} onClick={() => onNavigate('/bookmarks')}><IconBookmark size={21} />Bookmarks {bookmarkCount > 0 && <span className="nav-count">{bookmarkCount}</span>}</Button>
      {session && <Button data-analytics="nav-profile" variant="ghost" className={`nav-item ${view === 'profile' && profile?.fid === session.fid ? 'active' : ''}`} onClick={() => onNavigate('/profile')}><Avatar user={session.user} />My profile</Button>}
      <NavLink data-analytics="nav-settings" className={`button button--ghost nav-item ${view === 'settings' ? 'active' : ''}`} href="/settings" aria-current={view === 'settings' ? 'page' : undefined} onNavigate={onNavigate}><IconSettings size={21} />Settings</NavLink>
    </nav>
    {session && <Button data-analytics="composer-open" className="sidebar-cast" onClick={() => onCompose()}><IconPencil size={19} />Cast</Button>}
    {pinnedFeeds.length > 0 && <><div className="sidebar__section-label">PINNED FEEDS <IconPin size={14} /></div><nav aria-label="Pinned feeds">{pinnedFeeds.map(item => <NavLink key={item.id} className={`button button--ghost channel-nav ${savedFeedId === item.id ? 'active' : ''}`} href={feedPath(item.definition)} aria-current={savedFeedId === item.id ? 'page' : undefined} onNavigate={onNavigate}><IconLayoutList size={17} /><span>{item.definition.name}</span></NavLink>)}</nav></>}
    {savedChannels.length > 0 && <><div className="sidebar__section-label">SAVED ON THIS BROWSER <IconBookmark size={14} /></div><nav aria-label="Saved channels">{savedChannels.slice(0, 8).map(item => <Button data-analytics="nav-channel" key={item.id} variant="ghost" className={`channel-nav ${view === 'channel' && channel === item.id ? 'active' : ''}`} onClick={() => onOpenChannel(item)}><span className="channel-mark"><IconHash size={17} /></span>{item.name || item.id}</Button>)}</nav></>}
    <div className="sidebar-explore">
    <div className="sidebar__section-label">EXPLORE CHANNELS <IconHash size={14} /></div>
    <nav aria-label="Channels">{channels.map(item => <Button data-analytics="nav-channel" key={item.id} variant="ghost" className={`channel-nav ${view === 'channel' && channel === item.id ? 'active' : ''}`} onClick={() => onOpenChannel(item)}><span className="channel-mark"><IconHash size={17} /></span>{item.name}</Button>)}</nav>
    </div>
    <div className="sidebar__bottom"><div className="sidebar-links"><Button data-analytics="theme-toggle" variant="ghost" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => onToggleTheme()}>{dark ? <IconSun size={19} /> : <IconMoon size={19} />}</Button><NavLink data-analytics="nav-devlog" href="/devlog" aria-current={view === 'devlog' ? 'page' : undefined} onNavigate={onNavigate}>Dev log</NavLink><a data-analytics="source-open" href={sourceUrl} target="_blank" rel="noopener noreferrer">Source</a><a data-analytics="hypersnap-open" href="https://hypersnap.org" target="_blank" rel="noopener noreferrer">Hypersnap</a><a data-analytics="node-support-open" href={NODE_SUPPORT_URL} target="_blank" rel="noopener noreferrer" aria-label="Support the node (opens Stripe in a new tab)">Support the node</a></div>{session ? <div className="session-card"><Button data-analytics="nav-profile" variant="ghost" className="session-user" onClick={() => onNavigate('/profile')}><Avatar user={session.user} /><span><strong>{session.user.display_name || session.user.username}</strong><small>@{session.user.username}</small></span></Button><Button data-analytics="device-access-open" variant="ghost" aria-label="Manage this device’s signing access" onClick={() => onDeviceSettings()}><IconShieldLock size={19} /></Button></div> : <Button data-analytics="connect-open" className="full-width sidebar-signin" onClick={() => onSignIn()}>Sign in</Button>}<p className="sidebar-foot">OPEN PROTOCOL. OPEN POSSIBILITIES.</p></div>
  </aside>;
}
