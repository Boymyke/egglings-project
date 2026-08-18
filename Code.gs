/**
 * Egglings Hatchlist -> Google Sheets
 *
 * IMPORTANT SETUP
 * 1. Paste your Google Sheet ID into SPREADSHEET_ID below.
 *    You may also paste the full Google Sheets URL; this script will extract the ID.
 * 2. Save this file in Apps Script.
 * 3. Run setup() once and approve permissions.
 * 4. Run diagnoseSetup() and confirm that it reports ok: true.
 * 5. Deploy -> Manage deployments -> Edit your Web App deployment.
 * 6. Choose "New version", then Deploy.
 *    Execute as: Me
 *    Who has access: Anyone
 * 7. Keep the /exec URL in form.html pointed at this deployment.
 */

// PASTE YOUR GOOGLE SHEET ID HERE.
// Example URL:
// https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit
// ID only:
// 1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890
const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';

const SHEET_NAME = 'Hatchlist';
const DUPLICATE_POLICY = 'append'; // 'append' or 'update'

const HEADERS = [
  'Timestamp',
  'X Username',
  'Wallet Address',
  'X Actions Confirmed',
  'Entry ID'
];

/* ============================================================
   ONE-TIME SETUP
============================================================ */

function setup() {
  const ss = openSpreadsheet_();
  const sheet = getOrCreateSheet_(ss);
  formatHeader_(sheet);
  SpreadsheetApp.flush();

  const result = {
    ok: true,
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    sheetName: sheet.getName(),
    webAppUrl: ScriptApp.getService().getUrl() || ''
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** Run this anytime from the editor to check configuration without adding a row. */
function diagnoseSetup() {
  const ss = openSpreadsheet_();
  const sheet = getOrCreateSheet_(ss);

  const result = {
    ok: true,
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    sheetName: sheet.getName(),
    rowsIncludingHeader: sheet.getLastRow(),
    webAppUrl: ScriptApp.getService().getUrl() || ''
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/* ============================================================
   WEB APP: POST SUBMISSION
============================================================ */

function doPost(e) {
  let lock;

  try {
    const data = readPayload_(e);

    // Honeypot. Silently accept bot traffic without writing a row.
    const botField = String(data['bot-field'] || data.bot_field || '').trim();
    if (botField) {
      return json_({ ok: true, ignored: true });
    }

    const username = cleanUsername_(data.x_username);
    const wallet = String(data.wallet_address || '').trim();
    const completed = truthy_(data.completed_actions);
    const entryId = String(data.entry_id || '').trim();

    const validationError = validateSubmission_(username, wallet, completed, entryId);
    if (validationError) {
      return json_({ ok: false, error: validationError });
    }

    lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) {
      throw new Error('Could not obtain sheet write lock.');
    }

    const ss = openSpreadsheet_();
    const sheet = getOrCreateSheet_(ss);

    // Idempotency: if the browser retries the same submission, do not create
    // another row. This is what makes client-side retry safe.
    const existingEntryRow = findEntryRow_(sheet, entryId);
    if (existingEntryRow) {
      return json_({
        ok: true,
        replayed: true,
        row: existingEntryRow,
        entry_id: entryId
      });
    }

    const now = new Date();
    const duplicateRow = findDuplicateParticipantRow_(sheet, username, wallet);

    if (duplicateRow && DUPLICATE_POLICY === 'update') {
      sheet
        .getRange(duplicateRow, 1, 1, HEADERS.length)
        .setValues([[now, username, wallet, 'Yes', entryId]]);

      SpreadsheetApp.flush();

      return json_({
        ok: true,
        duplicate: true,
        updated: true,
        row: duplicateRow,
        entry_id: entryId
      });
    }

    const nextRow = Math.max(2, sheet.getLastRow() + 1);
    sheet
      .getRange(nextRow, 1, 1, HEADERS.length)
      .setValues([[now, username, wallet, 'Yes', entryId]]);

    SpreadsheetApp.flush();

    // Read the ID back after the flush. If this does not match, the request
    // must not be reported as successful.
    const writtenId = String(sheet.getRange(nextRow, 5).getDisplayValue() || '').trim();
    if (writtenId !== entryId) {
      throw new Error('Write verification failed for entry ' + entryId);
    }

    return json_({
      ok: true,
      duplicate: Boolean(duplicateRow),
      updated: false,
      row: nextRow,
      entry_id: entryId
    });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);

    return json_({
      ok: false,
      error: 'server_error'
    });
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }
  }
}

/* ============================================================
   WEB APP: HEALTH + SAVE CHECK (JSON / JSONP)
============================================================ */

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = String(params.action || 'ping').toLowerCase();
  const callback = safeCallback_(params.callback);

  let payload;

  try {
    if (action === 'check') {
      const entryId = String(params.entry_id || '').trim();

      payload = {
        ok: true,
        found: Boolean(entryId && entryExists_(entryId)),
        entry_id: entryId
      };
    } else {
      // Opening the /exec URL in a browser should return this response.
      const ss = openSpreadsheet_();
      const sheet = getOrCreateSheet_(ss);

      payload = {
        ok: true,
        service: 'egglings-hatchlist',
        sheet: sheet.getName(),
        ready: true
      };
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);

    payload = {
      ok: false,
      ready: false,
      found: false,
      error: 'server_error'
    };
  }

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return json_(payload);
}

/* ============================================================
   VALIDATION
============================================================ */

function validateSubmission_(username, wallet, completed, entryId) {
  if (!username || !/^[A-Za-z0-9_]{1,15}$/.test(username)) {
    return 'invalid_username';
  }

  if (!wallet || wallet.length < 8 || /\s/.test(wallet)) {
    return 'invalid_wallet';
  }

  if (!completed) {
    return 'actions_not_confirmed';
  }

  if (!entryId || entryId.length > 120 || !/^[A-Za-z0-9_-]+$/.test(entryId)) {
    return 'invalid_entry_id';
  }

  return '';
}

/* ============================================================
   SPREADSHEET HELPERS
============================================================ */

function spreadsheetId_() {
  const raw = String(SPREADSHEET_ID || '').trim();

  if (!raw || raw === 'PASTE_YOUR_SPREADSHEET_ID_HERE') {
    throw new Error('Paste your Google Sheet ID into SPREADSHEET_ID at the top of Code.gs.');
  }

  const urlMatch = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  const id = urlMatch ? urlMatch[1] : raw;

  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    throw new Error('SPREADSHEET_ID does not look valid. Paste only the Sheet ID or the full Google Sheets URL.');
  }

  return id;
}

function openSpreadsheet_() {
  return SpreadsheetApp.openById(spreadsheetId_());
}

function getOrCreateSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  ensureHeaders_(sheet);
  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    formatHeader_(sheet);
    return;
  }

  const current = sheet
    .getRange(1, 1, 1, HEADERS.length)
    .getDisplayValues()[0]
    .map(function (value) { return String(value || '').trim(); });

  const blank = current.every(function (value) { return !value; });
  if (blank) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    formatHeader_(sheet);
  }
}

function formatHeader_(sheet) {
  const header = sheet.getRange(1, 1, 1, HEADERS.length);
  header.setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.autoResizeColumns(1, HEADERS.length);
}

function findEntryRow_(sheet, entryId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const match = sheet
    .getRange(2, 5, lastRow - 1, 1)
    .createTextFinder(entryId)
    .matchEntireCell(true)
    .findNext();

  return match ? match.getRow() : 0;
}

function entryExists_(entryId) {
  const ss = openSpreadsheet_();
  const sheet = getOrCreateSheet_(ss);
  return Boolean(findEntryRow_(sheet, entryId));
}

function findDuplicateParticipantRow_(sheet, username, wallet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const rows = sheet.getRange(2, 2, lastRow - 1, 2).getDisplayValues();
  const userKey = username.toLowerCase();
  const walletKey = wallet.toLowerCase();

  for (let i = 0; i < rows.length; i++) {
    const existingUser = String(rows[i][0] || '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();

    const existingWallet = String(rows[i][1] || '')
      .trim()
      .toLowerCase();

    if (existingUser === userKey || existingWallet === walletKey) {
      return i + 2;
    }
  }

  return 0;
}

/* ============================================================
   REQUEST / RESPONSE HELPERS
============================================================ */

function readPayload_(e) {
  const data = {};
  if (!e) return data;

  // Standard HTML form / URLSearchParams POSTs land here.
  if (e.parameter) {
    Object.keys(e.parameter).forEach(function (key) {
      data[key] = e.parameter[key];
    });
  }

  // JSON support is kept as a fallback for future clients.
  const raw = e.postData && e.postData.contents;
  const contentType = String((e.postData && e.postData.type) || '').toLowerCase();

  if (raw && contentType.indexOf('application/json') !== -1) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.keys(parsed).forEach(function (key) {
          data[key] = parsed[key];
        });
      }
    } catch (error) {
      console.error('Invalid JSON payload:', error);
    }
  }

  return data;
}

function cleanUsername_(value) {
  return String(value || '').trim().replace(/^@/, '');
}

function truthy_(value) {
  return ['true', '1', 'yes', 'on'].indexOf(String(value || '').toLowerCase()) !== -1;
}

function safeCallback_(value) {
  const callback = String(value || '').trim();
  return /^[A-Za-z_$][0-9A-Za-z_$\.]{0,100}$/.test(callback) ? callback : '';
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
