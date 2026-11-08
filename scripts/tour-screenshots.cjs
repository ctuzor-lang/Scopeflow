const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP demo.test 127.0.0.1:3100, MAP bright.test 127.0.0.1:3100'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  // Local test over plain http: let the browser keep the production (Secure) cookies.
  const unsecure = async (c) => c.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    const host = u.host; u.host = '127.0.0.1:3100';
    const r = await route.fetch({ url: u.toString(), headers: { ...route.request().headers(), host }, maxRedirects: 0 });
    const headers = { ...r.headers() };
    const sc = r.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.replace(/;\s*Secure/i, ''));
    delete headers['set-cookie'];
    await route.fulfill({ response: r, headers: sc.length ? { ...headers, 'set-cookie': sc.join('\n') } : headers });
  });
  await unsecure(ctx);
  const pg = await ctx.newPage();
  const log = (...a) => console.log(...a);
  const bar = async () => (await pg.locator('.demobar-step').innerText().catch(() => '(no bar)')).replace(/\s+/g, ' ');
  const shot = async (name, sel) => {
    await pg.addStyleTag({ content: '.demobar{display:none!important}' });
    if (sel) { await pg.locator(sel).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24)); }
    else await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.waitForTimeout(200);
    await pg.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 });
    await pg.reload(); // drop the injected style
  };
  await pg.goto('http://demo.test/tour');
  await pg.screenshot({ path: '/tmp/shots/tour-top.png', fullPage: true });
  await pg.getByRole('button', { name: /Try it yourself/ }).first().click();
  await pg.waitForURL(/changes\?welcome=1/);
  log('landed', pg.url().replace(/.*\/projects/, '/projects'), '|', await bar());
  await pg.screenshot({ path: '/tmp/shots/demo-welcome.png', fullPage: true });
  const P = pg.url().match(/projects\/([0-9a-f-]+)/)[1];
  await pg.goto(`http://demo.test/projects/${P}/changes`); await shot('agency-2');
  await pg.goto(`http://demo.test/projects/${P}/scope`); await shot('agency-1');
  // Step 1: switch to client and approve CR-001
  await pg.getByRole('button', { name: /Switch to the client view/ }).click();
  await pg.waitForURL(/portal\/changes/);
  log('client page', '|', await bar());
  await pg.goto('http://demo.test/portal'); await shot('client-2');
  await pg.goto(`http://demo.test/portal/changes/${P}/1`); await shot('client-3');
  await shot('client-4', 'h2:has-text("Your decision")');
  await pg.locator('input[name=authority]').check();
  await pg.getByRole('button', { name: /Approve assessment/ }).click();
  await pg.waitForTimeout(1500); await pg.reload();
  await shot('client-5', 'text=Decision record');
  log('after approve', '|', await bar());
  // Step 2: agency puts it into scope
  await pg.getByRole('button', { name: /Switch to the consultancy view/ }).click();
  await pg.waitForURL(/scope/);
  log('scope', '|', await bar());
  await pg.getByRole('link', { name: 'Card payments through one provider' }).click();
  await pg.waitForURL(/items/);
  await pg.locator('input[name=title]').fill('Card payments and Apple Pay through one provider');
  await pg.getByRole('button', { name: /Save/ }).first().click();
  await pg.waitForTimeout(1500);
  await pg.goto(`http://demo.test/projects/${P}/scope`);
  await pg.locator('input[name=confirm]').check();
  await pg.getByRole('button', { name: /Publish version 2/ }).click();
  await pg.waitForTimeout(2000);
  log('after v2', '|', await bar());
  await pg.goto(`http://demo.test/projects/${P}/versions/2`); await shot('agency-5');
  // Step 3: assess CR-002
  await pg.goto(`http://demo.test/projects/${P}/changes/2`);
  await pg.locator('label.check:has-text("CP-02")').first().click().catch(() => log('no CP-02 box'));
  await pg.locator('textarea[name=scopeChange]').fill('Add a gift-wrap option and a gift message (up to 200 characters) at checkout, shown on the packing slip.');
  await pg.locator('input[name=effortMinDays]').fill('3');
  await pg.locator('input[name=effortMaxDays]').fill('4');
  await pg.locator('input[name=price]').fill('2,900');
  await pg.locator('input[name=scheduleDays]').fill('2');
  await pg.locator('select[name=pricingBasis]').selectOption('fixed');
  await pg.getByRole('button', { name: /Save assessment/ }).click();
  await pg.waitForTimeout(1500); await pg.reload();
  await pg.screenshot({ path: '/tmp/shots/cr2-debug.png', fullPage: true }); await shot('agency-3', 'text=Impact assessment');
  await pg.locator('aside input[name=confirm]').check();
  await pg.getByRole('button', { name: /Publish R1/ }).click();
  await pg.waitForTimeout(1500); await pg.reload();
  await shot('agency-4');
  log('after send', '|', await bar());
  await pg.screenshot({ path: '/tmp/shots/demo-cr2-sent.png', fullPage: true });
  // Mobile look at the demo
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
  const mp = await m.newPage(); await mp.goto(`http://demo.test/projects/${P}/changes`); await mp.screenshot({ path: '/tmp/shots/demo-mobile.png', fullPage: true });
  // client-1: a real workspace's branded sign-in page
  const c2 = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const lp = await c2.newPage(); await lp.goto('http://bright.test/login');
  await lp.screenshot({ path: `${OUT}/client-1.jpg`, type: 'jpeg', quality: 82 });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
