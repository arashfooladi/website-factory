import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const credentials = JSON.parse(readFileSync('.runtime/credentials.json', 'utf8'));
const wp = (...args) => execFileSync('tools/wp', args, { encoding: 'utf8', timeout: 60_000 }).trim();

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
});

test('runtime loads the child, Iran plugin and real product types', async () => {
  const state = JSON.parse(wp('eval', `echo wp_json_encode(array(
    'template' => get_template(), 'child' => get_stylesheet(), 'rtl' => is_rtl(),
    'commerce' => defined('MAINTHEME_IR_COMMERCE_VERSION'),
    'simple' => wc_get_product(get_option('factory_baseline_fixture')['products']['factory-simple'])->get_type(),
    'variable' => wc_get_product(get_option('factory_baseline_fixture')['products']['factory-variable'])->get_type(),
    'out_of_stock' => wc_get_product(get_option('factory_baseline_fixture')['products']['factory-out-of-stock'])->is_in_stock()
  ));`));
  expect(state).toEqual({ template: 'maintheme', child: 'maintheme-child-starter', rtl: true,
    commerce: true, simple: 'simple', variable: 'variable', out_of_stock: false });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`RTL storefront and product render at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const route of ['/', '/shop/', '/product/factory-simple/']) {
      const response = await page.goto(route, { waitUntil: 'networkidle' });
      expect(response.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('main').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      if (route.includes('/product/')) {
        await expect(page.locator('.single_add_to_cart_button')).toBeVisible();
        await expect(page.locator('h1').first()).toContainText('محصول ساده آزمایشی');
      }
      const path = info.outputPath(`${route.replaceAll('/', '_') || 'home'}.png`);
      await page.screenshot({ path, fullPage: true });
      await info.attach(`page-${route}`, { path, contentType: 'image/png' });
    }
    expect(errors).toEqual([]);
  });
}

test('WordPress administration is accessible with the fixture account', async ({ page }) => {
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(credentials.admin_user);
  await page.locator('#user_pass').fill(credentials.admin_password);
  await page.locator('#wp-submit').click();
  await page.waitForURL('**/wp-admin/**');
  await page.goto('/wp-admin/edit.php?post_type=product');
  await expect(page.locator('#wpbody-content')).toContainText('محصول ساده آزمایشی');
  await expect(page.locator('#wpbody-content')).toContainText('محصول متغیر آزمایشی');
});

test('variable products select a real variation and unavailable products cannot be purchased', async ({ page }) => {
  await page.goto('/product/factory-variable/');
  await page.locator('form.variations_form select').selectOption({ label: 'کوچک' });
  await expect(page.locator('input[name="variation_id"]')).toHaveValue(/^[1-9]\d*$/);
  await expect(page.locator('.single_add_to_cart_button')).toBeEnabled();
  await page.goto('/product/factory-out-of-stock/');
  await expect(page.locator('.stock.out-of-stock')).toBeVisible();
  await expect(page.locator('.single_add_to_cart_button')).toHaveCount(0);
});

test('a real storefront checkout creates the correct local COD order', async ({ page }) => {
  await page.goto('/product/factory-simple/');
  await page.locator('.single_add_to_cart_button').click();
  await page.goto('/checkout/');
  await expect(page.locator('form.checkout')).toBeVisible();
  const email = `factory-${Date.now()}@example.test`;
  await page.locator('#billing_first_name').fill('آزمایش');
  await page.locator('#billing_last_name').fill('کارخانه');
  await page.locator('#billing_email').fill(email);
  await page.locator('#billing_phone').fill('09123456789');
  await page.locator('#billing_state').selectOption('THR');
  await page.locator('#billing_city').fill('تهران');
  await page.locator('#billing_address_1').fill('نشانی آزمایشی، پلاک ۱');
  await page.locator('#billing_postcode').fill('1234567890');
  const differentAddress = page.locator('#ship-to-different-address-checkbox');
  if (await differentAddress.count()) await differentAddress.uncheck();
  const terms = page.locator('#terms');
  if (await terms.count()) await terms.check();
  await expect(page.locator('#payment_method_cod')).toBeChecked();
  await expect(page.locator('.blockUI.blockOverlay')).toHaveCount(0);
  await page.locator('#place_order').click();
  await page.waitForURL(/order-received/, { timeout: 60_000 });
  const orderId = page.url().match(/order-received\/(\d+)/)[1];
  const order = JSON.parse(wp('eval', `$o = wc_get_order(${Number(orderId)}); echo wp_json_encode(array(
    'status' => $o->get_status(), 'payment' => $o->get_payment_method(), 'total' => $o->get_total(),
    'shipping' => $o->get_shipping_total(), 'email' => $o->get_billing_email(), 'phone' => $o->get_billing_phone(),
    'items' => count($o->get_items())
  ));`));
  expect(order).toMatchObject({ status: 'processing', payment: 'cod', total: '300000', shipping: '50000',
    email, phone: '09123456789', items: 1 });
});
