import { test, expect } from '@playwright/test';

test('home loads and shows app name', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toContainText('Fab Anything');
});

test('locale switch persists', async ({ page }) => {
  await page.goto('/');
  await page.locator('select[aria-label="Language"]').selectOption('zh-Hant');
  await expect(page.locator('body')).toContainText('商品目錄');
});
