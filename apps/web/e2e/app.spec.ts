import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createRoomViaApi, joinAs, startOpenFilm, videoTime } from './helpers';

test.describe('landing & theme', () => {
  test('renders the hero and persists the theme toggle', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Same world/ })).toBeVisible();
    const toggle = page.getByRole('switch', { name: /theme/ });
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await toggle.click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(before);
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
  });

  test('has no critical accessibility violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(800);
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) => v.impact === 'critical');
    expect(critical, JSON.stringify(critical.map((v) => v.id))).toEqual([]);
  });

  test('unknown rooms show the void page', async ({ page }) => {
    await page.goto('/r/ZZZZZZ');
    await expect(page.getByText('You fell into the void')).toBeVisible();
  });
});

test.describe('rooms', () => {
  test('join by code from the landing page and see each other', async ({ browser }) => {
    const { code } = await createRoomViaApi();
    const alice = await joinAs(browser, code, 'Alice');
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const bob = await ctx.newPage();
    await bob.goto('/');
    await bob.getByRole('group', { name: 'Room code' }).getByRole('textbox').first().fill(code);
    await expect(bob).toHaveURL(new RegExp(`/r/${code}`));
    await bob.getByLabel('Display name').fill('Bob');
    await bob.getByRole('button', { name: 'Join the party' }).click();
    await alice.getByRole('tab', { name: /People/ }).click();
    await expect(alice.getByRole('list', { name: 'Participants' })).toContainText('Bob');
    await expect(alice.getByRole('list', { name: 'Participants' })).toContainText('Alice');
  });

  test('play / pause / seek are mirrored across 3 browsers', async ({ browser }) => {
    const { code } = await createRoomViaApi();
    const a = await joinAs(browser, code, 'A');
    const b = await joinAs(browser, code, 'B');
    const c = await joinAs(browser, code, 'C');
    await startOpenFilm(a, 'Big Buck Bunny');
    for (const p of [a, b, c]) await expect(p.locator('video')).toHaveCount(1, { timeout: 30_000 });
    // "Play now" from Discover autoplays for everyone after the media-load lead
    await expect.poll(async () => (await videoTime(c))?.paused, { timeout: 30_000 }).toBe(false);
    await a.waitForTimeout(5000);
    const [ta, tb, tc] = await Promise.all([videoTime(a), videoTime(b), videoTime(c)]);
    const ts = [ta!.t, tb!.t, tc!.t];
    expect(Math.max(...ts) - Math.min(...ts)).toBeLessThan(0.5);

    await b.getByRole('button', { name: /Pause \(Space\)/ }).click();
    await expect.poll(async () => (await videoTime(a))?.paused).toBe(true);
    await expect.poll(async () => (await videoTime(c))?.paused).toBe(true);

    await c.keyboard.press('ArrowRight'); // seek +5s (everyone may control in this room)
    await a.waitForTimeout(2500);
    const after = await Promise.all([videoTime(a), videoTime(b), videoTime(c)]);
    const pos = after.map((x) => x!.t);
    expect(Math.max(...pos) - Math.min(...pos)).toBeLessThan(0.2);
  });

  test('chat, reactions, polls and queue', async ({ browser }) => {
    const { code } = await createRoomViaApi();
    const a = await joinAs(browser, code, 'Ann');
    const b = await joinAs(browser, code, 'Ben');
    await a.getByRole('textbox', { name: 'Message' }).fill('hello @Ben <b>not bold</b>');
    await a.keyboard.press('Enter');
    await expect(b.getByRole('list', { name: 'Chat messages' })).toContainText('hello @Ben <b>not bold</b>');

    await a.getByRole('textbox', { name: 'Message' }).fill('/poll "Snacks?" yes | no');
    await a.keyboard.press('Enter');
    await b.getByRole('tab', { name: /Polls/ }).click();
    await b.getByRole('button', { name: /^yes/ }).click();
    await expect(b.getByRole('list', { name: 'Polls' })).toContainText('1 vote');

    await b.getByRole('toolbar', { name: 'Reactions' }).getByRole('button').first().click();

    await a.getByRole('tab', { name: /Queue/ }).click();
    await a.getByLabel('Video URL').fill('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
    await a.getByLabel('Title').fill('Bunny HLS');
    await a.getByRole('button', { name: 'Add' }).click();
    // first queued item auto-loads when nothing is playing
    await expect(b.locator('video')).toHaveCount(1, { timeout: 20_000 });
  });

  test('late joiner lands in sync and reload keeps the identity', async ({ browser }) => {
    const { code } = await createRoomViaApi();
    const a = await joinAs(browser, code, 'Early');
    await startOpenFilm(a, 'Big Buck Bunny'); // autoplays
    await expect.poll(async () => (await videoTime(a))?.paused, { timeout: 30_000 }).toBe(false);
    await a.waitForTimeout(6000);
    const late = await joinAs(browser, code, 'Late');
    await expect(late.locator('[role=status][aria-label^="Sync status: IN SYNC"]')).toBeVisible({ timeout: 30_000 });
    const [ta, tl] = await Promise.all([videoTime(a), videoTime(late)]);
    expect(Math.abs(ta!.t - tl!.t)).toBeLessThan(0.5);

    await late.reload();
    await expect(late.locator('[role=status][aria-label^="Sync status: IN SYNC"]')).toBeVisible({ timeout: 30_000 });
    const peopleTab = a.getByRole('tab', { name: /People/ });
    await peopleTab.click();
    await expect(peopleTab).toHaveAttribute('aria-selected', 'true');
    // still exactly one "Late" participant after the reload (same session token)
    await expect(a.getByRole('list', { name: 'Participants' }).getByText('Late', { exact: true })).toHaveCount(1);
  });

  test('mobile viewport stacks the player above the sidebar', async ({ browser }) => {
    const { code } = await createRoomViaApi();
    const p = await joinAs(browser, code, 'Phone', { width: 390, height: 844 });
    const player = await p.getByRole('region', { name: 'Player' }).boundingBox();
    const sidebar = await p.getByRole('complementary', { name: 'Room sidebar' }).boundingBox();
    expect(player && sidebar && sidebar.y > player.y).toBeTruthy();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });
});

test('discover: typo-tolerant search', async ({ page }) => {
  await page.goto('/discover');
  await page.getByLabel('Search movies').fill('intersteller');
  await expect(page.locator('#hit-0')).toContainText('Interstellar');
});
