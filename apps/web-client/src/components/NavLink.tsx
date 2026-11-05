import type { AnchorHTMLAttributes, MouseEvent } from 'react';

/** Runs an in-app action for a plain primary click; modified clicks keep the browser's link behavior. */
export function localClick(event: MouseEvent<HTMLAnchorElement>, action: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); action();
}
type NavLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & { href: string; onNavigate(path: string): void };
/** A real link to a local path that navigates in-app on a plain click. */
export function NavLink({ href, onNavigate, ...props }: NavLinkProps) {
  return <a {...props} href={href} onClick={event => localClick(event, () => onNavigate(href))} />;
}
