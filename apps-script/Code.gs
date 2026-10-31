// Paste this into the Google Sheet's Apps Script editor (Extensions > Apps Script),
// then Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.

const SHEET_NAME = "Weights";
const GOALS_SHEET_NAME = "Goals";
const PEOPLE = ["Alex", "Rochelle"];
const MIN_KG = 20;
const MAX_KG = 400;

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Date", "Person", "Kg"]);
  }
  // Keep dates as plain text so Sheets doesn't convert them to date values.
  sheet.getRange("A:A").setNumberFormat("@");
  return sheet;
}

// Rows written before the column was text come back as Date objects.
function dateToString(value) {
  if (value && typeof value.getTime === "function") return formatDate(value);
  return String(value);
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getGoalsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(GOALS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(GOALS_SHEET_NAME);
    sheet.appendRow(["Person", "Goal Kg"]);
    PEOPLE.forEach((person) => sheet.appendRow([person, ""]));
  }
  return sheet;
}

function doGet() {
  const rows = getSheet().getDataRange().getValues().slice(1);
  const goalRows = getGoalsSheet().getDataRange().getValues().slice(1);
  return json({
    entries: rows
      .filter((row) => row[0] !== "")
      .map(([date, person, kg]) => ({
        date: dateToString(date),
        person,
        kg: Number(kg),
      })),
    goals: goalRows
      .filter(([person, kg]) => PEOPLE.includes(person) && kg !== "")
      .map(([person, kg]) => ({ person, kg: Number(kg) })),
  });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: "Invalid JSON" });
  }

  const { date, person } = body;
  const kg = Math.round(Number(body.kg) * 10) / 10;

  if (!PEOPLE.includes(person)) return json({ ok: false, error: "Unknown person" });
  if (!(kg >= MIN_KG && kg <= MAX_KG)) return json({ ok: false, error: "Weight out of range" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isNearToday(date)) {
    return json({ ok: false, error: "Date must be today" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (dateToString(rows[i][0]) === date && rows[i][1] === person) {
        sheet.getRange(i + 1, 3).setValue(kg);
        return json({ ok: true, updated: true });
      }
    }
    sheet.appendRow([date, person, kg]);
    return json({ ok: true, updated: false });
  } finally {
    lock.releaseLock();
  }
}

function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

// Allow yesterday..tomorrow so a different timezone on the viewer's device doesn't reject a valid "today".
function isNearToday(date) {
  const diffDays = Math.abs(new Date(date + "T12:00:00Z") - new Date()) / 86400000;
  return diffDays <= 1.6;
}
