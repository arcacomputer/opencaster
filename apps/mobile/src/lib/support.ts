export const SUPPORT_EMAIL = 'support@opencaster.org';
export const SUPPORT_OPERATOR = 'Luis Felipe Abarca';
export const MAX_SUPPORT_DETAILS = 1000;

export type SupportTarget =
  | { kind: 'support' }
  | { kind: 'user'; fid: number }
  | { kind: 'post'; fid: number; hash: string };

export interface SupportDraft {
  recipient: string;
  subject: string;
  body: string;
  url: string;
}

export function supportTargetLabel(target: SupportTarget): string {
  if (target.kind === 'support') return 'General support';
  if (!Number.isSafeInteger(target.fid) || target.fid <= 0) throw new Error('Invalid report FID.');
  if (target.kind === 'user') return `User FID ${target.fid}`;
  if (target.kind !== 'post' || !/^(?:0x)?[a-fA-F0-9]{40}$/.test(target.hash)) {
    throw new Error('Invalid report post.');
  }
  return `Post ${target.hash.replace(/^0x/, '').toLowerCase()}\nAuthor FID ${target.fid}`;
}

export function createSupportDraft(target: SupportTarget, details: string): SupportDraft {
  const label = supportTargetLabel(target);
  const text = details.trim();
  if (!text || details.length > MAX_SUPPORT_DETAILS) {
    throw new Error(`Enter a description of up to ${MAX_SUPPORT_DETAILS} characters.`);
  }
  const subject = target.kind === 'support' ? 'OpenCaster support request' : `OpenCaster ${target.kind} report`;
  const body = `${label}\n\n${text}`;
  let url: string;
  try {
    url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } catch {
    throw new Error('The description contains invalid text. Please edit it and review again.');
  }
  return { recipient: SUPPORT_EMAIL, subject, body, url };
}
