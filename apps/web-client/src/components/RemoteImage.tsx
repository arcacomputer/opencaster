import { useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { safeHttpsUrl } from '@opencaster/client-core/safeUrl';

type Props = Pick<ComponentPropsWithoutRef<'img'>, 'src' | 'alt' | 'className' | 'width' | 'height' | 'loading'> & { fallback?: ReactNode };

export default function RemoteImage({ src, fallback = null, ...props }: Props) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = safeHttpsUrl(src);
  return url && url !== failedUrl
    ? <img key={url} {...props} src={url} decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
    : fallback;
}
