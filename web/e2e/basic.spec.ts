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

test('guests can check out without creating an account', async ({ page }) => {
  // Seed a guest cart + location straight into persisted stores so no login is needed.
  await page.addInitScript(() => {
    localStorage.setItem(
      'fab.location',
      JSON.stringify({ state: { selectedLocationId: '00000000-0000-0000-0000-000000000001' }, version: 0 })
    );
    localStorage.setItem(
      'fab.cart',
      JSON.stringify({
        state: {
          location_id: '00000000-0000-0000-0000-000000000001',
          items: [
            {
              kind: 'premade',
              product_id: '33333333-3333-3333-3333-000000000001',
              material_id: '11111111-1111-1111-1111-000000000001',
              quantity: 1,
              options: {},
            },
          ],
          coupon_code: null,
        },
        version: 0,
      })
    );
  });

  await page.goto('/checkout/');

  // The contact form is available to guests — no sign-in wall.
  await expect(page.getByPlaceholder('Name')).toBeVisible();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByText('Please sign in', { exact: false })).toHaveCount(0);

  // Filling contact details unlocks payment for a guest.
  await page.getByPlaceholder('Name').fill('Guest Shopper');
  await page.getByPlaceholder('Email').fill('guest@example.com');
  await expect(page.getByRole('button', { name: 'Pay with Stripe' })).toBeEnabled();
});
