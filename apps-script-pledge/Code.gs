/** @OnlyCurrentDoc */

/**
 * New Nest — pledge fund backend.
 *
 * Friends pledge any amount into one pot; the owner buys the items.
 *
 * The public page is a static site on GitHub Pages. This script is only its
 * JSON API. Apps Script cannot answer a CORS preflight, so the browser must
 * only ever send "simple" requests: GET, or POST with Content-Type text/plain.
 * That is why every mutation arrives as a text/plain JSON body on doPost.
 *
 * `Registry Items` is maintained by the older registry script bound to this
 * same spreadsheet. This one only reads it, to draw the inspiration grid.
 */

const REGISTRY_CONFIG = {
  itemsSheet: 'Registry Items',
  pledgesSheet: 'Pledges',
  pledgeDashboardSheet: 'Pledge Dashboard',
  pledgeConfigSheet: 'Pledge Config',
};

const ITEM_COLUMNS = [
  'id',
  'status',
  'category',
  'source_link',
  'vendor',
  'scraped_title',
  'display_name',
  'scraped_price',
  'display_price_sgd',
  'target_sgd',
  'scraped_image',
  'display_image',
  'description',
  'mode',
  'reserved_by',
  'remarks',
  'source_sheet',
  'source_row',
  'sort_order',
  'active',
  'last_enriched',
  'enrich_status',
  'enrich_error',
  'reference_title',
];
const PLEDGE_COLUMNS = [
  'timestamp',
  'pledge_id',
  'guest_name',
  'guest_email',
  'amount_sgd',
  'message',
  'reference_code',
  'status',
  'received_on',
  'received_amount_sgd',
  'thanked_on',
  'magic_token',
  'token_expires',
  'source',
  'notes',
  // A friend saying "I've sent it" is a claim, not a confirmation. It lives in
  // its own column and never touches `status`, which only the owner sets from
  // the bank statement.
  'claims_paid_on',
  'hide_name',
];

const PLEDGE_DASHBOARD_COLUMNS = [
  'Name',
  'Email',
  'Pledged SGD',
  'Status',
  'Reference',
  'Says Paid',
  'Days Outstanding',
  'Received On',
  'Received SGD',
  'Thanked',
  'Message',
  'Pledged On',
];

const PLEDGE_STATUSES = ['Pledged', 'Received', 'Cancelled'];

const PLEDGE_CONFIG_DEFAULTS = [
  ['goal_sgd', '5000', 'Total we are saving toward. Drives the progress bar.'],
  ['paynow_number', '', 'Your PayNow mobile number or UEN, shown next to the QR.'],
  ['paynow_name', '', 'Name that shows up in their banking app, so they know the transfer is right.'],
  ['paynow_qr_image_url', '', 'Public https:// link to your PayNow QR image. Leave blank to hide the QR.'],
  ['owner_email', '', 'Where owner notifications go. Blank = the account running the script.'],
  ['site_url', '', 'Public site address, e.g. https://stellassx94.github.io/xjq-new-nest/. Magic links in emails point here. Blank falls back to the raw Apps Script URL.'],
  ['couple_names', 'Stella & Jia Qi', 'Shown above the headline. Without this the page reads like a scam to anyone opening it cold.'],
  ['hero_photo_url', '', 'Optional public https:// link to a photo of the two of you. Nothing shows if blank.'],
  ['why_cash', 'We are still figuring out what the place needs, so we would rather buy things slowly and properly than end up with three kettles. If you would like to give something, this is the easiest way.', 'One or two sentences in your own voice about why money rather than things.'],
  ['site_password', 'xjq-bishan', 'Password for the page. The link you share carries it, so friends never see a login. Blank = no password at all.'],
  ['page_headline', 'Things for the New Nest', 'Big title on the page.'],
  ['page_subtext', 'Your company is the real gift. But if you would like to chip in toward the new place, here is the easiest way.', 'Warm line under the title.'],
  ['suggested_amounts', '50, 100, 200, 388', 'Comma-separated preset amounts on the pledge form.'],
  ['closed', 'FALSE', 'Set TRUE to stop accepting new pledges.'],
  ['closed_message', 'Pledges are closed now, thank you so much.', 'Shown when closed is TRUE.'],
  ['thank_you_message', '', 'Optional extra line added to thank-you emails.'],
];

const PLEDGE_TOKEN_TTL_DAYS = 30;
const MAX_THANK_YOU_PER_RUN = 40;
/**
 * The public site is a static page on GitHub Pages that calls this script as a
 * JSON API. Apps Script cannot answer a CORS preflight, so the browser must
 * only ever send "simple" requests: GET, or POST with Content-Type text/plain.
 * That is why every mutation arrives as a text/plain JSON body on doPost
 * rather than as a normal application/json request.
 */
function doGet(event) {
  const params = event && event.parameter ? event.parameter : {};

  if (params.api === 'registry') {
    return json_(getRegistryDataForClient(params.t, params.k));
  }

  if (params.api === 'me') {
    return json_(getMyPledgeForClient(params.t));
  }

  // The page itself lives on GitHub Pages; this script is only the API.
  // Anyone landing on the raw /exec URL gets forwarded there, carrying any
  // magic-link token with them.
  return redirectToSite_(params.t);
}

function redirectToSite_(token) {
  const site = safePublicUrl_(pledgeConfigValue_('site_url'));
  const cleanToken = cleanString_(token).replace(/[^A-Za-z0-9-]/g, '').slice(0, 120);

  if (!site) {
    return HtmlService.createHtmlOutput('<p>This is the registry backend. The page has not been linked yet.</p>');
  }

  const target = site.replace(/[?#].*$/, '').replace(/\/+$/, '')
    + '/' + (cleanToken ? '?t=' + encodeURIComponent(cleanToken) : '');

  return HtmlService
    .createHtmlOutput('<script>window.top.location.href = ' + JSON.stringify(target) + ';</script>'
      + '<p>Taking you to <a href="' + target + '" target="_top">the registry</a>…</p>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(event) {
  try {
    const body = parseBody_(event);
    const action = cleanString_(body.action).toLowerCase();

    if (action === 'pledge') return json_(submitPledgeForClient(body));
    if (action === 'link') return json_(requestPledgeLinkForClient(body.guest_email));
    if (action === 'me') return json_(getMyPledgeForClient(body.magic_token));
    if (action === 'cancel') return json_(cancelPledgeForClient(body.magic_token, body.pledge_id));
    if (action === 'amend') return json_(amendPledgeForClient(body.magic_token, body.pledge_id, body.amount_sgd));
    if (action === 'sent') return json_(markPledgeSentForClient(body.magic_token, body.pledge_id));
    if (action === 'unlock') return json_(unlockForClient(body.password));

    return json_({ ok: false, error: 'Unknown action.' });
  } catch (error) {
    return json_({ ok: false, error: publicError_(error) });
  }
}

/**
 * Public entry points. Reachable from the hosted Apps Script page via
 * google.script.run, and from the static site via doGet/doPost above.
 * Everything else in this file ends with `_` so it stays private.
 */
function getRegistryDataForClient(magicToken, key) {
  try {
    if (!keyMatches_(key)) {
      return { ok: false, locked: true, error: 'This page is for our friends. Please use the link we sent you.' };
    }
    return {
      ok: true,
      generated_at: new Date().toISOString(),
      registry: getPublicRegistryPayload_(),
      my_pledge: magicToken ? lookupPledgeByToken_(magicToken) : null,
    };
  } catch (error) {
    return { ok: false, error: publicError_(error) };
  }
}

/**
 * The password is checked here, never in the page, so it is not in the public
 * source. The shared link carries it as ?k=, so invited friends never meet a
 * login screen; only someone who finds the bare URL does.
 */
function keyMatches_(key) {
  const expected = pledgeConfigValue_('site_password');
  if (!expected) return true;
  return cleanString_(key) === expected;
}

function unlockForClient(password) {
  try {
    if (!keyMatches_(password)) {
      return { ok: false, error: 'That is not the password. Check the link we sent you.' };
    }
    return { ok: true, key: pledgeConfigValue_('site_password') };
  } catch (error) {
    return { ok: false, error: publicError_(error) };
  }
}

function amendPledgeForClient(magicToken, pledgeId, amount) {
  try {
    return amendPledge_(magicToken, pledgeId, amount);
  } catch (error) {
    return { ok: false, error: publicError_(error) };
  }
}

function markPledgeSentForClient(magicToken, pledgeId) {
  try {
    return markPledgeSent_(magicToken, pledgeId);
  } catch (error) {
    return { ok: false, error: publicError_(error) };
  }
}

function submitPledgeForClient(body) {
  try {
    return submitPledge_(body || {});
  } catch (error) {
    return { ok: false, error: publicError_(error) };
  }
}

function requestPledgeLinkForClient(email) {
  try {
    return requestMagicLink_(email);
  } catch (error) {
    // Never leak whether the address exists, even on failure.
    console.error('requestPledgeLink failed: ' + (error && error.message));
    return { ok: true, message: MAGIC_LINK_GENERIC_MESSAGE };
  }
}

function getMyPledgeForClient(magicToken) {
  try {
    return { ok: true, my_pledge: lookupPledgeByToken_(magicToken) };
  } catch (error) {
    return { ok: false, error: publicError_(error) };
  }
}

function cancelPledgeForClient(magicToken, pledgeId) {
  try {
    return cancelPledge_(magicToken, pledgeId);
  } catch (error) {
    return { ok: false, error: publicError_(error) };
  }
}

function publicError_(error) {
  const message = cleanString_(error && (error.message || error));
  return message || 'Something went wrong. Please try again.';
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('New Nest Pledges')
      .addItem('Refresh pledge dashboard', 'refreshPledgeDashboard_')
      .addItem('Send thank-you emails', 'sendThankYouEmailsFromMenu_')
      .addItem('Resend confirmation for selected row', 'resendConfirmationForSelectedRow_')
      .addSeparator()
      .addItem('Set up pledge tabs', 'setupPledgeSheets_')
      .addToUi();
  } catch (error) {
    // Spreadsheet UI is only available when opened as a sheet.
  }
}

function normalizeItem_(item) {
  return {
    id: cleanString_(item.id),
    name: cleanString_(item.display_name || item.scraped_title),
    reference_title: cleanString_(item.reference_title || item.scraped_title),
    description: cleanString_(item.description || item.remarks),
    price_sgd: cleanString_(item.display_price_sgd || item.scraped_price),
    link: safePublicUrl_(item.source_link),
    image: safePublicUrl_(item.display_image || item.scraped_image),
    sort_order: toNumberOrBlank_(item.sort_order),
    active: parseBoolean_(item.active) !== false,
    status: cleanString_(item.status),
    room: cleanString_(item.category),
    vendor: cleanString_(item.vendor),
  };
}

/* ------------------------------------------------------------------ *
 * Pledge fund
 *
 * Friends pledge any amount into one pot; the owner buys the items.
 * `Registry Items` still drives the browse-only inspiration grid.
 * ------------------------------------------------------------------ */

const MAGIC_LINK_GENERIC_MESSAGE = 'If that email has a pledge, we have just sent the link. Check your inbox (and spam).';

function setupPledgeSheets_() {
  const spreadsheet = getSpreadsheet_();
  const pledges = spreadsheet.getSheetByName(REGISTRY_CONFIG.pledgesSheet)
    || spreadsheet.insertSheet(REGISTRY_CONFIG.pledgesSheet);
  const dashboard = spreadsheet.getSheetByName(REGISTRY_CONFIG.pledgeDashboardSheet)
    || spreadsheet.insertSheet(REGISTRY_CONFIG.pledgeDashboardSheet);
  const config = spreadsheet.getSheetByName(REGISTRY_CONFIG.pledgeConfigSheet)
    || spreadsheet.insertSheet(REGISTRY_CONFIG.pledgeConfigSheet);

  ensureHeader_(pledges, PLEDGE_COLUMNS);
  pledges.setFrozenRows(1);
  applyPledgeStatusValidation_(pledges);
  seedPledgeConfig_(config);
  dashboard.setFrozenRows(4);

  return { ok: true };
}

function applyPledgeStatusValidation_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(cleanString_);
  const column = headers.indexOf('status') + 1;
  if (column <= 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(PLEDGE_STATUSES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1)).setDataValidation(rule);
}

function seedPledgeConfig_(sheet) {
  if (sheet.getLastRow() >= 1) {
    const firstCell = cleanString_(sheet.getRange(1, 1).getValue());
    if (firstCell === 'key') {
      const existing = new Set(sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
        .getValues()
        .map((row) => cleanString_(row[0]))
        .filter(Boolean));
      const missing = PLEDGE_CONFIG_DEFAULTS.filter((row) => !existing.has(row[0]));
      if (missing.length) {
        sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
      }
      return;
    }
  }

  sheet.getRange(1, 1, 1, 3).setValues([['key', 'value', 'what it does']]).setFontWeight('bold');
  sheet.getRange(2, 1, PLEDGE_CONFIG_DEFAULTS.length, 3).setValues(PLEDGE_CONFIG_DEFAULTS);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 420);
}

function pledgeConfig_() {
  const sheet = getSpreadsheet_().getSheetByName(REGISTRY_CONFIG.pledgeConfigSheet);
  const config = PLEDGE_CONFIG_DEFAULTS.reduce((acc, row) => {
    acc[row[0]] = row[1];
    return acc;
  }, {});
  if (!sheet || sheet.getLastRow() < 2) return config;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach((row) => {
    const key = cleanString_(row[0]);
    if (!key) return;
    config[key] = cleanString_(row[1]);
  });
  return config;
}

function pledgeConfigValue_(key) {
  try {
    return cleanString_(pledgeConfig_()[key]);
  } catch (error) {
    return '';
  }
}

function readPledges_() {
  return readSheetObjects_(REGISTRY_CONFIG.pledgesSheet, PLEDGE_COLUMNS).map(normalizePledge_);
}

function normalizePledge_(pledge) {
  return {
    timestamp: pledge.timestamp instanceof Date ? pledge.timestamp.toISOString() : cleanString_(pledge.timestamp),
    pledge_id: cleanString_(pledge.pledge_id),
    guest_name: cleanString_(pledge.guest_name),
    guest_email: cleanString_(pledge.guest_email).toLowerCase(),
    amount_sgd: Number(toNumberOrBlank_(pledge.amount_sgd)) || 0,
    message: cleanString_(pledge.message),
    reference_code: cleanString_(pledge.reference_code),
    status: pledgeStatus_(pledge.status),
    received_on: pledge.received_on instanceof Date ? pledge.received_on.toISOString() : cleanString_(pledge.received_on),
    received_amount_sgd: toNumberOrBlank_(pledge.received_amount_sgd),
    thanked_on: pledge.thanked_on instanceof Date ? pledge.thanked_on.toISOString() : cleanString_(pledge.thanked_on),
    magic_token: cleanString_(pledge.magic_token),
    token_expires: pledge.token_expires instanceof Date ? pledge.token_expires.toISOString() : cleanString_(pledge.token_expires),
    source: cleanString_(pledge.source),
    notes: cleanString_(pledge.notes),
    claims_paid_on: pledge.claims_paid_on instanceof Date ? pledge.claims_paid_on.toISOString() : cleanString_(pledge.claims_paid_on),
    hide_name: parseBoolean_(pledge.hide_name) === true && cleanString_(pledge.hide_name) !== '',
  };
}

function pledgeStatus_(value) {
  const text = cleanString_(value).toLowerCase();
  const match = PLEDGE_STATUSES.find((status) => status.toLowerCase() === text);
  return match || 'Pledged';
}

function countedAmount_(pledge) {
  if (pledge.status === 'Cancelled') return 0;
  if (pledge.status === 'Received') {
    const received = Number(pledge.received_amount_sgd);
    return isFinite(received) && received > 0 ? received : pledge.amount_sgd;
  }
  return pledge.amount_sgd;
}

/* ---------- public payload ---------- */

const PUBLIC_PAYLOAD_CACHE_KEY = 'public-payload-v2';
const PUBLIC_PAYLOAD_CACHE_SECONDS = 60;

/**
 * Every page load otherwise re-reads three sheets, which is most of the wait a
 * guest sees. Memoise the payload for a minute; any write clears it, so the
 * page never shows a stale total after someone pledges.
 */
function getPublicRegistryPayload_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PUBLIC_PAYLOAD_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      // Fall through and rebuild it.
    }
  }

  const payload = buildPublicRegistryPayload_();
  try {
    cache.put(PUBLIC_PAYLOAD_CACHE_KEY, JSON.stringify(payload), PUBLIC_PAYLOAD_CACHE_SECONDS);
  } catch (error) {
    // Payload too big to cache is not worth failing the request over.
    console.error('Could not cache payload: ' + (error && error.message));
  }
  return payload;
}

function clearPublicPayloadCache_() {
  try {
    CacheService.getScriptCache().remove(PUBLIC_PAYLOAD_CACHE_KEY);
  } catch (error) {
    // Nothing to do; the entry expires on its own within a minute.
  }
}

function buildPublicRegistryPayload_() {
  const config = pledgeConfig_();
  const pledges = readPledges_().filter((pledge) => pledge.status !== 'Cancelled');
  const pledged = pledges.reduce((sum, pledge) => sum + countedAmount_(pledge), 0);

  const items = readItemsSafely_();

  return {
    items,
    settings: {
      couple_names: config.couple_names,
      hero_photo_url: safePublicUrl_(config.hero_photo_url),
      why_cash: config.why_cash,
      headline: config.page_headline,
      subtext: config.page_subtext,
      goal_sgd: Number(numericAmount_(config.goal_sgd)) || 0,
      suggested_amounts: suggestedAmounts_(config.suggested_amounts),
      paynow_number: config.paynow_number,
      paynow_name: config.paynow_name,
      paynow_qr_image_url: safePublicUrl_(config.paynow_qr_image_url),
      closed: parseBoolean_(config.closed) === true && cleanString_(config.closed) !== '',
      closed_message: config.closed_message,
    },
    // How much has actually landed in the bank is the owner's business, not
    // the guests'. It stays in the sheet and never crosses the wire.
    totals: {
      pledged_sgd: pledged,
      pledge_count: pledges.length,
      // First names only, and only from people who did not opt out.
      // Amounts are never attributed publicly.
      names: pledges.filter((pledge) => !pledge.hide_name)
        .map((pledge) => firstName_(pledge.guest_name))
        .filter(Boolean),
    },
  };
}

/**
 * The inspiration grid is a nice-to-have. If `Registry Items` is missing or
 * mis-shaped, the pledge form must still work, so failures here are swallowed.
 */
function readItemsSafely_() {
  try {
    return readSheetObjects_(REGISTRY_CONFIG.itemsSheet, ITEM_COLUMNS, { repairHeaders: false })
      .map(normalizeItem_)
      .filter(isPublicItem_)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((item) => ({
        id: item.id,
        name: item.name,
        reference_title: item.reference_title,
        description: item.description,
        price_sgd: item.price_sgd,
        image: item.image,
        link: item.link,
        room: item.room,
        vendor: item.vendor,
      }));
  } catch (error) {
    console.error('Could not read ' + REGISTRY_CONFIG.itemsSheet + ': ' + (error && error.message));
    return [];
  }
}

function suggestedAmounts_(value) {
  return cleanString_(value)
    .split(',')
    .map((part) => Number(numericAmount_(part)))
    .filter((amount) => isFinite(amount) && amount > 0)
    .slice(0, 6);
}

function firstName_(value) {
  return cleanString_(value).split(/\s+/)[0] || '';
}

/* ---------- guest actions ---------- */

function submitPledge_(body) {
  setupPledgeSheets_();
  if (!keyMatches_(body.k)) throw new Error('This page is for our friends. Please use the link we sent you.');
  const config = pledgeConfig_();
  if (parseBoolean_(config.closed) === true && cleanString_(config.closed) !== '') {
    throw new Error(cleanString_(config.closed_message) || 'Pledges are closed.');
  }

  const name = capString_(body.guest_name, 80);
  const email = normalizeEmail_(body.guest_email);
  const amount = Number(body.amount_sgd);
  const message = capString_(body.message || '', 500);

  if (!name) throw new Error('Please tell us your name.');
  if (!email) throw new Error('Please enter a valid email address.');
  if (!isFinite(amount) || amount <= 0) throw new Error('Please enter an amount greater than zero.');
  if (amount > 100000) throw new Error('That amount looks like a typo. Please check it.');

  throttleByEmail_('pledge', email, 30);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(REGISTRY_CONFIG.pledgesSheet);
    const existing = readPledges_();
    const usedCodes = new Set(existing.map((pledge) => pledge.reference_code).filter(Boolean));
    const referenceCode = uniqueReferenceCode_(usedCodes);
    const token = Utilities.getUuid();
    const expires = tokenExpiryIso_();

    const record = {
      timestamp: new Date(),
      pledge_id: Utilities.getUuid(),
      guest_name: name,
      guest_email: email,
      amount_sgd: Math.round(amount * 100) / 100,
      message,
      reference_code: referenceCode,
      status: 'Pledged',
      received_on: '',
      received_amount_sgd: '',
      thanked_on: '',
      magic_token: token,
      token_expires: expires,
      source: 'web',
      notes: '',
      claims_paid_on: '',
      hide_name: parseBoolean_(body.hide_name) === true && cleanString_(body.hide_name) !== '' ? 'TRUE' : '',
    };

    // Reuse one token per email so an older link keeps working for this guest.
    const sameEmail = existing.filter((pledge) => pledge.guest_email === email && pledge.magic_token);
    if (sameEmail.length) {
      record.magic_token = sameEmail[sameEmail.length - 1].magic_token;
    }

    writeObjectRow_(sheet, sheet.getLastRow() + 1, PLEDGE_COLUMNS, record);
    refreshTokenExpiryForEmail_(email, record.magic_token);

    try {
      sendPledgeConfirmationEmail_(record, config);
    } catch (error) {
      console.error('Confirmation email failed for ' + email + ': ' + (error && error.message));
    }

    clearPublicPayloadCache_();

    return {
      ok: true,
      pledge: publicPledgeView_(record),
      paynow: paynowPayload_(config),
      // Handed back so the browser can remember them and show this pledge on
      // their next visit without an emailed link.
      magic_token: record.magic_token,
    };
  } finally {
    lock.releaseLock();
  }
}

function requestMagicLink_(email) {
  setupPledgeSheets_();
  const normalized = normalizeEmail_(email);
  const generic = { ok: true, message: MAGIC_LINK_GENERIC_MESSAGE };
  if (!normalized) return generic;

  throttleByEmail_('link', normalized, 60);

  const pledges = readPledges_();
  const mine = pledges.filter((pledge) => pledge.guest_email === normalized && pledge.status !== 'Cancelled');
  if (!mine.length) return generic;

  const token = Utilities.getUuid();
  const expires = tokenExpiryIso_();
  const sheet = getSheet_(REGISTRY_CONFIG.pledgesSheet);
  const headers = pledgeHeaderIndex_(sheet);
  const rowsById = pledgeRowNumbersById_();

  pledges.forEach((pledge) => {
    if (pledge.guest_email !== normalized) return;
    const rowNumber = rowsById[pledge.pledge_id];
    if (!rowNumber) return;
    sheet.getRange(rowNumber, headers.magic_token + 1).setValue(token);
    sheet.getRange(rowNumber, headers.token_expires + 1).setValue(expires);
  });

  sendMagicLinkEmail_(mine[0].guest_name, normalized, token, mine);
  return generic;
}

function lookupPledgeByToken_(magicToken) {
  const token = cleanString_(magicToken);
  if (!token) return null;

  const now = Date.now();
  const mine = readPledges_().filter((pledge) => {
    if (pledge.magic_token !== token) return false;
    const expires = Date.parse(pledge.token_expires);
    return !isFinite(expires) || expires > now;
  });

  if (!mine.length) return null;

  const config = pledgeConfig_();
  return {
    guest_name: mine[0].guest_name,
    guest_email: mine[0].guest_email,
    pledges: mine.map(publicPledgeView_),
    total_sgd: mine.filter((pledge) => pledge.status !== 'Cancelled').reduce((sum, pledge) => sum + pledge.amount_sgd, 0),
    paynow: paynowPayload_(config),
  };
}

function cancelPledge_(magicToken, pledgeId) {
  setupPledgeSheets_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found = pledgeForToken_(magicToken, pledgeId);
    if (found.pledge.status === 'Received') {
      throw new Error('This one is already marked as received. Message us directly and we will sort it out.');
    }

    const headers = pledgeHeaderIndex_(found.sheet);
    found.sheet.getRange(found.rowNumber, headers.status + 1).setValue('Cancelled');
    clearPublicPayloadCache_();

    return { ok: true, my_pledge: lookupPledgeByToken_(cleanString_(magicToken)) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Shared guard for every friend-initiated change. Resolves the pledge from its
 * id, proves the caller holds the matching unexpired token, and hands back the
 * sheet row number so the caller can write to it.
 */
function pledgeForToken_(magicToken, pledgeId) {
  const token = cleanString_(magicToken);
  const id = cleanString_(pledgeId);
  if (!token || !id) throw new Error('That link is not valid any more.');

  const pledge = readPledges_().find((candidate) => candidate.pledge_id === id);
  if (!pledge) throw new Error('We could not find that pledge.');

  const expires = Date.parse(pledge.token_expires);
  if (pledge.magic_token !== token || (isFinite(expires) && expires <= Date.now())) {
    throw new Error('That link has expired. Ask for a new one below.');
  }

  const rowNumber = pledgeRowNumbersById_()[pledge.pledge_id];
  if (!rowNumber) throw new Error('We could not find that pledge.');

  return { pledge, rowNumber, sheet: getSheet_(REGISTRY_CONFIG.pledgesSheet) };
}

function amendPledge_(magicToken, pledgeId, amount) {
  setupPledgeSheets_();
  const newAmount = Number(amount);
  if (!isFinite(newAmount) || newAmount <= 0) throw new Error('Please enter an amount greater than zero.');
  if (newAmount > 100000) throw new Error('That amount looks like a typo. Please check it.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found = pledgeForToken_(magicToken, pledgeId);
    if (found.pledge.status === 'Received') {
      throw new Error('This one is already marked as received, so we cannot change it here. Message us and we will sort it out.');
    }
    if (found.pledge.status === 'Cancelled') throw new Error('This pledge was cancelled.');

    const headers = pledgeHeaderIndex_(found.sheet);
    found.sheet.getRange(found.rowNumber, headers.amount_sgd + 1).setValue(Math.round(newAmount * 100) / 100);
    // Changing the amount invalidates any "I've sent it" claim against the old one.
    found.sheet.getRange(found.rowNumber, headers.claims_paid_on + 1).setValue('');
    clearPublicPayloadCache_();

    return { ok: true, my_pledge: lookupPledgeByToken_(cleanString_(magicToken)) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * A friend telling us they have transferred. This is a claim, not a
 * confirmation — it only nudges the owner to go and look at the bank. The
 * authoritative `status` column is never touched here.
 */
function markPledgeSent_(magicToken, pledgeId) {
  setupPledgeSheets_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found = pledgeForToken_(magicToken, pledgeId);
    if (found.pledge.status === 'Cancelled') throw new Error('This pledge was cancelled.');

    const headers = pledgeHeaderIndex_(found.sheet);
    found.sheet.getRange(found.rowNumber, headers.claims_paid_on + 1).setValue(new Date().toISOString());
    clearPublicPayloadCache_();

    return { ok: true, my_pledge: lookupPledgeByToken_(cleanString_(magicToken)) };
  } finally {
    lock.releaseLock();
  }
}

function publicPledgeView_(pledge) {
  return {
    pledge_id: cleanString_(pledge.pledge_id),
    guest_name: cleanString_(pledge.guest_name),
    amount_sgd: Number(toNumberOrBlank_(pledge.amount_sgd)) || 0,
    message: cleanString_(pledge.message),
    reference_code: cleanString_(pledge.reference_code),
    status: pledgeStatus_(pledge.status),
    claims_paid_on: cleanString_(pledge.claims_paid_on),
    pledged_on: pledge.timestamp instanceof Date ? pledge.timestamp.toISOString() : cleanString_(pledge.timestamp),
  };
}

function paynowPayload_(config) {
  const settings = config || pledgeConfig_();
  return {
    number: cleanString_(settings.paynow_number),
    name: cleanString_(settings.paynow_name),
    qr_image_url: safePublicUrl_(settings.paynow_qr_image_url),
  };
}

/* ---------- owner views ---------- */

/**
 * The dashboard is a formula sheet, not a generated one.
 *
 * It used to be rebuilt by script after every write, which meant it went stale
 * exactly when the owner did their main job: marking a row Received by hand
 * fires no script at all. Live formulas track every edit instantly, survive a
 * script failure, and show their own working. This only installs them.
 */
function refreshPledgeDashboard_() {
  setupPledgeSheets_();
  const sheet = getSheet_(REGISTRY_CONFIG.pledgeDashboardSheet);
  const p = "'" + REGISTRY_CONFIG.pledgesSheet + "'";

  // Mirrors countedAmount_: use received_amount_sgd when the owner filled it
  // in, otherwise the amount pledged.
  const counted = 'IF(' + p + '!$J$2:$J="",' + p + '!$E$2:$E,' + p + '!$J$2:$J)';
  const notCancelled = '(' + p + '!$H$2:$H<>"")*(' + p + '!$H$2:$H<>"Cancelled")';

  sheet.clear();

  sheet.getRange(1, 1, 1, 7).setValues([[
    'Total pledged', 'Received', 'Outstanding', 'Goal', '% of goal', 'Pledges', 'Friends',
  ]]).setFontWeight('bold');

  sheet.getRange(2, 1, 1, 7).setFormulas([[
    '=ARRAYFORMULA(SUMPRODUCT(' + notCancelled + '*' + counted + '))',
    '=ARRAYFORMULA(SUMPRODUCT((' + p + '!$H$2:$H="Received")*' + counted + '))',
    '=A2-B2',
    '=IFERROR(VALUE(VLOOKUP("goal_sgd",\'' + REGISTRY_CONFIG.pledgeConfigSheet + '\'!$A:$B,2,FALSE)),0)',
    '=IF(D2=0,"",B2/D2)',
    '=COUNTIFS(' + p + '!$H$2:$H,"<>",' + p + '!$H$2:$H,"<>Cancelled")',
    '=IFERROR(COUNTA(UNIQUE(FILTER(' + p + '!$D$2:$D,' + p + '!$D$2:$D<>"",' + p + '!$H$2:$H<>"Cancelled"))),0)',
  ]]);
  sheet.getRange(2, 1, 1, 4).setNumberFormat('$#,##0.00');
  sheet.getRange(2, 5).setNumberFormat('0%');

  sheet.getRange(3, 1).setFormula(
    '=LET('
    + 'saysPaid,COUNTIFS(' + p + '!$H$2:$H,"Pledged",' + p + '!$P$2:$P,"<>"),'
    + 'unthanked,COUNTIFS(' + p + '!$H$2:$H,"Received",' + p + '!$K$2:$K,""),'
    + 'msg,TRIM(IF(saysPaid>0,saysPaid&" say they have sent it - check your bank (blue rows).  ","")'
    + '&IF(unthanked>0,unthanked&" received, not yet thanked.","")),'
    + 'IF(COUNTA(' + p + '!$B$2:$B)=0,"No pledges yet.",IF(msg="","Nothing waiting on you.",msg)))');

  sheet.getRange(4, 1, 1, PLEDGE_DASHBOARD_COLUMNS.length)
    .setValues([PLEDGE_DASHBOARD_COLUMNS])
    .setFontWeight('bold');

  // One formula builds the whole table, newest first, and re-sorts itself the
  // moment a status changes.
  sheet.getRange(5, 1).setFormula(
    '=IFERROR(SORT(FILTER({'
    + p + '!$C$2:$C,'
    + p + '!$D$2:$D,'
    + p + '!$E$2:$E,'
    + p + '!$H$2:$H,'
    + p + '!$G$2:$G,'
    + 'IF(' + p + '!$P$2:$P="","",LEFT(' + p + '!$P$2:$P,10)),'
    + 'IF(' + p + '!$H$2:$H="Pledged",INT(TODAY())-INT(' + p + '!$A$2:$A),""),'
    + 'IF(' + p + '!$I$2:$I="","",LEFT(' + p + '!$I$2:$I&"",10)),'
    + p + '!$J$2:$J,'
    + 'IF(' + p + '!$K$2:$K="","","Yes"),'
    + p + '!$F$2:$F,'
    + 'IF(' + p + '!$A$2:$A="","",TEXT(' + p + '!$A$2:$A,"yyyy-mm-dd"))'
    + '},' + p + '!$B$2:$B<>""),12,FALSE),"")');

  const tailRows = Math.max(sheet.getMaxRows() - 4, 1);
  sheet.getRange(5, 3, tailRows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(5, 9, tailRows, 1).setNumberFormat('$#,##0.00');

  sheet.setFrozenRows(4);
  applyPledgeDashboardFormatting_(sheet, tailRows);

  return { ok: true, formulas: true };
}

function applyPledgeDashboardFormatting_(sheet, rowCount) {
  sheet.clearConditionalFormatRules();
  if (!rowCount) return;

  const range = sheet.getRange(5, 1, rowCount, PLEDGE_DASHBOARD_COLUMNS.length);
  const received = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D5="Received"')
    .setBackground('#e6f4ea')
    .setRanges([range])
    .build();
  // Blue = they say they have sent it, you have not confirmed it in the bank.
  // Deliberately a different colour from Received so the two never blur.
  const claimsPaid = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($D5="Pledged",$F5<>"")')
    .setBackground('#e3f0fb')
    .setRanges([range])
    .build();
  const chasing = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($D5="Pledged",$F5="",$G5>7)')
    .setBackground('#fef7e0')
    .setRanges([range])
    .build();
  const cancelled = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D5="Cancelled"')
    .setFontColor('#9aa0a6')
    .setRanges([range])
    .build();

  sheet.setConditionalFormatRules([received, claimsPaid, chasing, cancelled]);
}

/* ---------- owner emails ---------- */

function sendThankYouEmailsFromMenu_() {
  const result = sendThankYouEmails_();
  try {
    SpreadsheetApp.getUi().alert(result.sent
      ? 'Sent ' + result.sent + ' thank-you email(s).' + (result.remaining ? ' ' + result.remaining + ' left for the next run.' : '')
      : 'Nothing to send — every received pledge has already been thanked.');
  } catch (error) {
    // No UI when run from the editor.
  }
  return result;
}

function sendThankYouEmails_() {
  setupPledgeSheets_();
  const config = pledgeConfig_();
  const pledges = readPledges_();
  const sheet = getSheet_(REGISTRY_CONFIG.pledgesSheet);
  const headers = pledgeHeaderIndex_(sheet);
  const rowsById = pledgeRowNumbersById_();
  const pending = [];

  pledges.forEach((pledge) => {
    if (pledge.status !== 'Received' || pledge.thanked_on || !pledge.guest_email) return;
    const rowNumber = rowsById[pledge.pledge_id];
    if (rowNumber) pending.push({ pledge, rowNumber });
  });

  const batch = pending.slice(0, MAX_THANK_YOU_PER_RUN);
  let sent = 0;
  let failed = 0;

  batch.forEach((entry) => {
    try {
      sendThankYouEmail_(entry.pledge, config);
      sheet.getRange(entry.rowNumber, headers.thanked_on + 1).setValue(new Date().toISOString());
      sent += 1;
    } catch (error) {
      console.error('Thank-you failed for ' + entry.pledge.guest_email + ': ' + (error && error.message));
      failed += 1;
    }
  });

  if (sent) {
    clearPublicPayloadCache_();
  }
  return { ok: true, sent, failed, remaining: Math.max(pending.length - batch.length, 0) };
}

function resendConfirmationForSelectedRow_() {
  setupPledgeSheets_();
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = (function () {
    try {
      return SpreadsheetApp.getUi();
    } catch (error) {
      return null;
    }
  })();

  if (sheet.getName() !== REGISTRY_CONFIG.pledgesSheet) {
    if (ui) ui.alert('Select a row on the "' + REGISTRY_CONFIG.pledgesSheet + '" tab first.');
    return { ok: false, error: 'Wrong sheet' };
  }

  const rowNumber = sheet.getActiveRange().getRow();
  if (rowNumber < 2) {
    if (ui) ui.alert('Select a pledge row, not the header.');
    return { ok: false, error: 'Header row' };
  }

  const headers = pledgeHeaderIndex_(sheet);
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const pledge = normalizePledge_(PLEDGE_COLUMNS.reduce((object, column) => {
    object[column] = values[headers[column]];
    return object;
  }, {}));

  if (!pledge.guest_email) {
    if (ui) ui.alert('That row has no email address.');
    return { ok: false, error: 'No email' };
  }

  sendPledgeConfirmationEmail_(pledge, pledgeConfig_());
  if (ui) ui.alert('Confirmation resent to ' + pledge.guest_email + '.');
  return { ok: true };
}

/* ---------- email templates ---------- */

function sendPledgeConfirmationEmail_(pledge, config) {
  const settings = config || pledgeConfig_();
  const headline = cleanString_(settings.page_headline) || 'Things for the New Nest';
  const from = cleanString_(settings.couple_names) || headline;
  const link = magicLinkUrl_(pledge.magic_token);

  const body = emailShell_(headline, [
    '<p>Hi ' + escapeHtmlForEmail_(firstName_(pledge.guest_name)) + ',</p>',
    '<p>Thank you so much — your pledge of <strong>' + moneyText_(pledge.amount_sgd) + '</strong> is noted.</p>',
    payNowBlock_(settings, pledge),
    link ? '<p><a href="' + link + '" style="color:#4a6b52;">See or change your pledge any time</a></p>' : '',
    '<p style="color:#6b7a6e;font-size:13px;">Nothing is charged automatically — this is just us keeping track. We will do the shopping and send photos.</p>',
  ]);

  MailApp.sendEmail({
    to: pledge.guest_email,
    subject: 'Your pledge to ' + headline + ' — ' + moneyText_(pledge.amount_sgd),
    htmlBody: body,
    body: 'Thank you. Pledge: ' + moneyText_(pledge.amount_sgd)
      + '. PayNow reference: ' + pledge.reference_code
      + (link ? '. Manage your pledge: ' + link : ''),
    name: from,
  });
}

function sendMagicLinkEmail_(guestName, email, token, pledges) {
  const settings = pledgeConfig_();
  const headline = cleanString_(settings.page_headline) || 'Things for the New Nest';
  const from = cleanString_(settings.couple_names) || headline;
  const link = magicLinkUrl_(token);
  const rows = pledges.map((pledge) => '<li>' + moneyText_(pledge.amount_sgd)
    + ' — ' + escapeHtmlForEmail_(pledge.status)
    + ' (reference <strong>' + escapeHtmlForEmail_(pledge.reference_code) + '</strong>)</li>').join('');

  MailApp.sendEmail({
    to: email,
    subject: 'Your pledge link — ' + headline,
    htmlBody: emailShell_(headline, [
      '<p>Hi ' + escapeHtmlForEmail_(firstName_(guestName)) + ',</p>',
      '<p>Here is what we have on record for you:</p>',
      '<ul>' + rows + '</ul>',
      link ? '<p><a href="' + link + '" style="color:#4a6b52;">Open your pledge page</a></p>' : '',
      '<p style="color:#6b7a6e;font-size:13px;">This link is private to you and works for ' + PLEDGE_TOKEN_TTL_DAYS + ' days.</p>',
    ]),
    body: 'Your pledge page: ' + link,
    name: from,
  });
}

function sendThankYouEmail_(pledge, config) {
  const settings = config || pledgeConfig_();
  const headline = cleanString_(settings.page_headline) || 'Things for the New Nest';
  const from = cleanString_(settings.couple_names) || headline;
  const extra = cleanString_(settings.thank_you_message);

  MailApp.sendEmail({
    to: pledge.guest_email,
    subject: 'Thank you — ' + headline,
    htmlBody: emailShell_(headline, [
      '<p>Hi ' + escapeHtmlForEmail_(firstName_(pledge.guest_name)) + ',</p>',
      '<p>Your gift of <strong>' + moneyText_(countedAmount_(pledge)) + '</strong> has come through. Thank you, genuinely.</p>',
      extra ? '<p>' + escapeHtmlForEmail_(extra) + '</p>' : '',
      '<p>Come over and see what it turned into.</p>',
      '<p>' + escapeHtmlForEmail_(from) + '</p>',
    ]),
    body: 'Thank you for your gift of ' + moneyText_(countedAmount_(pledge)) + '.',
    name: from,
  });
}

function payNowBlock_(settings, pledge) {
  const parts = [
    '<div style="border:1px solid #d9dfd4;border-radius:12px;padding:16px;margin:16px 0;background:#f7f6f0;">',
    '<p style="margin:0 0 8px;font-weight:bold;">When you are ready, PayNow:</p>',
  ];
  const number = cleanString_(settings.paynow_number);
  const name = cleanString_(settings.paynow_name);
  const qr = safePublicUrl_(settings.paynow_qr_image_url);

  if (number) parts.push('<p style="margin:4px 0;">PayNow to <strong>' + escapeHtmlForEmail_(number) + '</strong>'
    + (name ? ' (' + escapeHtmlForEmail_(name) + ')' : '') + '</p>');
  parts.push('<p style="margin:4px 0;">Amount: <strong>' + moneyText_(pledge.amount_sgd) + '</strong></p>');
  parts.push('<p style="margin:4px 0;">Put this in the reference field: <strong style="font-size:18px;letter-spacing:1px;">'
    + escapeHtmlForEmail_(pledge.reference_code) + '</strong></p>');
  if (qr) parts.push('<p style="margin:12px 0 0;"><img src="' + qr + '" alt="PayNow QR" style="max-width:220px;height:auto;"></p>');
  parts.push('</div>');
  return parts.join('');
}

function emailShell_(headline, blocks) {
  return [
    '<div style="font-family:Georgia,serif;color:#33402f;max-width:520px;line-height:1.6;">',
    '<h2 style="font-weight:normal;color:#4a6b52;">' + escapeHtmlForEmail_(headline) + '</h2>',
    blocks.filter(Boolean).join(''),
    '</div>',
  ].join('');
}

function magicLinkUrl_(token) {
  const cleanToken = cleanString_(token);
  if (!cleanToken) return '';

  const config = pledgeConfig_();
  const site = safePublicUrl_(config.site_url);
  if (site) {
    // Carry the page key too, so the link opens straight in with no password.
    const key = cleanString_(config.site_password);
    return site.replace(/[?#].*$/, '').replace(/\/+$/, '')
      + '/?t=' + encodeURIComponent(cleanToken)
      + (key ? '&k=' + encodeURIComponent(key) : '');
  }

  try {
    const base = ScriptApp.getService().getUrl();
    if (!base) return '';
    return base + '?t=' + encodeURIComponent(cleanToken);
  } catch (error) {
    return '';
  }
}

function moneyText_(amount) {
  const number = Number(amount) || 0;
  return 'S$' + number.toFixed(2).replace(/\.00$/, '');
}

function escapeHtmlForEmail_(value) {
  return cleanString_(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- pledge helpers ---------- */

/**
 * Row numbers are resolved from the pledge_id column rather than from the
 * position in readPledges_, which drops fully blank rows and would otherwise
 * shift every offset after a stray empty row.
 */
function pledgeRowNumbersById_() {
  const sheet = getSheet_(REGISTRY_CONFIG.pledgesSheet);
  const headers = pledgeHeaderIndex_(sheet);
  const lastRow = sheet.getLastRow();
  const byId = {};
  if (lastRow < 2) return byId;

  sheet.getRange(2, headers.pledge_id + 1, lastRow - 1, 1).getValues().forEach((row, offset) => {
    const id = cleanString_(row[0]);
    if (id && byId[id] === undefined) byId[id] = offset + 2;
  });
  return byId;
}

function pledgeHeaderIndex_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(cleanString_);
  const index = headerIndex_(headers, PLEDGE_COLUMNS);
  const missing = PLEDGE_COLUMNS.filter((column) => index[column] < 0);
  if (missing.length) throw new Error('Missing columns in Pledges: ' + missing.join(', '));
  return index;
}

function refreshTokenExpiryForEmail_(email, token) {
  const sheet = getSheet_(REGISTRY_CONFIG.pledgesSheet);
  const headers = pledgeHeaderIndex_(sheet);
  const expires = tokenExpiryIso_();
  const rowsById = pledgeRowNumbersById_();
  readPledges_().forEach((pledge) => {
    if (pledge.guest_email !== email) return;
    const rowNumber = rowsById[pledge.pledge_id];
    if (!rowNumber) return;
    sheet.getRange(rowNumber, headers.magic_token + 1).setValue(token);
    sheet.getRange(rowNumber, headers.token_expires + 1).setValue(expires);
  });
}

function tokenExpiryIso_() {
  return new Date(Date.now() + PLEDGE_TOKEN_TTL_DAYS * 86400000).toISOString();
}

function uniqueReferenceCode_(usedCodes) {
  const alphabet = 'ACDEFGHJKLMNPQRSTUVWXY3456789';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = 'NEST-';
    for (let index = 0; index < 4; index += 1) {
      code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    if (!usedCodes.has(code)) return code;
  }
  return 'NEST-' + Utilities.getUuid().slice(0, 6).toUpperCase();
}

function normalizeEmail_(value) {
  const email = cleanString_(value).toLowerCase().slice(0, 200);
  return /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(email) ? email : '';
}

function throttleByEmail_(action, email, seconds) {
  const cache = CacheService.getScriptCache();
  const key = 'throttle-' + action + '-' + Utilities.base64EncodeWebSafe(email);
  if (cache.get(key)) {
    throw new Error('That just went through. Give it a moment before trying again.');
  }
  cache.put(key, '1', seconds);
}
function parseBody_(event) {
  if (!event || !event.postData || !event.postData.contents) throw new Error('Missing JSON body');
  try {
    return JSON.parse(event.postData.contents);
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

function readSheetObjects_(sheetName, expectedColumns, options) {
  const sheet = getSheet_(sheetName);
  const shouldRepair = !options || options.repairHeaders !== false;
  if (shouldRepair) ensureHeader_(sheet, expectedColumns);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(cleanString_);
  const indexes = expectedColumns.map((column) => headers.indexOf(column));
  const missing = expectedColumns.filter((column, index) => indexes[index] < 0);
  if (missing.length && !shouldRepair) {
    throw new Error('Missing columns in ' + sheetName + ': ' + missing.join(', '));
  }
  return values.slice(1)
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => expectedColumns.reduce((object, column, index) => {
      object[column] = indexes[index] >= 0 ? row[indexes[index]] : '';
      return object;
    }, {}));
}

function writeObjectRow_(sheet, rowNumber, columns, object) {
  const row = columns.map((column) => safeSheetCell_(object[column] === undefined || object[column] === null ? '' : object[column]));
  sheet.getRange(rowNumber, 1, 1, columns.length).setValues([row]);
}

function ensureHeader_(sheet, expectedColumns) {
  const lastColumn = Math.max(sheet.getLastColumn(), expectedColumns.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(cleanString_);
  const missing = expectedColumns.filter((column) => !headers.includes(column));
  if (headers.every((header) => !header)) {
    sheet.getRange(1, 1, 1, expectedColumns.length).setValues([expectedColumns]);
  } else if (missing.length) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
  }
}

function getSheet_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing sheet: ' + sheetName);
  return sheet;
}

function getSpreadsheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('This script must be bound to the registry spreadsheet.');
  return spreadsheet;
}

function headerIndex_(headers, columns) {
  return columns.reduce((acc, column) => {
    acc[column] = headers.indexOf(column);
    return acc;
  }, {});
}

function safeSheetCell_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function safePublicUrl_(value) {
  const text = cleanString_(value);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  if (/[\s<>"'`]/.test(text)) return '';

  const match = text.match(/^(https?):\/\/([^/?#]+)([^\s]*)?$/i);
  if (!match) return '';

  const authority = match[2];
  if (!authority || authority.indexOf('@') >= 0 || authority.indexOf('\\') >= 0) return '';
  if (!/[A-Za-z0-9.-]/.test(authority)) return '';

  return match[1].toLowerCase() + '://' + authority + (match[3] || '');
}

function cleanString_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function capString_(value, limit) {
  return cleanString_(value).slice(0, limit);
}

function toNumberOrBlank_(value) {
  if (value === '' || value === undefined || value === null) return '';
  const number = Number(value);
  return isFinite(number) ? number : '';
}

function parseBoolean_(value) {
  if (typeof value === 'boolean') return value;
  const normalized = cleanString_(value).toLowerCase();
  if (['false', 'no', 'n', '0', 'inactive', 'hidden'].includes(normalized)) return false;
  if (['true', 'yes', 'y', '1', 'active', ''].includes(normalized)) return true;
  return Boolean(value);
}

function numericAmount_(value) {
  const match = cleanString_(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? match[0] : '';
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function isPublicItem_(item) {
  const status = cleanString_(item.status).toLowerCase();
  if (item.active === false || parseBoolean_(item.active) === false) return false;
  return !['hidden', 'inactive', 'archive', 'archived', 'draft'].includes(status);
}
