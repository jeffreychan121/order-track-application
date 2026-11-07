import { expect, test, type Page } from '@playwright/test';

const shipmentA = { id: 101, tracking_group: 'Shipment A', carrier: 'Australia Post', carrier_id: 1, tracking_number: 'AA001', shipping_fee: '0.00', shipping_quote_status: 'not_quoted', order_line_ids: [11], related_skus: ['SKU-A'], packages: [], origin: null, destination: null };
const shipmentB = { id: 102, tracking_group: 'Shipment B', carrier: 'Australia Post', carrier_id: 1, tracking_number: 'BB002', shipping_fee: '12.00', shipping_quote_status: 'quoted', order_line_ids: [12], related_skus: ['SKU-B'], packages: [{ weight_gross_g: 2300, length_mm: 200, width_mm: 150, height_mm: 120 }], origin: null, destination: null };
const lineA = { id: 11, sku: 'SKU-A', product_name: 'Alpha', description: '', quantity: 2, tracking_group: 'Shipment A', rrp_incl_gst: '22.00', gst_rate_percent: '10.00', ex_gst_unit_price: '20.00', line_subtotal_ex_gst: '40.00', currency: 'AUD', product_weight_g: 250 };
const lineB = { id: 12, sku: 'SKU-B', product_name: 'Beta', description: '', quantity: 3, tracking_group: 'Shipment B', rrp_incl_gst: '33.00', gst_rate_percent: '10.00', ex_gst_unit_price: '30.00', line_subtotal_ex_gst: '90.00', currency: 'AUD', product_weight_g: 500 };
const order = { id: 7, order_id: 'PO-20251130-00072', order_date: '2025-11-30', status: 'draft', company_name: 'V22 Dispensary', customer: { name: 'Jason Hu', phone: '0400000000', email: 'jason@example.com' }, shipping_address: { street: '1 Test Rd', suburb: 'Ryde', state: 'NSW', postcode: '2111', country: 'Australia' }, line_items: [lineA, lineB], shipments: [shipmentA, shipmentB], summary: { currency: 'AUD', subtotal_ex_gst: '130.00', gst_rate: '10.00%', gst_amount: '13.00', shipment_fee: '12.00', total: '155.00' } };
const transitOrder = { ...order, id: 8, order_id: 'PO-20251203-00046', order_date: '2025-12-03', status: 'in_transit', company_name: 'Cann Life Dispensary', customer: { name: 'Bella Dari', phone: '0411547288', email: 'bella@example.com' }, summary: { currency: 'AUD', subtotal_ex_gst: '1504.55', gst_rate: '10.00%', gst_amount: '150.45', shipment_fee: '0.00', total: '1655.00' } };
const carriers = [{ id: 1, code: 'AP', name: 'Australia Post', description: '', is_active: true, integration_type: 'AUSTRALIA_POST', rate_capability: 'SUPPORTED', tracking_capability: 'SUPPORTED', used: true }];
const pricingAccounts = [{ id: 'test-eparcel', label: 'Test eParcel Account', account_number_masked: '••••0001', environment: 'test', enabled: true, pricing_enabled: true, default_for_pricing: true, configured: true }];

async function mockApi(page: Page) {
  let carrierRows = carriers.map(item => ({ ...item }));
  let currentOrder = structuredClone(order);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    // Planner 和 API 测试页需要服务端账号档案；E2E 使用合成账号，不调用承运商。
    if (url.pathname === '/api/shipping/accounts' && route.request().method() === 'GET') return route.fulfill({ json: pricingAccounts });
    if (/^\/api\/shipping\/accounts\/[^/]+\/products$/.test(url.pathname)) return route.fulfill({ json: { account: { id: 'test-eparcel', label: 'Test eParcel Account', account_number_masked: '••••0001', environment: 'test', locations: [] }, products: [] } });
    if (url.pathname === '/api/orders' && route.request().method() === 'GET') return route.fulfill({ json: [order, transitOrder] });
    if (url.pathname === '/api/products') return route.fulfill({ json: [] });
    if (url.pathname === `/api/orders/${order.order_id}/status` && route.request().method() === 'PATCH') { currentOrder = { ...currentOrder, status: route.request().postDataJSON().status }; return route.fulfill({ json: currentOrder }); }
    if (url.pathname === `/api/orders/${order.order_id}`) return route.fulfill({ json: currentOrder });
    if (url.pathname === '/api/shipments/101' && route.request().method() === 'PATCH') { currentOrder = { ...currentOrder, shipments: currentOrder.shipments.map(item => item.id === 101 ? { ...item, tracking_number: route.request().postDataJSON().tracking_number } : item) }; return route.fulfill({ json: currentOrder }); }
    if (url.pathname === '/api/carriers' && route.request().method() === 'GET') return route.fulfill({ json: carrierRows });
    if (url.pathname === '/api/carriers/1' && route.request().method() === 'PATCH') { carrierRows = carrierRows.map(item => ({ ...item, ...route.request().postDataJSON() })); return route.fulfill({ json: carrierRows[0] }); }
    if (url.pathname === `/api/orders/${order.order_id}/tracking`) return route.fulfill({ json: order.shipments.map(item => ({ carrier: item.carrier, tracking_number: item.tracking_number, overall_status: 'unavailable', tracking_error: 'offline', consignment_events: [], articles: [] })) });
    if (url.pathname.endsWith('/quotes/preview')) return route.fulfill({ json: { rates: [{ quote_id: 'quote-1', service_name: 'Parcel Post', product_id: 'P1', shipping_cost: '9.00', fuel_surcharge: '0.00', gst: '0.90', total_cost: '9.90' }] } });
    if (url.pathname.endsWith('/quotes/apply')) return route.fulfill({ json: { ...order, summary: { ...order.summary, shipment_fee: '9.90', total: '152.90' }, shipments: [{ ...shipmentA, shipping_fee: '9.90', shipping_quote_status: 'quoted' }, shipmentB] } });
    if (url.pathname === '/api/orders/tracking') return route.fulfill({ json: { carrier: 'Australia Post', tracking_number: 'AA001', overall_status: 'unavailable', tracking_error: 'offline', consignment_events: [], articles: [] } });
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => mockApi(page));

test('new order lines stay unassigned instead of inheriting the first Shipment', async ({ page }) => {
  let savedBody: Record<string, any> | undefined;
  const sameShipmentOrder = {
    ...order,
    shipments: [shipmentA],
    line_items: [lineA, { ...lineB, tracking_group: 'Shipment A' }],
  };
  await page.route(`**/api/orders/${order.order_id}`, route => {
    if (route.request().method() === 'PATCH') savedBody = route.request().postDataJSON();
    return route.fulfill({ json: sameShipmentOrder });
  });
  await page.route('**/api/products', route => route.fulfill({ json: [{ sku: 'SKU-C', name: 'Gamma', description: '', rrp_incl_gst: '44.00', weight_g: 300 }] }));

  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Add Product' }).click();
  const productSearch = page.getByRole('combobox', { name: 'Search SKU or product' });
  await productSearch.fill('SKU-C');
  await page.getByRole('option', { name: 'SKU-C · Gamma' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => savedBody).toBeTruthy();
  expect(savedBody!.line_items.find(line => line.sku === 'SKU-A')?.tracking_group).toBe('Shipment A');
  expect(savedBody!.line_items.find(line => line.sku === 'SKU-B')?.tracking_group).toBe('Shipment A');
  expect(savedBody!.line_items.find(line => line.sku === 'SKU-C')?.tracking_group).toBeNull();
});

test('Order Lines hide Shipment assignment and keep table headers aligned with row cells', async ({ page }) => {
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('button', { name: 'Edit' }).click();
  const table = page.locator('.order-lines-table');
  await page.screenshot({ path: 'test-results/order-lines-alignment.png' });
  await expect(table.getByRole('columnheader', { name: 'Shipment', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Shipment for SKU-A')).toHaveCount(0);
  const headers = table.locator('thead th');
  const cells = table.locator('tbody tr').first().locator('td');
  // 订单行新增 Assigned Tracking、GST 税率和含税总计列，断言同步覆盖整行。
  await expect(headers).toHaveCount(9);
  for (let index = 0; index < 9; index += 1) {
    const header = await headers.nth(index).boundingBox();
    const cell = await cells.nth(index).boundingBox();
    expect(header && cell).toBeTruthy();
    expect(Math.abs(header!.x - cell!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(header!.width - cell!.width)).toBeLessThanOrEqual(1);
    const headerAlign = await headers.nth(index).evaluate(element => getComputedStyle(element).textAlign);
    const cellAlign = await cells.nth(index).evaluate(element => getComputedStyle(element).textAlign);
    expect(headerAlign).toBe(cellAlign);
  }
  expect(await headers.nth(2).evaluate(element => getComputedStyle(element).textAlign)).toBe('center');
  expect(await headers.nth(3).evaluate(element => getComputedStyle(element).textAlign)).toBe('right');
});

test('orders and historical order detail retain independent line totals', async ({ page }) => {
  await page.goto('/orders');
  await expect(page.getByText('PO-20251130-00072')).toBeVisible();
  await expect(page.getByText('PO-20251203-00046')).toBeVisible();
  await page.getByText('PO-20251130-00072').click();
  await expect(page.getByText('SKU-A', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('A$40.00')).toBeVisible();
  await expect(page.getByText('GST', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/assessment-order-detail.png', fullPage: true });
});

test('orders search, filters, and create action align in one desktop toolbar row', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/orders');
  const toolbar = page.locator('.orders-list-toolbar');
  const controls = [
    toolbar.locator(':scope > .MuiTextField-root'),
    toolbar.locator(':scope > .MuiFormControl-root:not(.MuiTextField-root)').nth(0),
    toolbar.locator(':scope > .MuiFormControl-root:not(.MuiTextField-root)').nth(1),
    toolbar.getByRole('button', { name: 'Create' }),
  ];
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  const verticalCenters = boxes.map(box => box!.y + box!.height / 2);
  expect(verticalCenters.every(center => Math.abs(center - verticalCenters[0]) <= 1)).toBe(true);
  expect(boxes[0]!.width).toBeGreaterThan(boxes[1]!.width * 2);
  expect(boxes[3]!.x).toBeGreaterThan(boxes[2]!.x);
  await page.screenshot({ path: 'test-results/orders-toolbar-layout.png' });
});

test('API request logs include lifecycle and a correlatable request ID', async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  const requestIds: string[] = [];
  page.on('request', request => {
    const requestId = request.headers()['x-request-id'];
    if (request.url().includes('/api/')) requestIds.push(requestId);
  });
  page.on('console', async message => {
    if (message.text().startsWith('[api]')) {
      const fields = await message.args()[1]?.jsonValue().catch(() => null);
      if (fields) events.push(fields);
    }
  });
  await page.goto('/orders');
  await expect(page.getByText('PO-20251130-00072')).toBeVisible();
  await expect.poll(() => events.some(event => event.event === 'request_completed')).toBe(true);
  const started = events.find(event => event.event === 'request_started');
  const completed = events.find(event => event.event === 'request_completed');
  expect(started?.request_id).toBeTruthy();
  expect(completed?.request_id).toBe(started?.request_id);
  expect(started?.method).toBe('GET');
  expect(requestIds).toContain(started?.request_id);
});

test('confirmed orders allow saving Shipment tracking numbers and reverting to draft', async ({ page }) => {
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('button', { name: 'Mark Confirmed' }).click();
  await expect(page.getByRole('button', { name: 'Revert to Draft' })).toBeVisible();
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await expect(page.getByRole('button', { name: 'Calculate Shipping' }).first()).toBeDisabled();
  const trackingField = page.getByLabel('Tracking Number').first();
  await expect(trackingField).toBeEnabled();
  await trackingField.fill('AA-UPDATED');
  await page.getByRole('button', { name: 'Save Tracking' }).first().click();
  await expect(trackingField).toHaveValue('AA-UPDATED');
  await page.getByRole('button', { name: 'Revert to Draft' }).click();
  const confirmRevert = page.getByRole('dialog').last();
  await expect(confirmRevert.getByText('This will move the order back to Draft')).toBeVisible();
  await confirmRevert.getByRole('button', { name: 'Revert to Draft' }).click();
  await expect(page.getByRole('button', { name: 'Mark Confirmed' })).toBeVisible();
});

test('sidebar navigation keeps the API Testing group open for direct routes', async ({ page }) => {
  await page.goto('/shipping-rates');
  await expect(page.getByText('Aeris Health', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Shipping Rates' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'API Testing' })).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Shipping Rates' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Tracking' })).toBeVisible();
});

test('collapsed sidebar can expand API Testing and navigate to a child route', async ({ page }) => {
  await page.goto('/orders');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('link', { name: 'Tracking' })).toHaveCount(0);
  await page.getByRole('button', { name: 'API Testing' }).click();
  await expect(page.getByRole('link', { name: 'Tracking' })).toBeVisible();
  await page.getByRole('link', { name: 'Tracking' }).click();
  await expect(page).toHaveURL(/\/tracking$/);
  await expect(page.getByRole('link', { name: 'Tracking' })).toHaveAttribute('aria-current', 'page');
});

test('mobile navigation uses an overlay drawer and closes after selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/orders');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('link', { name: 'Carriers' })).toBeVisible();
  await page.getByRole('link', { name: 'Carriers' }).click();
  await expect(page).toHaveURL(/\/carriers$/);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Carriers' })).not.toBeVisible();
});

test('Shipment cards use a compact two-column desktop layout and stack on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  const grid = page.locator('.shipments-grid');
  await expect(grid.locator('.shipment-card')).toHaveCount(2);
  const desktopColumns = await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(desktopColumns).toBe(2);
  await page.screenshot({ path: 'test-results/shipment-cards-layout.png' });

  await page.setViewportSize({ width: 900, height: 1000 });
  const narrowColumns = await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(narrowColumns).toBe(1);
});

test('Shipment status and actions stay at the card top-right with clear status colors', async ({ page }) => {
  await page.route(`**/api/orders/${order.order_id}/tracking*`, route => route.fulfill({ json: [
    { carrier: 'Australia Post', tracking_number: 'AA001', overall_status: 'Delivered in Full', overall_status_raw: 'delivered', last_updated: '2025-01-10T09:09:49+11:00', consignment_events: [], articles: [] },
    { carrier: 'Australia Post', tracking_number: 'BB002', overall_status: 'Not queried', consignment_events: [], articles: [] },
  ] }));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  const deliveredCard = page.locator('.shipment-card').filter({ hasText: 'AA001' });
  const deliveredChip = deliveredCard.locator('.shipment-card-status .MuiChip-root');
  await expect(deliveredChip).toHaveText('Delivered');
  await expect(deliveredChip).toHaveClass(/MuiChip-filled.*MuiChip-colorSuccess/);
  const deliveredHeader = deliveredCard.locator('.shipment-card-heading');
  const deliveredStatus = await deliveredCard.locator('.shipment-card-status').boundingBox();
  const deliveredMenu = await deliveredCard.getByRole('button', { name: 'More actions for Shipment 101' }).boundingBox();
  const deliveredHeaderBox = await deliveredHeader.boundingBox();
  expect(deliveredStatus && deliveredMenu && deliveredHeaderBox).toBeTruthy();
  expect(deliveredStatus!.x).toBeGreaterThan(deliveredHeaderBox!.x + deliveredHeaderBox!.width / 2);
  expect(deliveredMenu!.x + deliveredMenu!.width).toBeLessThanOrEqual(deliveredHeaderBox!.x + deliveredHeaderBox!.width + 1);

  const pendingChip = page.locator('.shipment-card').filter({ hasText: 'BB002' }).locator('.shipment-card-status .MuiChip-root');
  await expect(pendingChip).toHaveText('Not queried');
  await expect(pendingChip).toHaveClass(/MuiChip-filled.*MuiChip-colorInfo/);
  await page.screenshot({ path: 'test-results/shipment-status-emphasis.png' });
});

test('order and Shipment layout stays within the requested viewport widths', async ({ page }) => {
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/orders/${order.order_id}`);
    await page.getByRole('tab', { name: 'Shipments' }).click();
    const viewportMetrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(viewportMetrics.page, `horizontal page overflow at ${width}px`).toBeLessThanOrEqual(viewportMetrics.viewport + 1);

    const cards = page.locator('.shipment-card');
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) {
      const bounds = await card.boundingBox();
      expect(bounds, `Shipment card missing at ${width}px`).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    }
  }
});

test('order actions stay left and the status bar stays right at tablet width with matching height', async ({ page }) => {
  await page.setViewportSize({ width: 754, height: 853 });
  await page.goto(`/orders/${order.order_id}`);
  const toolbar = page.locator('.order-form-toolbar');
  const action = page.getByRole('button', { name: 'Mark Confirmed' });
  const status = page.getByLabel('Order status: Draft');
  const toolbarBox = await toolbar.boundingBox();
  const actionBox = await action.boundingBox();
  const statusBox = await status.boundingBox();
  expect(toolbarBox && actionBox && statusBox).toBeTruthy();
  expect(statusBox!.x).toBeGreaterThan(actionBox!.x + actionBox!.width);
  expect(Math.abs(statusBox!.x + statusBox!.width - (toolbarBox!.x + toolbarBox!.width))).toBeLessThanOrEqual(2);
  expect(Math.abs(statusBox!.height - actionBox!.height)).toBeLessThanOrEqual(1);
});

test('application routes and planner emit no browser console warnings or errors', async ({ page }) => {
  const warnings = new Map<string, string>();
  page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error') {
      const text = message.text();
      const propWarning = text.match(/\.\%s ([A-Za-z][A-Za-z0-9_]*) [a-z]+ /);
      const key = propWarning ? `unknown-dom-prop:${propWarning[1]}` : text.split('\n')[0];
      warnings.set(key, text.slice(0, 700));
    }
  });
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await page.getByRole('button', { name: 'Calculate Shipping' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  for (const path of ['/products', '/carriers', '/tracking', '/shipping-rates']) await page.goto(path);
  expect([...warnings.keys()]).toEqual([]);
});

test('planner discard confirmation uses the shared MUI dialog', async ({ page }) => {
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await page.locator('.shipment-card').first().getByRole('button', { name: 'Calculate Shipping' }).click();
  const planner = page.getByRole('dialog').first();
  await planner.getByLabel('Length cm').fill('23');
  await planner.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Discard unsaved changes to this Shipment plan?')).toBeVisible();
  await page.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('A$12.00', { exact: true })).toBeVisible();
});

test('planner derives selected shipment weight, clears stale quotes, and keeps drafts isolated', async ({ page }) => {
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await page.locator('.shipment-card').first().getByRole('button', { name: 'Calculate Shipping' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Shipment 101 · Australia Post' }).click();
  const firstLine = dialog.getByRole('checkbox').first();
  await firstLine.uncheck();
  await expect(dialog.getByLabel('Gross Weight kg')).toHaveValue('');
  await firstLine.check();
  await expect(dialog.getByLabel('Gross Weight kg')).toHaveValue('0.500');
  await page.screenshot({ path: 'test-results/shipping-planner-layout.png' });
  await dialog.getByLabel('Length cm').fill('20');
  await dialog.getByLabel('Width cm').fill('15');
  await dialog.getByLabel('Height cm').fill('12');
  await page.route('**/api/shipping/orders/**/quotes/preview', async route => {
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ json: { rates: [{ quote_id: 'quote-1', service_name: 'Parcel Post', product_id: 'P1', shipping_cost: '9.00', fuel_surcharge: '0.00', gst: '0.90', total_cost: '9.90' }] } });
  });
  await dialog.getByRole('button', { name: 'Get Rates' }).click();
  await expect(dialog.getByRole('button', { name: 'Getting Rates…' })).toBeDisabled();
  await expect(dialog.getByText('Parcel Post')).toBeVisible();
  await dialog.getByLabel('Gross Weight kg').fill('0.750');
  await expect(dialog.getByText('Parcel Post')).toHaveCount(0);
  await dialog.getByText('Shipment 102 · Australia Post').click();
  await expect(dialog.getByLabel('Gross Weight kg')).toHaveValue('2.3');
  await dialog.getByRole('button', { name: 'Shipment 101 · Australia Post' }).click();
  await expect(dialog.getByLabel('Gross Weight kg')).toHaveValue('0.750');
  await dialog.getByRole('button', { name: 'Get Rates' }).click();
  await dialog.getByRole('radio').check();
  await dialog.getByRole('button', { name: 'Apply Shipping Fee' }).click();
  await expect(page.getByText('A$9.90').first()).toBeVisible();
});

test('shipping API errors keep planner values available for correction and retry', async ({ page }) => {
  await page.route('**/api/shipping/orders/**/quotes/preview', route => route.fulfill({ status: 503, json: { detail: 'Carrier service temporarily unavailable' } }));
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await page.locator('.shipment-card').first().getByRole('button', { name: 'Calculate Shipping' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Shipment 101 · Australia Post' }).click();
  await dialog.getByLabel('Length cm').fill('24');
  await dialog.getByLabel('Width cm').fill('16');
  await dialog.getByLabel('Height cm').fill('10');
  await dialog.getByRole('button', { name: 'Get Rates' }).click();
  await expect(dialog.getByText('Carrier service temporarily unavailable')).toBeVisible();
  await expect(dialog.getByLabel('Length cm')).toHaveValue('24');
});

test('tracking failure is presented as unavailable without breaking order details', async ({ page }) => {
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await page.getByRole('button', { name: 'View Details' }).first().click();
  await expect(page.getByText(/unavailable|offline/i).first()).toBeVisible();
});

test('missing tracking number uses a transient MUI notification', async ({ page }) => {
  const orderWithoutTracking = structuredClone(order);
  orderWithoutTracking.shipments[0].tracking_number = '';
  await page.route(`**/api/orders/${order.order_id}`, route => route.fulfill({ json: orderWithoutTracking }));
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await page.getByRole('button', { name: 'More actions for Shipment 101' }).click();
  await page.getByRole('menuitem', { name: 'Refresh Tracking' }).click();
  const notification = page.locator('.MuiSnackbar-root').getByRole('alert');
  await expect(notification).toHaveText('Enter a tracking number before querying this shipment.');
  await expect(notification).toBeVisible();
  await expect(page.locator('.order-form-toolbar + .MuiAlert-root')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/tracking-notification.png' });
});

test('tracking drawer wraps long article identifiers without overlapping status', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const trackingResult = {
    carrier: 'Australia Post', tracking_number: 'AA001', overall_status: 'Delivered in Full',
    total_articles: 1, delivered_articles: 1, last_updated: '2025-02-13T11:49:59+11:00',
    consignment_events: [], articles: [{
      article_id: '2FWZ50008569EXP000002-EXTREMELY-LONG-ARTICLE-ID', raw_status: 'Item Delivered', product_type: 'EXP', events: [],
    }],
  };
  await page.route(`**/api/orders/${order.order_id}/tracking*`, route => route.fulfill({ json: [trackingResult] }));
  await page.route('**/api/orders/tracking', route => route.fulfill({ json: trackingResult }));
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await page.getByRole('button', { name: 'View Details' }).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  const drawerPaper = page.locator('.tracking-drawer-paper');
  const drawerBox = await drawerPaper.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(Math.abs(drawerBox!.width - 390)).toBeLessThanOrEqual(0.1);
  await expect.poll(async () => (await drawerPaper.boundingBox())?.x).toBe(0);
  const articleTitle = drawer.getByRole('heading', { name: /^Article 2FWZ/ });
  await expect(articleTitle).toBeVisible();
  await page.screenshot({ path: 'test-results/tracking-drawer-narrow.png' });
  const title = await articleTitle.boundingBox();
  const status = await drawer.locator('.tracking-article-card .MuiChip-root').boundingBox();
  expect(title && status).toBeTruthy();
  expect(status!.width).toBeGreaterThanOrEqual(96);
  expect(title!.x + title!.width).toBeLessThanOrEqual(status!.x + 1);
  const content = drawer.locator('.tracking-drawer-content');
  const dimensions = await content.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test('shipment detail dialog remains within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/orders/${order.order_id}`);
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await page.locator('.shipment-card').first().getByRole('button', { name: 'Calculate Shipping' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);
});

test('carrier row edit supports cancel without losing the saved value', async ({ page }) => {
  await page.goto('/carriers');
  await expect(page.getByRole('columnheader', { name: 'Rates' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Tracking' })).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: 'AP' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.locator('input[type="text"]').nth(1).fill('Australia Post Edited');
  await row.getByRole('button', { name: 'Cancel' }).click();
  await expect(row.getByText('Australia Post', { exact: true })).toBeVisible();
});

test('carrier row edit saves and reloads the persisted value', async ({ page }) => {
  await page.goto('/carriers');
  const row = page.getByRole('row').filter({ hasText: 'AP' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.locator('input[type="text"]').nth(1).fill('Australia Post Edited');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Australia Post Edited', { exact: true })).toBeVisible();
});
