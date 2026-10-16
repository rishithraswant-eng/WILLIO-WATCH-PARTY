import { expect, type Browser, type Page } from '@playwright/test';

export const API = 'http://localhost:4000';

/** Create a room through the REST API (fast) and return its code. */
export async function createRoomViaApi(hostName = 'Host'): Promise<{ code: string; token: string; userId: string }> {
  const res = await fetch(`${API}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: hostName, avatarSeed: hostName, controlMode: 'EVERYONE' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { code: string; token: string; userId: string };
}

/** Open a room in a fresh browser context as `name` (?name= skips the profile modal). */
export async function joinAs(browser: Browser, code: string, name: string, viewport = { width: 1400, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(`/r/${code}?name=${encodeURIComponent(name)}`);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Joining...', { timeout: 30_000 });
  return page;
}

export async function videoTime(page: Page): Promise<{ t: number; paused: boolean } | null> {
  return page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { t: v.currentTime, paused: v.paused } : null;
  });
}

/** Host loads the first open film from the room's Discover tab. */
export async function startOpenFilm(page: Page, title = 'Big Buck Bunny'): Promise<void> {
  await page.getByRole('tab', { name: /Discover/ }).click();
  const card = page.locator('article').filter({ hasText: title }).first();
  await card.getByRole('button', { name: /^Play/ }).click();
  await expect(page.locator('video')).toHaveCount(1, { timeout: 20_000 });
}
