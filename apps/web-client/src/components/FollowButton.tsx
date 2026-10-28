import { IconCheck, IconRefresh, IconUserPlus } from '@tabler/icons-react';
import { Button } from './ui';

export default function FollowButton({ following, pending, disabled = false, onClick }: { following: boolean | null; pending: boolean; disabled?: boolean; onClick(): void }) {
  return <Button data-analytics={following ? 'profile-unfollow' : 'profile-follow'} variant={following ? 'secondary' : 'primary'} disabled={disabled || pending || following === null} aria-pressed={following ?? undefined} aria-label={following ? 'Unfollow this profile' : 'Follow this profile'} title={following ? 'Unfollow this profile' : undefined} onClick={onClick}>
    {pending ? <IconRefresh size={16} className="spin" /> : following ? <IconCheck size={16} /> : <IconUserPlus size={16} />}
    {pending ? 'Updating…' : following === null ? 'Checking follow status…' : following ? 'Following' : 'Follow'}
  </Button>;
}
