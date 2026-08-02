/** @OnlyCurrentDoc */

const REGISTRY_CONFIG = {
  sourceSheet: 'Housewarming/Later Appliances',
  inboxSheet: 'Paste Links Here',
  itemsSheet: 'Registry Items',
  responsesSheet: 'Registry Responses',
  summarySheet: 'Registry Summary',
  pledgesSheet: 'Pledges',
  pledgeDashboardSheet: 'Pledge Dashboard',
  pledgeConfigSheet: 'Pledge Config',
};

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
];

const PLEDGE_DASHBOARD_COLUMNS = [
  'Name',
  'Email',
  'Pledged SGD',
  'Status',
  'Reference',
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
  ['site_url', '', 'Public site address, e.g. https://stellassx94.github.io/new-nest/. Magic links in emails point here. Blank falls back to the raw Apps Script URL.'],
  ['page_headline', 'Things for the New Nest', 'Big title on the page.'],
  ['page_subtext', 'Your company is the real gift. But if you would like to chip in toward the new place, here is the easiest way.', 'Warm line under the title.'],
  ['suggested_amounts', '50, 100, 200, 388', 'Comma-separated preset amounts on the pledge form.'],
  ['closed', 'FALSE', 'Set TRUE to stop accepting new pledges.'],
  ['closed_message', 'Pledges are closed now, thank you so much.', 'Shown when closed is TRUE.'],
  ['thank_you_message', '', 'Optional extra line added to thank-you emails.'],
];

const PLEDGE_TOKEN_TTL_DAYS = 30;
const MAX_THANK_YOU_PER_RUN = 40;

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

const RESPONSE_COLUMNS = [
  'timestamp',
  'item_id',
  'guest_name',
  'response_type',
  'amount_sgd',
  'note',
  'response_id',
  'edit_token',
  'cancels_response_id',
  'source',
];

const SUMMARY_COLUMNS = [
  'Item',
  'Reference',
  'Status',
  'Claimed By',
  'Pooled SGD',
  'Target SGD',
  'Product Link',
  'Last Action',
  'Response Count',
  'Source Row',
  'Registry ID',
];

const INBOX_COLUMNS = [
  'Link',
  'Notes',
  'Status',
  'Processed Link',
  'Category',
  'Item',
  'Description',
  'Est. Cost',
  'Image',
  'Registry ID',
  'Source Row',
  'Last processed',
  'Error',
];

const SOURCE_COLUMNS = {
  registryId: 'Registry ID',
  category: 'Category',
  item: 'Item',
  description: 'Description',
  price: 'Est. Cost',
  who: 'Who?',
  link: 'Link',
  remarks: 'Remarks',
  status: 'Status',
};

const ALLOWED_RESPONSE_TYPES = ['reserve', 'contribute', 'purchased', 'note', 'undo'];
const PUBLIC_RESPONSE_TYPES = ['reserve', 'contribute', 'undo'];
const MAX_ENRICH_PER_RUN = 5;
const MAX_INBOX_PER_RUN = 3;
const AUTOMATION_TRIGGER_HANDLERS = ['handleRegistrySourceEdit_', 'runScheduledRegistryMaintenance_'];

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
    return json_(getRegistryDataForClient(params.t));
  }

  if (params.api === 'me') {
    return json_(getMyPledgeForClient(params.t));
  }

  const template = HtmlService.createTemplateFromFile('Index');
  // Injected raw into a JS string literal in Index.html, so strip anything
  // that is not UUID-shaped before it gets there.
  template.magicToken = cleanString_(params.t).replace(/[^A-Za-z0-9-]/g, '').slice(0, 120);
  return template
    .evaluate()
    .setTitle(pledgeConfigValue_('page_headline') || 'Things for the New Nest')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
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
function getRegistryDataForClient(magicToken) {
  try {
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

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('New Nest Registry')
      .addItem('Install/refresh automation', 'installRegistryAutomation_')
      .addSeparator()
      .addItem('Refresh pledge dashboard', 'refreshPledgeDashboard_')
      .addItem('Send thank-you emails', 'sendThankYouEmailsFromMenu_')
      .addItem('Resend confirmation for selected row', 'resendConfirmationForSelectedRow_')
      .addToUi();
  } catch (error) {
    // Spreadsheet UI is only available when opened as a sheet.
  }
}

function publicError_(error) {
  const message = cleanString_(error && (error.message || error));
  return message || 'Something went wrong. Please try again.';
}

function installRegistryAutomation_() {
  assertEditorOnly_();
  setupRegistrySheets_();
  setupPledgeSheets_();
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (AUTOMATION_TRIGGER_HANDLERS.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('handleRegistrySourceEdit_')
    .forSpreadsheet(getSpreadsheet_())
    .onEdit()
    .create();
  ScriptApp.newTrigger('runScheduledRegistryMaintenance_')
    .timeBased()
    .everyMinutes(15)
    .create();
  return {
    ok: true,
    triggers: AUTOMATION_TRIGGER_HANDLERS,
    maintenance: runRegistryMaintenance_(false),
  };
}

function runRegistryMaintenance_(force) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { ok: false, skipped: true, error: 'Registry maintenance is already running.' };
  }

  try {
    setupRegistrySheets_();
    setupPledgeSheets_();
    const inbox = processInboxLinks_();
    const sync = syncFromSourceSheet_();
    const enrich = enrichRegistryRows_(Boolean(force));
    const summary = refreshRegistryOwnerViews_();
    const pledges = refreshPledgeDashboard_();
    return { ok: true, inbox, sync, enrich, summary, pledges };
  } finally {
    lock.releaseLock();
  }
}

function handleRegistrySourceEdit_(event) {
  const range = event && event.range;
  if (!range) return runRegistryMaintenance_(false);

  const sheet = range.getSheet();
  if (!sheet || ![REGISTRY_CONFIG.sourceSheet, REGISTRY_CONFIG.inboxSheet].includes(sheet.getName())) {
    return { ok: true, ignored: true };
  }

  if (sheet.getName() === REGISTRY_CONFIG.inboxSheet) {
    if (range.getRow() === 1 || range.getColumn() <= INBOX_COLUMNS.length) {
      return runRegistryMaintenance_(false);
    }
    return { ok: true, ignored: true };
  }

  if (range.getRow() === 1) return runRegistryMaintenance_(false);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(cleanString_);
  const watchedColumns = Object.keys(SOURCE_COLUMNS)
    .map((key) => headers.indexOf(SOURCE_COLUMNS[key]) + 1)
    .filter((column) => column > 0);
  const editStart = range.getColumn();
  const editEnd = editStart + range.getNumColumns() - 1;
  const touchesSourceColumns = watchedColumns.some((column) => column >= editStart && column <= editEnd);

  if (!touchesSourceColumns) return { ok: true, ignored: true };
  return runRegistryMaintenance_(false);
}

function runScheduledRegistryMaintenance_() {
  return runRegistryMaintenance_(false);
}

function processInboxLinks_() {
  const inbox = getSheet_(REGISTRY_CONFIG.inboxSheet);
  const source = getSheet_(REGISTRY_CONFIG.sourceSheet);
  const items = getSheet_(REGISTRY_CONFIG.itemsSheet);
  ensureHeader_(inbox, INBOX_COLUMNS);
  ensureSourceRegistryIdColumn_(source);

  const inboxValues = inbox.getDataRange().getValues();
  if (inboxValues.length < 2) return { processed: 0, skipped: 0, failed: 0 };

  const inboxHeaders = inboxValues[0].map(cleanString_);
  const inboxIndex = headerIndex_(inboxHeaders, INBOX_COLUMNS);
  const sourceHeaders = source.getRange(1, 1, 1, source.getLastColumn()).getValues()[0].map(cleanString_);
  const sourceIndex = Object.keys(SOURCE_COLUMNS).reduce((acc, key) => {
    acc[key] = sourceHeaders.indexOf(SOURCE_COLUMNS[key]);
    return acc;
  }, {});
  validateSourceHeaders_(sourceIndex);

  const existingItems = readSheetObjects_(REGISTRY_CONFIG.itemsSheet, ITEM_COLUMNS);
  const usedIds = new Set(existingItems.map((item) => cleanString_(item.id)).filter(Boolean));
  const byId = {};
  existingItems.forEach((item, offset) => {
    const id = cleanString_(item.id);
    if (id) byId[id] = { item, rowNumber: offset + 2 };
  });

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  inboxValues.slice(1).forEach((row, offset) => {
    if (processed >= MAX_INBOX_PER_RUN) {
      skipped += 1;
      return;
    }

    const rowNumber = offset + 2;
    const link = safePublicUrl_(cell_(row, inboxIndex.Link));
    if (!link) {
      skipped += 1;
      return;
    }

    const status = cleanString_(cell_(row, inboxIndex.Status)).toLowerCase();
    const processedLink = safePublicUrl_(cell_(row, inboxIndex['Processed Link']));
    const existingId = cleanString_(cell_(row, inboxIndex['Registry ID']));
    const sourceRow = Number(cell_(row, inboxIndex['Source Row']));
    if (status === 'done' && processedLink === link && existingId && sourceRow > 1) {
      skipped += 1;
      return;
    }

    writeNamedCells_(inbox, rowNumber, inboxIndex, {
      Status: 'Processing',
      Error: '',
    });

    try {
      const metadata = fetchProductMetadata_(link);
      const fallbackName = hostname_(link) || 'Review pasted link';
      const referenceTitle = referenceTitleFromParts_(
        cleanString_(cell_(row, inboxIndex.Item)),
        metadata.description || cleanString_(cell_(row, inboxIndex.Description)),
        cleanProductTitle_(metadata.title)
      );
      const title = shortDisplayName_(
        cleanString_(cell_(row, inboxIndex.Item)),
        metadata.description || cleanString_(cell_(row, inboxIndex.Description)),
        referenceTitle || fallbackName
      );
      const category = cleanString_(cell_(row, inboxIndex.Category)) || guessCategory_(title + ' ' + metadata.description + ' ' + link);
      const description = metadata.description || cleanString_(cell_(row, inboxIndex.Description)) || referenceTitle || title;
      const price = metadata.price || cleanString_(cell_(row, inboxIndex['Est. Cost']));
      const notes = cleanString_(cell_(row, inboxIndex.Notes));
      const id = existingId || uniqueIdFromSet_(slugify_(title) || slugify_(fallbackName) || 'registry-item', usedIds);
      usedIds.add(id);

      const targetSourceRow = sourceRow > 1 ? sourceRow : source.getLastRow() + 1;
      writeNamedCells_(source, targetSourceRow, sourceIndex, {
        category,
        item: title,
        description,
        price,
        link,
        remarks: notes,
        status: metadata.title ? 'TBC' : 'Draft',
        registryId: id,
      });

      const existing = byId[id];
      const record = {
        id,
        status: metadata.title ? 'TBC' : 'Draft',
        category,
        source_link: link,
        vendor: metadata.vendor || hostname_(link),
        scraped_title: metadata.title,
        display_name: title,
        scraped_price: metadata.price,
        display_price_sgd: price,
        target_sgd: numericAmount_(price),
        scraped_image: metadata.image,
        display_image: metadata.image,
        description,
        mode: existing ? existing.item.mode : 'claim_or_contribute',
        reserved_by: existing ? existing.item.reserved_by : '',
        remarks: notes,
        source_sheet: REGISTRY_CONFIG.sourceSheet,
        source_row: String(targetSourceRow),
        sort_order: existing ? existing.item.sort_order : String(Math.max(1, targetSourceRow - 2)),
        active: existing ? existing.item.active : 'TRUE',
        last_enriched: metadata.title || metadata.price || metadata.image ? new Date().toISOString() : '',
        enrich_status: metadata.title || metadata.price || metadata.image ? 'OK' : 'Needs review',
        enrich_error: metadata.title || metadata.price || metadata.image ? '' : 'No useful product metadata found',
        reference_title: referenceTitle || title,
      };
      writeObjectRow_(items, existing ? existing.rowNumber : items.getLastRow() + 1, ITEM_COLUMNS, record);

      writeNamedCells_(inbox, rowNumber, inboxIndex, {
        Status: metadata.title ? 'Done' : 'Needs review',
        'Processed Link': link,
        Category: category,
        Item: title,
        Description: description,
        'Est. Cost': price,
        Image: metadata.image,
        'Registry ID': id,
        'Source Row': String(targetSourceRow),
        'Last processed': new Date().toISOString(),
        Error: metadata.title || metadata.price || metadata.image ? '' : 'No useful product metadata found',
      });
      processed += 1;
    } catch (error) {
      writeNamedCells_(inbox, rowNumber, inboxIndex, {
        Status: 'Needs review',
        'Last processed': new Date().toISOString(),
        Error: error.message || String(error),
      });
      failed += 1;
    }
  });

  return { processed, skipped, failed };
}

function setupRegistrySheets_() {
  const spreadsheet = getSpreadsheet_();
  const inbox = spreadsheet.getSheetByName(REGISTRY_CONFIG.inboxSheet) || spreadsheet.insertSheet(REGISTRY_CONFIG.inboxSheet);
  const items = spreadsheet.getSheetByName(REGISTRY_CONFIG.itemsSheet) || spreadsheet.insertSheet(REGISTRY_CONFIG.itemsSheet);
  const responses = spreadsheet.getSheetByName(REGISTRY_CONFIG.responsesSheet) || spreadsheet.insertSheet(REGISTRY_CONFIG.responsesSheet);
  const summary = spreadsheet.getSheetByName(REGISTRY_CONFIG.summarySheet) || spreadsheet.insertSheet(REGISTRY_CONFIG.summarySheet);
  ensureHeader_(inbox, INBOX_COLUMNS);
  ensureHeader_(items, ITEM_COLUMNS);
  ensureHeader_(responses, RESPONSE_COLUMNS);
  ensureExactHeader_(summary, SUMMARY_COLUMNS);
  inbox.setFrozenRows(1);
  items.setFrozenRows(1);
  responses.setFrozenRows(1);
  summary.setFrozenRows(1);
  return { ok: true };
}

function appendPublicResponse_(body) {
  setupRegistrySheets_();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const response = validateResponse_(body);
    if (!PUBLIC_RESPONSE_TYPES.includes(response.response_type)) {
      throw new Error('This response type is not available from the public registry.');
    }

    const items = readSheetObjects_(REGISTRY_CONFIG.itemsSheet, ITEM_COLUMNS).map(normalizeItem_);
    const item = items.find((candidate) => candidate.id === response.item_id);
    if (!item) throw new Error('This item could not be found.');
    if (!isPublicItem_(item)) {
      throw new Error('This item is not currently available.');
    }

    const responses = readSheetObjects_(REGISTRY_CONFIG.responsesSheet, RESPONSE_COLUMNS).map(normalizeResponse_);
    if (response.response_type === 'undo') {
      validateUndoFromResponses_(responses, response);
      response.response_id = Utilities.getUuid();
      response.edit_token = '';
    } else {
      validateOpenResponse_(item, responses, response);
      response.response_id = Utilities.getUuid();
      response.edit_token = Utilities.getUuid();
    }
    response.source = 'web';

    getSheet_(REGISTRY_CONFIG.responsesSheet).appendRow([
      new Date(),
      response.item_id,
      response.guest_name,
      response.response_type,
      response.amount_sgd,
      response.note,
      response.response_id,
      response.edit_token,
      response.cancels_response_id,
      response.source,
    ].map(safeSheetCell_));

    refreshRegistryOwnerViews_();

    return {
      ok: true,
      response_id: response.response_id,
      edit_token: response.edit_token,
    };
  } finally {
    lock.releaseLock();
  }
}

function validateOpenResponse_(item, responses, response) {
  const active = activeResponses_(responses);
  const itemResponses = active.filter((row) => row.item_id === item.id || row.gift_id === item.id);
  const sourceReservation = cleanString_(item.reserved_by);
  const reserved = sourceReservation ? { guest_name: sourceReservation, source: 'source-who' } : itemResponses.find((row) => ['reserve', 'purchased'].includes(row.response_type));
  const target = Number(item.target_sgd) || Number(numericAmount_(item.price_sgd)) || 0;
  const contributed = itemResponses
    .filter((row) => row.response_type === 'contribute')
    .reduce((sum, row) => sum + (Number(row.amount_sgd) || 0), 0);

  if (response.response_type === 'reserve') {
    if (item.mode !== 'multi_claim' && (reserved || (target > 0 && contributed >= target))) {
      throw new Error('This item is already covered.');
    }
    return;
  }

  if (response.response_type === 'contribute') {
    if (item.mode === 'multi_claim') throw new Error('This item is not set up for pooled contributions.');
    if (reserved) throw new Error('This item is already covered.');
    if (response.amount_sgd === '' || !isFinite(response.amount_sgd) || response.amount_sgd <= 0) {
      throw new Error('amount_sgd must be a positive number');
    }
    if (target > 0 && contributed >= target) throw new Error('This item is already fully pooled.');
    if (target > 0 && contributed + Number(response.amount_sgd) > target) {
      throw new Error('That amount is more than the remaining target.');
    }
  }
}

function refreshRegistryOwnerViews_() {
  setupRegistrySheets_();
  const itemRows = readSheetObjects_(REGISTRY_CONFIG.itemsSheet, ITEM_COLUMNS);
  const responses = readSheetObjects_(REGISTRY_CONFIG.responsesSheet, RESPONSE_COLUMNS).map(normalizeResponse_);
  const active = activeResponses_(responses);
  const webReserveNamesByItem = responseNamesByItem_(responses.filter((response) => {
    return cleanString_(response.source).toLowerCase() === 'web'
      && ['reserve', 'purchased'].includes(cleanString_(response.response_type).toLowerCase());
  }));

  mirrorWebClaimsToSource_(itemRows, active, webReserveNamesByItem);
  writeRegistrySummary_(itemRows, responses, active);

  return { ok: true, items: itemRows.length, active_responses: active.length };
}

function mirrorWebClaimsToSource_(itemRows, activeResponses, webReserveNamesByItem) {
  const source = getSheet_(REGISTRY_CONFIG.sourceSheet);
  const items = getSheet_(REGISTRY_CONFIG.itemsSheet);
  const sourceHeaders = source.getRange(1, 1, 1, source.getLastColumn()).getValues()[0].map(cleanString_);
  const sourceIndex = Object.keys(SOURCE_COLUMNS).reduce((acc, key) => {
    acc[key] = sourceHeaders.indexOf(SOURCE_COLUMNS[key]);
    return acc;
  }, {});
  validateSourceHeaders_(sourceIndex);

  itemRows.forEach((item, offset) => {
    if (cleanString_(item.source_sheet) !== REGISTRY_CONFIG.sourceSheet) return;
    const id = cleanString_(item.id);
    const rowNumber = Number(item.source_row);
    if (!id || rowNumber <= 1) return;

    const reserve = activeResponses.find((response) => {
      return (response.item_id === id || response.gift_id === id)
        && ['reserve', 'purchased'].includes(cleanString_(response.response_type));
    });
    const webReserveNames = webReserveNamesByItem[id] || new Set();
    const sourceRow = source.getRange(rowNumber, 1, 1, source.getLastColumn()).getValues()[0];
    const currentWho = cell_(sourceRow, sourceIndex.who);
    const currentStatus = cell_(sourceRow, sourceIndex.status);
    const currentItemReservedBy = cleanString_(item.reserved_by);
    const statusIsGeneratedCovered = cleanString_(currentStatus).toLowerCase() === 'covered';

    const sourceUpdates = {};
    const itemUpdates = {};

    if (reserve) {
      sourceUpdates.who = reserve.guest_name;
      sourceUpdates.status = 'Covered';
      itemUpdates.reserved_by = reserve.guest_name;
      itemUpdates.status = 'Covered';
    } else {
      const hadWebReserve = webReserveNames.has(currentWho) || webReserveNames.has(currentItemReservedBy);
      if (hadWebReserve) {
        if (webReserveNames.has(currentWho)) sourceUpdates.who = '';
        if (statusIsGeneratedCovered) sourceUpdates.status = 'TBC';
        if (webReserveNames.has(currentItemReservedBy)) itemUpdates.reserved_by = '';
        if (cleanString_(item.status).toLowerCase() === 'covered') itemUpdates.status = 'TBC';
      }
    }

    if (Object.keys(sourceUpdates).length) {
      writeNamedCells_(source, rowNumber, sourceIndex, sourceUpdates);
    }

    if (Object.keys(itemUpdates).length) {
      writeObjectRow_(items, offset + 2, ITEM_COLUMNS, Object.assign({}, item, itemUpdates));
      Object.keys(itemUpdates).forEach((key) => {
        item[key] = itemUpdates[key];
      });
    }
  });
}

function writeRegistrySummary_(itemRows, responses, activeResponses) {
  const summary = getSheet_(REGISTRY_CONFIG.summarySheet);
  ensureExactHeader_(summary, SUMMARY_COLUMNS);

  const rows = itemRows
    .map(normalizeItem_)
    .filter(isPublicItem_)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item) => {
      const activeItemResponses = itemResponsesForId_(activeResponses, item.id);
      const allItemResponses = itemResponsesForId_(responses, item.id).filter((response) => !isLegacySourceReservation_(response));
      const reserve = activeItemResponses.find((response) => ['reserve', 'purchased'].includes(response.response_type));
      const contributed = activeItemResponses
        .filter((response) => response.response_type === 'contribute')
        .reduce((sum, response) => sum + (Number(response.amount_sgd) || 0), 0);
      const target = Number(item.target_sgd) || Number(numericAmount_(item.price_sgd)) || 0;
      const claimedBy = reserve ? reserve.guest_name : cleanString_(item.reserved_by);
      const status = claimedBy || (target > 0 && contributed >= target)
        ? 'Covered'
        : contributed > 0
          ? 'Pooling'
          : 'Open';
      const latest = latestResponse_(allItemResponses);
      const action = latest
        ? [latest.timestamp, latest.guest_name, latest.response_type].filter(Boolean).join(' | ')
        : '';

      return [
        item.name,
        item.reference_title,
        status,
        claimedBy,
        contributed || '',
        target || '',
        item.link,
        action,
        allItemResponses.length || '',
        item.source_row ? REGISTRY_CONFIG.sourceSheet + '!' + item.source_row : '',
        item.id,
      ].map(safeSheetCell_);
    });

  const lastRow = Math.max(summary.getLastRow(), 2);
  summary.getRange(2, 1, lastRow - 1, SUMMARY_COLUMNS.length).clearContent();
  if (rows.length) {
    summary.getRange(2, 1, rows.length, SUMMARY_COLUMNS.length).setValues(rows);
  }
}

function itemResponsesForId_(responses, itemId) {
  return (responses || []).filter((response) => response.item_id === itemId || response.gift_id === itemId);
}

function latestResponse_(responses) {
  return (responses || []).reduce((latest, response) => {
    if (!latest) return response;
    return responseTimestamp_(response) >= responseTimestamp_(latest) ? response : latest;
  }, null);
}

function responseTimestamp_(response) {
  if (response.timestamp instanceof Date) return response.timestamp.getTime();
  const timestamp = Date.parse(response.timestamp);
  return isNaN(timestamp) ? 0 : timestamp;
}

function responseNamesByItem_(responses) {
  return (responses || []).reduce((acc, response) => {
    const id = cleanString_(response.item_id || response.gift_id);
    const name = cleanString_(response.guest_name);
    if (!id || !name) return acc;
    if (!acc[id]) acc[id] = new Set();
    acc[id].add(name);
    return acc;
  }, {});
}

function syncFromSourceSheet_() {
  setupRegistrySheets_();
  const source = getSheet_(REGISTRY_CONFIG.sourceSheet);
  const items = getSheet_(REGISTRY_CONFIG.itemsSheet);
  ensureSourceRegistryIdColumn_(source);
  const sourceValues = source.getDataRange().getValues();
  if (sourceValues.length < 2) return { imported: 0, skipped: 0 };

  const sourceHeaders = sourceValues[0].map(cleanString_);
  const sourceIndex = Object.keys(SOURCE_COLUMNS).reduce((acc, key) => {
    acc[key] = sourceHeaders.indexOf(SOURCE_COLUMNS[key]);
    return acc;
  }, {});
  validateSourceHeaders_(sourceIndex);

  const itemObjects = readSheetObjects_(REGISTRY_CONFIG.itemsSheet, ITEM_COLUMNS);
  const byId = {};
  const usedIds = new Set();
  itemObjects.forEach((item, offset) => {
    const id = cleanString_(item.id);
    if (!id) return;
    usedIds.add(id);
    byId[id] = { item, rowNumber: offset + 2 };
  });

  let imported = 0;
  let skipped = 0;
  const seenSourceIds = new Set();

  sourceValues.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    let sourceId = cell_(row, sourceIndex.registryId);
    const category = cell_(row, sourceIndex.category);
    const itemName = cell_(row, sourceIndex.item);
    const description = cell_(row, sourceIndex.description);
    const price = cell_(row, sourceIndex.price);
    const who = cell_(row, sourceIndex.who);
    const link = sourceLinkFromCell_(source, rowNumber, sourceIndex.link, cell_(row, sourceIndex.link));
    const remarks = cell_(row, sourceIndex.remarks);
    const status = cell_(row, sourceIndex.status);
    const hasUsefulData = [category, itemName, description, price, who, link, remarks].some((value) => value && value !== '/');

    if (!hasUsefulData) {
      skipped += 1;
      return;
    }

    if (!sourceId) {
      sourceId = uniqueIdFromSet_(slugify_([category, itemName, description].filter(Boolean).join(' ')) || 'registry-item', usedIds);
      source.getRange(rowNumber, sourceIndex.registryId + 1).setValue(sourceId);
    } else if (seenSourceIds.has(sourceId)) {
      sourceId = uniqueIdFromSet_(sourceId, usedIds);
      source.getRange(rowNumber, sourceIndex.registryId + 1).setValue(sourceId);
    }

    usedIds.add(sourceId);
    seenSourceIds.add(sourceId);

    const existing = byId[sourceId];
    const existingLink = existing ? cleanString_(existing.item.source_link) : '';
    const linkChanged = Boolean(existing && link && link !== existingLink);
    const id = sourceId;
    const referenceTitle = referenceTitleFromParts_(
      itemName,
      description,
      existing && !linkChanged ? existing.item.reference_title || existing.item.scraped_title : ''
    );
    const sourceDisplayName = displayNameFromSource_(itemName, description, referenceTitle, category);
    const displayName = sourceDisplayName || (existing && !linkChanged ? existing.item.display_name : '');
    const displayPrice = shouldAutofillSourceCell_(price) ? (existing && !linkChanged ? existing.item.display_price_sgd : price) : price;
    const target = numericAmount_(displayPrice) || (existing && !linkChanged ? existing.item.target_sgd : '');
    const sortOrder = existing ? existing.item.sort_order : String(rowNumber - 2);
    const itemStatus = status && status !== '/' ? status : 'Draft';

    const record = {
      id,
      status: itemStatus,
      category,
      source_link: link,
      vendor: existing && !linkChanged ? existing.item.vendor : '',
      scraped_title: existing && !linkChanged ? existing.item.scraped_title : '',
      display_name: displayName,
      scraped_price: existing && !linkChanged ? existing.item.scraped_price : '',
      display_price_sgd: displayPrice,
      target_sgd: target,
      scraped_image: existing && !linkChanged ? existing.item.scraped_image : '',
      display_image: existing && !linkChanged ? existing.item.display_image : '',
      description,
      mode: existing ? existing.item.mode : 'claim_or_contribute',
      reserved_by: who,
      remarks,
      source_sheet: REGISTRY_CONFIG.sourceSheet,
      source_row: String(rowNumber),
      sort_order: sortOrder,
      active: existing ? existing.item.active : 'TRUE',
      last_enriched: existing && !linkChanged ? existing.item.last_enriched : '',
      enrich_status: link ? (existing && !linkChanged ? existing.item.enrich_status || 'Needs enrich' : 'Needs enrich') : 'Pending link',
      enrich_error: existing && !linkChanged ? existing.item.enrich_error : '',
      reference_title: referenceTitle,
    };

    writeObjectRow_(items, existing ? existing.rowNumber : items.getLastRow() + 1, ITEM_COLUMNS, record);
    imported += 1;
  });

  itemObjects.forEach((item, offset) => {
    const id = cleanString_(item.id);
    if (cleanString_(item.source_sheet) !== REGISTRY_CONFIG.sourceSheet) return;
    if (!id || seenSourceIds.has(id)) return;
    if (parseBoolean_(item.active) === false) return;
    const inactive = Object.assign({}, item, { active: 'FALSE', status: 'Inactive' });
    writeObjectRow_(items, offset + 2, ITEM_COLUMNS, inactive);
  });

  return { imported, skipped };
}

function enrichRegistryRows_(force) {
  setupRegistrySheets_();
  const sheet = getSheet_(REGISTRY_CONFIG.itemsSheet);
  const rows = readSheetObjects_(REGISTRY_CONFIG.itemsSheet, ITEM_COLUMNS);
  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  rows.forEach((item, index) => {
    if (enriched >= MAX_ENRICH_PER_RUN) {
      skipped += 1;
      return;
    }

    const rowNumber = index + 2;
    const link = cleanString_(item.source_link);
    if (!link) {
      skipped += 1;
      return;
    }

    const alreadyOk = cleanString_(item.enrich_status).toLowerCase() === 'ok';
    if (alreadyOk && !force) {
      skipped += 1;
      return;
    }

    try {
      const metadata = fetchProductMetadata_(link);
      const sourceRowNumber = Number(item.source_row);
      const referenceTitle = referenceTitleFromParts_(
        item.display_name,
        metadata.description || item.description,
        metadata.title || item.reference_title || item.scraped_title
      );
      const displayName = shouldShortenDisplayName_(item.display_name, referenceTitle)
        ? shortDisplayName_(item.display_name, metadata.description || item.description, referenceTitle, item.category)
        : item.display_name;
      const record = Object.assign({}, item, {
        vendor: metadata.vendor || item.vendor,
        scraped_title: metadata.title || item.scraped_title,
        scraped_price: metadata.price || item.scraped_price,
        scraped_image: metadata.image || item.scraped_image,
        display_name: displayName || metadata.title || '',
        display_price_sgd: item.display_price_sgd || metadata.price || '',
        target_sgd: item.target_sgd || numericAmount_(metadata.price),
        display_image: item.display_image || metadata.image || '',
        description: item.description || metadata.description || '',
        last_enriched: new Date().toISOString(),
        enrich_status: metadata.title || metadata.price || metadata.image ? 'OK' : 'Partial',
        enrich_error: metadata.title || metadata.price || metadata.image ? '' : 'No useful product metadata found',
        reference_title: referenceTitle,
      });
      writeObjectRow_(sheet, rowNumber, ITEM_COLUMNS, record);
      if (sourceRowNumber > 1 && cleanString_(item.source_sheet) === REGISTRY_CONFIG.sourceSheet) {
        writeMetadataToSourceRow_(sourceRowNumber, metadata, record);
      }
      enriched += 1;
    } catch (error) {
      const record = Object.assign({}, item, {
        last_enriched: new Date().toISOString(),
        enrich_status: 'Error',
        enrich_error: error.message || String(error),
      });
      writeObjectRow_(sheet, rowNumber, ITEM_COLUMNS, record);
      failed += 1;
    }
  });

  return { enriched, skipped, failed };
}

function writeMetadataToSourceRow_(rowNumber, metadata, item) {
  const source = getSheet_(REGISTRY_CONFIG.sourceSheet);
  const headers = source.getRange(1, 1, 1, source.getLastColumn()).getValues()[0].map(cleanString_);
  const sourceIndex = Object.keys(SOURCE_COLUMNS).reduce((acc, key) => {
    acc[key] = headers.indexOf(SOURCE_COLUMNS[key]);
    return acc;
  }, {});
  validateSourceHeaders_(sourceIndex);

  const current = source.getRange(rowNumber, 1, 1, source.getLastColumn()).getValues()[0];
  const title = cleanProductTitle_(metadata.title) || cleanString_(item.display_name || item.scraped_title);
  const price = metadata.price || item.display_price_sgd || item.scraped_price;
  const description = metadata.description || item.description;

  const updates = {};
  if (shouldAutofillSourceCell_(cell_(current, sourceIndex.item)) && title) updates.item = title;
  if (shouldAutofillSourceCell_(cell_(current, sourceIndex.description)) && description) updates.description = description;
  if (shouldAutofillSourceCell_(cell_(current, sourceIndex.price)) && price) updates.price = price;
  if (shouldAutofillSourceCell_(cell_(current, sourceIndex.status))) updates.status = metadata.title || metadata.price || metadata.image ? 'TBC' : 'Needs review';

  if (Object.keys(updates).length) {
    writeNamedCells_(source, rowNumber, sourceIndex, updates);
  }
}

function getRegistryData_() {
  const items = readSheetObjects_(REGISTRY_CONFIG.itemsSheet, ITEM_COLUMNS, { repairHeaders: false })
    .map(normalizeItem_)
    .filter(isPublicItem_);

  const responses = readSheetObjects_(REGISTRY_CONFIG.responsesSheet, RESPONSE_COLUMNS, { repairHeaders: false })
    .map(normalizeResponse_)
    .filter((response) => !isLegacySourceReservation_(response));
  const reservedItems = new Set(activeResponses_(responses)
    .filter((response) => ['reserve', 'purchased'].includes(response.response_type))
    .map((response) => response.item_id || response.gift_id));

  items.forEach((item) => {
    const reservedBy = cleanString_(item.reserved_by);
    if (!reservedBy || reservedItems.has(item.id)) return;
    responses.push({
      timestamp: '',
      gift_id: item.id,
      item_id: item.id,
      guest_name: reservedBy,
      response_type: 'reserve',
      amount_sgd: '',
      note: 'Imported from Who? column',
      response_id: 'source-' + item.id + '-' + slugify_(reservedBy),
      cancels_response_id: '',
      source: 'source-who',
    });
  });

  return {
    gifts: items,
    responses,
  };
}

function fetchProductMetadata_(url) {
  const safeUrl = safePublicUrl_(url);
  if (!safeUrl) throw new Error('Product link must start with http:// or https://');
  const response = UrlFetchApp.fetch(safeUrl, {
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 Registry Metadata Bot',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const status = response.getResponseCode();
  if (status >= 400) throw new Error('Fetch failed with HTTP ' + status);

  const finalUrl = safePublicUrl_(response.getFinalUrl && response.getFinalUrl()) || safeUrl;
  const html = response.getContentText();
  const jsonLd = extractJsonLdProduct_(html);

  return {
    vendor: hostname_(finalUrl),
    title: cleanProductTitle_(jsonLd.name || meta_(html, 'og:title') || meta_(html, 'twitter:title') || titleTag_(html)),
    description: cleanString_(jsonLd.description || meta_(html, 'og:description') || meta_(html, 'description')),
    price: cleanPrice_(jsonLd.price || meta_(html, 'product:price:amount') || meta_(html, 'og:price:amount') || meta_(html, 'twitter:data1') || priceFromHtml_(html)),
    image: absolutizeUrl_(jsonLd.image || meta_(html, 'og:image') || meta_(html, 'twitter:image'), finalUrl),
  };
}

function extractJsonLdProduct_(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    const raw = decodeHtml_(match[1]).trim();
    try {
      const parsed = JSON.parse(raw);
      const product = findProductNode_(parsed);
      if (product) {
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers || {};
        const image = Array.isArray(product.image) ? product.image[0] : product.image;
        return {
          name: cleanString_(product.name),
          description: cleanString_(product.description),
          price: cleanString_(offer.price || offer.lowPrice || offer.highPrice),
          image: cleanString_(image),
        };
      }
    } catch (error) {
      // Ignore malformed JSON-LD and keep scanning.
    }
  }
  return {};
}

function findProductNode_(node) {
  if (!node || typeof node !== 'object') return null;
  const type = node['@type'];
  if (String(Array.isArray(type) ? type.join(',') : type).toLowerCase().includes('product')) return node;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProductNode_(child);
      if (found) return found;
    }
  }
  if (node['@graph']) return findProductNode_(node['@graph']);
  return null;
}

function meta_(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp("<meta[^>]+property=[\"']" + escaped + "[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>", 'i'),
    new RegExp("<meta[^>]+name=[\"']" + escaped + "[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>", 'i'),
    new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']" + escaped + "[\"'][^>]*>", 'i'),
    new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+name=[\"']" + escaped + "[\"'][^>]*>", 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtml_(match[1]);
  }
  return '';
}

function titleTag_(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml_(match[1]) : '';
}

function priceFromHtml_(html) {
  const match = html.match(/(?:S\$|SGD|\$)\s?[\d,.]+/i);
  return match ? match[0] : '';
}

function cleanProductTitle_(title) {
  return cleanString_(title).replace(/\s+[|-]\s+.*$/, '').trim();
}

function cleanPrice_(value) {
  const text = cleanString_(value);
  if (!text) return '';
  const amount = text.match(/[\d,.]+/);
  if (!amount) return text;
  return 'SGD ' + amount[0].replace(/\.00$/, '');
}

function numericAmount_(value) {
  const match = cleanString_(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? match[0] : '';
}

function absolutizeUrl_(url, base) {
  const value = cleanString_(url);
  if (!value) return '';
  const absolute = safePublicUrl_(value);
  if (absolute) return absolute;

  const safeBase = safePublicUrl_(base);
  if (!safeBase) return '';

  const protocolMatch = safeBase.match(/^(https?:)\/\//i);
  const originMatch = safeBase.match(/^(https?:\/\/[^/?#]+)/i);
  if (!protocolMatch || !originMatch) return '';

  if (/^\/\//.test(value)) return safePublicUrl_(protocolMatch[1] + value);
  if (/^\//.test(value)) return safePublicUrl_(originMatch[1] + value);

  const basePath = safeBase.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '/');
  return safePublicUrl_(basePath + value);
}

function hostname_(url) {
  const safeUrl = safePublicUrl_(url);
  const match = safeUrl.match(/^https?:\/\/([^/?#]+)/i);
  if (!match) return '';
  return match[1].replace(/:\d+$/, '').replace(/^www\./i, '').toLowerCase();
}

function parseBody_(event) {
  if (!event || !event.postData || !event.postData.contents) throw new Error('Missing JSON body');
  try {
    return JSON.parse(event.postData.contents);
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

function validateResponse_(body) {
  const response = {
    item_id: capString_(body.item_id || body.gift_id, 120),
    guest_name: capString_(body.guest_name, 80),
    response_type: cleanString_(body.response_type || 'reserve').toLowerCase(),
    amount_sgd: body.amount_sgd === undefined || body.amount_sgd === null || body.amount_sgd === '' ? '' : Number(body.amount_sgd),
    note: capString_(body.note || '', 500),
    response_id: '',
    edit_token: capString_(body.edit_token || '', 120),
    cancels_response_id: capString_(body.cancels_response_id || '', 120),
    source: 'web',
  };

  if (!response.item_id) throw new Error('item_id is required');
  if (!response.guest_name) throw new Error('guest_name is required');
  if (!ALLOWED_RESPONSE_TYPES.includes(response.response_type)) {
    throw new Error('response_type must be one of: ' + ALLOWED_RESPONSE_TYPES.join(', '));
  }
  if (response.amount_sgd !== '' && (!isFinite(response.amount_sgd) || response.amount_sgd < 0)) {
    throw new Error('amount_sgd must be a positive number');
  }
  if (response.response_type === 'undo') {
    if (!response.cancels_response_id) throw new Error('cancels_response_id is required');
    if (!response.edit_token) throw new Error('edit_token is required');
  }
  return response;
}

function validateUndo_(response) {
  const responses = readSheetObjects_(REGISTRY_CONFIG.responsesSheet, RESPONSE_COLUMNS);
  validateUndoFromResponses_(responses.map(normalizeResponse_), response);
}

function validateUndoFromResponses_(responses, response) {
  const target = responses.find((row) => cleanString_(row.response_id) === response.cancels_response_id);
  if (!target) throw new Error('Could not find the response to undo');
  if (cleanString_(target.edit_token) !== response.edit_token) throw new Error('Undo token did not match');
  if (cleanString_(target.response_type) === 'undo') throw new Error('Cannot undo an undo row');
  const alreadyUndone = responses.some((row) => {
    return cleanString_(row.response_type) === 'undo'
      && cleanString_(row.cancels_response_id) === response.cancels_response_id;
  });
  if (alreadyUndone) throw new Error('This response has already been undone');
}

function activeResponses_(responses) {
  const cancelled = new Set((responses || [])
    .filter((response) => cleanString_(response.response_type) === 'undo' && cleanString_(response.cancels_response_id))
    .map((response) => cleanString_(response.cancels_response_id)));

  return (responses || []).filter((response) => {
    if (isLegacySourceReservation_(response)) return false;
    if (cleanString_(response.response_type) === 'undo') return false;
    const responseId = cleanString_(response.response_id);
    return !(responseId && cancelled.has(responseId));
  });
}

function normalizeItem_(item) {
  const referenceTitle = referenceTitleFromParts_(
    item.display_name,
    item.description || item.remarks,
    item.reference_title || item.scraped_title
  );
  const name = shortDisplayName_(item.display_name, item.description || item.remarks, referenceTitle, item.category)
    || cleanString_(item.display_name || item.scraped_title);
  return {
    id: cleanString_(item.id),
    name,
    reference_title: referenceTitle,
    description: cleanString_(item.description || item.remarks),
    price_sgd: cleanString_(item.display_price_sgd || item.scraped_price),
    target_sgd: cleanString_(item.target_sgd),
    link: sourceLinkForItem_(item),
    image: safePublicUrl_(item.display_image || item.scraped_image),
    mode: cleanString_(item.mode || 'claim_or_contribute'),
    sort_order: toNumberOrBlank_(item.sort_order),
    active: parseBoolean_(item.active) !== false,
    status: cleanString_(item.status),
    room: cleanString_(item.category),
    vendor: cleanString_(item.vendor),
    remarks: cleanString_(item.remarks),
    reserved_by: cleanString_(item.reserved_by),
    enrich_status: cleanString_(item.enrich_status),
    source_row: cleanString_(item.source_row),
  };
}

function normalizeResponse_(response) {
  return {
    timestamp: response.timestamp instanceof Date ? response.timestamp.toISOString() : cleanString_(response.timestamp),
    gift_id: cleanString_(response.item_id),
    item_id: cleanString_(response.item_id),
    guest_name: cleanString_(response.guest_name),
    response_type: cleanString_(response.response_type),
    amount_sgd: toNumberOrBlank_(response.amount_sgd),
    note: cleanString_(response.note),
    response_id: cleanString_(response.response_id),
    edit_token: cleanString_(response.edit_token),
    cancels_response_id: cleanString_(response.cancels_response_id),
    source: cleanString_(response.source),
  };
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

function ensureExactHeader_(sheet, expectedColumns) {
  const lastColumn = Math.max(sheet.getLastColumn(), expectedColumns.length);
  sheet.getRange(1, 1, 1, expectedColumns.length).setValues([expectedColumns]);
  if (lastColumn > expectedColumns.length) {
    sheet.getRange(1, expectedColumns.length + 1, 1, lastColumn - expectedColumns.length).clearContent();
  }
}

function uniqueId_(base, existingItems) {
  const used = new Set((existingItems || []).map((item) => cleanString_(item.id)));
  return uniqueIdFromSet_(base, used);
}

function uniqueIdFromSet_(base, used) {
  let id = base;
  let count = 2;
  while (used.has(id)) {
    id = base + '-' + count;
    count += 1;
  }
  return id;
}

function ensureSourceRegistryIdColumn_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(cleanString_);
  if (headers.includes(SOURCE_COLUMNS.registryId)) return;
  sheet.getRange(1, lastColumn + 1).setValue(SOURCE_COLUMNS.registryId);
}

function validateSourceHeaders_(sourceIndex) {
  const required = ['category', 'item', 'description', 'price', 'who', 'link', 'remarks', 'status', 'registryId'];
  const missing = required.filter((key) => sourceIndex[key] < 0).map((key) => SOURCE_COLUMNS[key]);
  if (missing.length) {
    throw new Error('Missing source columns: ' + missing.join(', '));
  }
}

function sourceLinkForItem_(item) {
  const direct = safePublicUrl_(item.source_link);
  if (direct) return direct;

  const rowNumber = Number(item.source_row);
  if (rowNumber <= 1 || cleanString_(item.source_sheet) !== REGISTRY_CONFIG.sourceSheet) return '';

  try {
    const source = getSheet_(REGISTRY_CONFIG.sourceSheet);
    const headers = source.getRange(1, 1, 1, source.getLastColumn()).getValues()[0].map(cleanString_);
    const linkIndex = headers.indexOf(SOURCE_COLUMNS.link);
    return sourceLinkFromCell_(source, rowNumber, linkIndex, '');
  } catch (error) {
    return '';
  }
}

function sourceLinkFromCell_(sheet, rowNumber, columnIndex, displayedValue) {
  const direct = safePublicUrl_(displayedValue);
  if (direct || columnIndex < 0) return direct;

  const range = sheet.getRange(rowNumber, columnIndex + 1);
  const richText = range.getRichTextValue();
  if (richText) {
    const richLink = safePublicUrl_(richText.getLinkUrl && richText.getLinkUrl());
    if (richLink) return richLink;

    const runs = richText.getRuns ? richText.getRuns() : [];
    for (let index = 0; index < runs.length; index += 1) {
      const runLink = safePublicUrl_(runs[index].getLinkUrl && runs[index].getLinkUrl());
      if (runLink) return runLink;
    }
  }

  const formula = range.getFormula ? range.getFormula() : '';
  return hyperlinkUrlFromFormula_(formula);
}

function hyperlinkUrlFromFormula_(formula) {
  const text = cleanString_(formula);
  const match = text.match(/^=\s*HYPERLINK\s*\(\s*"((?:[^"]|"")+)"/i);
  return match ? safePublicUrl_(match[1].replace(/""/g, '"')) : '';
}

function headerIndex_(headers, columns) {
  return columns.reduce((acc, column) => {
    acc[column] = headers.indexOf(column);
    return acc;
  }, {});
}

function writeNamedCells_(sheet, rowNumber, indexMap, valuesByKey) {
  Object.keys(valuesByKey).forEach((key) => {
    const index = indexMap[key];
    if (index < 0 || index === undefined) return;
    sheet.getRange(rowNumber, index + 1).setValue(safeSheetCell_(valuesByKey[key]));
  });
}

function shouldAutofillSourceCell_(value) {
  const text = cleanString_(value).toLowerCase();
  return !text || ['/', '?', '-', 'tbc', 'todo', 'to fill', 'needs review'].includes(text);
}

function displayNameFromSource_(itemName, description, referenceTitle, category) {
  return shortDisplayName_(itemName, description, referenceTitle, category);
}

function shortDisplayName_(itemName, description, referenceTitle, category) {
  const item = shouldAutofillSourceCell_(itemName) ? '' : cleanString_(itemName);
  const detail = shouldAutofillSourceCell_(description) ? '' : cleanString_(description);
  const reference = cleanString_(referenceTitle);
  const text = [item, detail, reference, category].filter(Boolean).join(' ').toLowerCase();
  const rule = shortNameRule_(text);

  if (rule && (!item || shouldShortenDisplayName_(item, reference) || isBrandOrModelHeavy_(item))) return rule;
  if (item && !shouldShortenDisplayName_(item, reference)) return item;
  if (detail && !shouldShortenDisplayName_(detail, reference)) return detail;
  if (rule) return rule;

  return simplifyDisplayName_(item || detail || reference || 'Home Gift');
}

function shortNameRule_(text) {
  const rules = [
    ['Steam Oven Microwave', /(?:steam|convection|combi).*(?:oven|microwave)|(?:oven|microwave).*(?:steam|convection|combi)/],
    ['Dyson Vacuum', /dyson|v12|vacuum|cordless cleaner/],
    ['Wine Chiller', /wine|drinks? chiller|beverage chiller/],
    ['Air Purifier', /air purifier|purifier|hepa/],
    ['Rice Cooker', /rice cooker/],
    ['Air Fryer', /air fryer/],
    ['Coffee Machine', /coffee machine|espresso/],
    ['Floor Lamp', /floor lamp|standing lamp/],
  ];
  const match = rules.find((rule) => rule[1].test(text));
  return match ? match[0] : '';
}

function shouldShortenDisplayName_(displayName, referenceTitle) {
  const name = cleanString_(displayName);
  if (!name) return true;
  if (name.length > 38) return true;
  if (isBrandOrModelHeavy_(name)) return true;
  const reference = cleanString_(referenceTitle).toLowerCase();
  return Boolean(reference && reference !== name.toLowerCase() && reference.includes(name.toLowerCase()) && name.split(/\s+/).length > 3);
}

function isBrandOrModelHeavy_(value) {
  const text = cleanString_(value);
  if (!text) return false;
  if (/\b(panasonic|dyson|samsung|lg|bosch|philips)\b/i.test(text) && text.split(/\s+/).length <= 4) return true;
  return /\b[A-Z]{1,5}[-]?[A-Z0-9]{2,}\b/.test(text) && /\d/.test(text);
}

function simplifyDisplayName_(value) {
  const text = cleanString_(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:official|store|singapore|sg|new|original|authentic)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, 4).join(' ') || 'Home Gift';
}

function referenceTitleFromParts_(itemName, description, scrapedTitle) {
  const scraped = cleanProductTitle_(scrapedTitle);
  const item = shouldAutofillSourceCell_(itemName) ? '' : cleanString_(itemName);
  const detail = shouldAutofillSourceCell_(description) ? '' : cleanString_(description);
  if (scraped) return scraped;
  if (item && detail) {
    const itemLower = item.toLowerCase();
    const detailLower = detail.toLowerCase();
    if (itemLower.includes(detailLower)) return item;
    if (detailLower.includes(itemLower)) return detail;
    if (shortNameRule_(detailLower).toLowerCase() === itemLower) return detail;
    return item + ' - ' + detail;
  }
  return scraped || item || detail;
}

function guessCategory_(text) {
  const value = cleanString_(text).toLowerCase();
  const rules = [
    ['Kitchen', /rice|cooker|oven|microwave|air fryer|kettle|toaster|pan|pot|wok|knife|blender|mixer|fridge|chiller|pantry/],
    ['Dining', /plate|bowl|glass|cup|mug|cutlery|fork|spoon|chopstick|tray|platter|serve|wine|drink|carafe/],
    ['Cleaning', /vacuum|mop|clean|laundry|detergent|dryer|washer|iron|steam|dyson/],
    ['Bedroom', /bed|bedsheet|linen|pillow|bolster|duvet|mattress|wardrobe|hanger|air purifier/],
    ['Bathroom', /bath|toilet|towel|shower|soap|toothbrush|mat/],
    ['Living', /lamp|light|sofa|cushion|rug|carpet|table|chair|shelf|plant|vase|frame/],
  ];
  const match = rules.find((rule) => rule[1].test(value));
  return match ? match[0] : 'To sort';
}

function assertEditorOnly_() {
  const activeUser = cleanString_(Session.getActiveUser().getEmail());
  const effectiveUser = cleanString_(Session.getEffectiveUser().getEmail());
  if (!activeUser || activeUser !== effectiveUser) {
    throw new Error('Run installRegistryAutomation from the Apps Script editor as the spreadsheet owner.');
  }
}

function slugify_(value) {
  return cleanString_(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function cell_(row, index) {
  return index >= 0 ? cleanString_(row[index]) : '';
}

function cleanString_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function decodeHtml_(value) {
  return cleanString_(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
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

function isPublicItem_(item) {
  const status = cleanString_(item.status).toLowerCase();
  if (item.active === false || parseBoolean_(item.active) === false) return false;
  return !['hidden', 'inactive', 'archive', 'archived', 'draft'].includes(status);
}

function isLegacySourceReservation_(response) {
  return ['source-who', 'sheet-import'].includes(cleanString_(response.source).toLowerCase());
}

function capString_(value, limit) {
  return cleanString_(value).slice(0, limit);
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

function safeSheetCell_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
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

function getPublicRegistryPayload_() {
  const config = pledgeConfig_();
  const pledges = readPledges_().filter((pledge) => pledge.status !== 'Cancelled');
  const received = pledges
    .filter((pledge) => pledge.status === 'Received')
    .reduce((sum, pledge) => sum + countedAmount_(pledge), 0);
  const pledged = pledges.reduce((sum, pledge) => sum + countedAmount_(pledge), 0);

  const items = readSheetObjects_(REGISTRY_CONFIG.itemsSheet, ITEM_COLUMNS, { repairHeaders: false })
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

  return {
    items,
    settings: {
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
    totals: {
      pledged_sgd: pledged,
      received_sgd: received,
      pledge_count: pledges.length,
      // First names only. Amounts are never attributed publicly.
      names: pledges.map((pledge) => firstName_(pledge.guest_name)).filter(Boolean),
    },
  };
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

    refreshPledgeDashboard_();

    return {
      ok: true,
      pledge: publicPledgeView_(record),
      paynow: paynowPayload_(config),
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
  const token = cleanString_(magicToken);
  const id = cleanString_(pledgeId);
  if (!token || !id) throw new Error('That link is not valid any more.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const pledges = readPledges_();
    const pledge = pledges.find((candidate) => candidate.pledge_id === id);
    if (!pledge) throw new Error('We could not find that pledge.');

    const expires = Date.parse(pledge.token_expires);
    if (pledge.magic_token !== token || (isFinite(expires) && expires <= Date.now())) {
      throw new Error('That link has expired. Request a new one.');
    }
    if (pledge.status === 'Received') {
      throw new Error('This one is already marked as received. Message us directly and we will sort it out.');
    }

    const sheet = getSheet_(REGISTRY_CONFIG.pledgesSheet);
    const headers = pledgeHeaderIndex_(sheet);
    const rowNumber = pledgeRowNumbersById_()[pledge.pledge_id];
    if (!rowNumber) throw new Error('We could not find that pledge.');
    sheet.getRange(rowNumber, headers.status + 1).setValue('Cancelled');
    refreshPledgeDashboard_();

    return { ok: true, my_pledge: lookupPledgeByToken_(token) };
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

function refreshPledgeDashboard_() {
  setupPledgeSheets_();
  const sheet = getSheet_(REGISTRY_CONFIG.pledgeDashboardSheet);
  const config = pledgeConfig_();
  const pledges = readPledges_();
  const live = pledges.filter((pledge) => pledge.status !== 'Cancelled');
  const receivedRows = live.filter((pledge) => pledge.status === 'Received');

  const pledgedTotal = live.reduce((sum, pledge) => sum + countedAmount_(pledge), 0);
  const receivedTotal = receivedRows.reduce((sum, pledge) => sum + countedAmount_(pledge), 0);
  const goal = Number(numericAmount_(config.goal_sgd)) || 0;
  const guests = new Set(live.map((pledge) => pledge.guest_email).filter(Boolean));
  const unthanked = receivedRows.filter((pledge) => !pledge.thanked_on).length;

  sheet.clear();
  sheet.getRange(1, 1, 1, 7).setValues([[
    'Total pledged', 'Received', 'Outstanding', 'Goal', '% of goal', 'Pledges', 'Friends',
  ]]).setFontWeight('bold');
  sheet.getRange(2, 1, 1, 7).setValues([[
    pledgedTotal,
    receivedTotal,
    pledgedTotal - receivedTotal,
    goal || '',
    goal ? receivedTotal / goal : '',
    live.length,
    guests.size,
  ]]);
  sheet.getRange(2, 1, 1, 4).setNumberFormat('$#,##0.00');
  sheet.getRange(2, 5).setNumberFormat('0%');
  sheet.getRange(3, 1).setValue(unthanked
    ? unthanked + ' received pledge(s) still waiting on a thank-you.'
    : 'All received pledges have been thanked.');

  sheet.getRange(4, 1, 1, PLEDGE_DASHBOARD_COLUMNS.length)
    .setValues([PLEDGE_DASHBOARD_COLUMNS])
    .setFontWeight('bold');

  const now = Date.now();
  const rows = pledges
    .slice()
    .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
    .map((pledge) => {
      const pledgedAt = Date.parse(pledge.timestamp);
      const days = pledge.status === 'Pledged' && isFinite(pledgedAt)
        ? Math.floor((now - pledgedAt) / 86400000)
        : '';
      return [
        pledge.guest_name,
        pledge.guest_email,
        pledge.amount_sgd || '',
        pledge.status,
        pledge.reference_code,
        days,
        formatDate_(pledge.received_on),
        pledge.received_amount_sgd,
        pledge.thanked_on ? 'Yes' : '',
        pledge.message,
        formatDate_(pledge.timestamp),
      ].map(safeSheetCell_);
    });

  if (rows.length) {
    sheet.getRange(5, 1, rows.length, PLEDGE_DASHBOARD_COLUMNS.length).setValues(rows);
    sheet.getRange(5, 3, rows.length, 1).setNumberFormat('$#,##0.00');
    sheet.getRange(5, 8, rows.length, 1).setNumberFormat('$#,##0.00');
  }

  sheet.setFrozenRows(4);
  applyPledgeDashboardFormatting_(sheet, rows.length);

  return { ok: true, pledges: pledges.length, pledged_sgd: pledgedTotal, received_sgd: receivedTotal };
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
  const chasing = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($D5="Pledged",$F5>7)')
    .setBackground('#fef7e0')
    .setRanges([range])
    .build();
  const cancelled = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D5="Cancelled"')
    .setFontColor('#9aa0a6')
    .setRanges([range])
    .build();

  sheet.setConditionalFormatRules([received, chasing, cancelled]);
}

function formatDate_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return cleanString_(value);
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Singapore', 'yyyy-MM-dd');
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

  if (sent) refreshPledgeDashboard_();
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
    name: headline,
  });
}

function sendMagicLinkEmail_(guestName, email, token, pledges) {
  const headline = pledgeConfigValue_('page_headline') || 'Things for the New Nest';
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
    name: headline,
  });
}

function sendThankYouEmail_(pledge, config) {
  const settings = config || pledgeConfig_();
  const headline = cleanString_(settings.page_headline) || 'Things for the New Nest';
  const extra = cleanString_(settings.thank_you_message);

  MailApp.sendEmail({
    to: pledge.guest_email,
    subject: 'Thank you — ' + headline,
    htmlBody: emailShell_(headline, [
      '<p>Hi ' + escapeHtmlForEmail_(firstName_(pledge.guest_name)) + ',</p>',
      '<p>Your gift of <strong>' + moneyText_(countedAmount_(pledge)) + '</strong> has come through. Thank you, genuinely.</p>',
      extra ? '<p>' + escapeHtmlForEmail_(extra) + '</p>' : '',
      '<p>Come over and see what it turned into.</p>',
    ]),
    body: 'Thank you for your gift of ' + moneyText_(countedAmount_(pledge)) + '.',
    name: headline,
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

  const site = safePublicUrl_(pledgeConfigValue_('site_url'));
  if (site) {
    return site.replace(/[?#].*$/, '').replace(/\/+$/, '') + '/?t=' + encodeURIComponent(cleanToken);
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
