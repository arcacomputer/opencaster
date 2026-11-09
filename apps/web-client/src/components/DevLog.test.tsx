// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_LOG, PROJECT_STARTED_AT } from '../lib/devLog';

const DateTimeFormat = Intl.DateTimeFormat;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(locale: string, timeZone: string) {
  // Emulate the browser's defaults while still using the real ICU conversion.
  const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (_locales, options) {
    return new DateTimeFormat(locale, { ...options, timeZone });
  });
  const { default: DevLog } = await import('./DevLog');
  await act(async () => root.render(<DevLog />));
  expect(formatter).toHaveBeenCalledWith(undefined, expect.not.objectContaining({ timeZone: expect.anything() }));
}
const milestoneTimes = () => [...container.querySelectorAll<HTMLTimeElement>('.devlog-entry__meta time')];
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;

describe('compact dev-log entries', () => {
  it('starts with short summaries and keeps the full history available in closed disclosures', async () => {
    await render('en-US', 'America/Los_Angeles');
    for (const entry of DEV_LOG) {
      const article = container.querySelector<HTMLElement>(`#${entry.id}`)!;
      const details = article.querySelector<HTMLDetailsElement>('details')!;
      expect(article.querySelector('h3')?.textContent).toBe(entry.title);
      expect(article.querySelector(':scope > p')?.textContent).toBe(entry.summary);
      expect(details.open).toBe(false);
      expect(details.querySelector('summary')?.textContent).toContain('More details');
      expect([...details.querySelectorAll('ul > li')].map(item => item.textContent)).toEqual(entry.changes);
      expect(details.querySelector<HTMLAnchorElement>('a')?.href).toBe(entry.commit);
    }
  });

  it('opens and closes one update independently while preserving it through topic and order changes', async () => {
    await render('en-US', 'America/Los_Angeles');
    const entry = DEV_LOG.find(item => item.tag === 'Reliability')!;
    const details = container.querySelector<HTMLDetailsElement>(`#${entry.id} details`)!;
    const summary = details.querySelector('summary')!;
    await act(async () => summary.click());
    expect(details.open).toBe(true);
    expect([...container.querySelectorAll<HTMLDetailsElement>('.devlog-entry details')]
      .filter(item => item.open)).toEqual([details]);

    await act(async () => button('Reliability').click());
    expect(container.querySelector<HTMLDetailsElement>(`#${entry.id} details`)?.open).toBe(true);
    await act(async () => button('Show oldest first').click());
    expect(container.querySelector<HTMLDetailsElement>(`#${entry.id} details`)?.open).toBe(true);
    await act(async () => summary.click());
    expect(details.open).toBe(false);
  });
});

describe('local dev-log update times', () => {
  it.each([
    ['en-US', 'America/Los_Angeles', 'Oct 27, 2026, 11:46 PM PDT'],
    ['es-CL', 'Asia/Tokyo', '28 oct 2026, 3:46 p. m. GMT+9'],
  ])('uses the viewer’s %s locale and %s timezone, including a date rollover', async (locale, timeZone, expected) => {
    await render(locale, timeZone);
    const time = container.querySelector<HTMLTimeElement>('#feed-rendering-pagination time')!;
    expect(time.dateTime).toBe('2026-10-28T06:46:23Z');
    expect(time.textContent?.replace(/\s+/g, ' ')).toBe(expected);
    const facts = container.querySelectorAll<HTMLTimeElement>('.devlog-facts time');
    expect(facts[0].dateTime).toBe(PROJECT_STARTED_AT);
    expect(facts[1].outerHTML).toBe(milestoneTimes()[0].outerHTML);
    expect(milestoneTimes()).toHaveLength(DEV_LOG.length);
    expect(container.querySelector('.devlog-timezone')?.textContent).toContain('shown in your local timezone');
  });

  it('orders mixed-offset timestamps by instant and preserves ordering when filtering and reversing', async () => {
    await render('en-US', 'America/Los_Angeles');
    const descending = milestoneTimes().map(time => Date.parse(time.dateTime));
    expect(descending).toEqual([...descending].sort((a, b) => b - a));
    await act(async () => button('Reliability').click());
    expect(milestoneTimes()).toHaveLength(DEV_LOG.filter(entry => entry.tag === 'Reliability').length);
    await act(async () => button('Show oldest first').click());
    expect(milestoneTimes().map(time => Date.parse(time.dateTime))).toEqual([...descending].reverse());
    expect(milestoneTimes()[0].dateTime).toBe(PROJECT_STARTED_AT);
    await act(async () => button('Show latest first').click());
    expect(milestoneTimes().map(time => Date.parse(time.dateTime))).toEqual(descending);
  });
});
