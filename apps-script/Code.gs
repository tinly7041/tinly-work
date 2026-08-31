// apps-script/Code.gs
//
// IMPORTANT: This file is a PROPOSED addition to the Google Apps Script
// deployment. It has NOT been verified against the real deployed script —
// Tin must review line-by-line before replacing anything live. The real
// deployed script handles the existing 13-column lead schema; this file
// extends it with 3 new trailing columns and adds two new action branches.
//
// After pasting into the Apps Script editor, Tin must:
//   1. Deploy as a NEW deployment (not edit the existing one)
//   2. Copy the new /exec URL
//   3. Update the APPS_SCRIPT_URL env var in Netlify
//   4. The old /exec URL stops working once the old deployment is removed
//
// Action branches:
//   "lead" (default when action is omitted) — write a lead row to the main sheet
//   "lead_failure"      — write to the "failures" tab + send Tin alert email
//   "lead_fallback"     — send the lead-facing fallback email
//   "health"            — existing health alert (from crawl-trends.js)
//   "report"            — deliver the pulse report to the lead via email;
//                          payload.reportHtml is fully composed by Netlify
//                          (lib/lead-store.js's buildReportHtml) — this
//                          branch only relays it via MailApp, never builds
//                          or reformats the copy itself
//
// Column order (16 columns total):
//   A: Timestamp, B: Name, C: Email, D: Whatsapp, E: Telegram,
//   F: Role, G: Company, H: Brand Name, I: Website, J: Category,
//   K: Confidence, L: Direct Count, M: Report Sent,
//   N: competitors_source, O: competitors_list, P: quiet_cause

var EXPECTED_SECRET = PropertiesService.getScriptProperties().getProperty("SECRET");
var TIN_EMAIL = PropertiesService.getScriptProperties().getProperty("TIN_EMAIL");
var SHEET_NAME = "leads";
var FAILURES_SHEET_NAME = "failures";

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (payload.secret !== EXPECTED_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ error: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var action = payload.action || "lead";

    if (action === "lead") {
      return handleLead(payload);
    } else if (action === "lead_failure") {
      return handleLeadFailure(payload);
    } else if (action === "lead_fallback") {
      return handleLeadFallback(payload);
    } else if (action === "health") {
      return handleHealth(payload);
    } else if (action === "report") {
      return handleReport(payload);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: "unknown_action" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleLead(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      "Timestamp", "Name", "Email", "Whatsapp", "Telegram",
      "Role", "Company", "Brand Name", "Website", "Category",
      "Confidence", "Direct Count", "Report Sent",
      "competitors_source", "competitors_list", "quiet_cause"
    ]);
  }

  sheet.appendRow([
    payload.timestamp || new Date().toISOString(),
    payload.name || "",
    payload.email || "",
    payload.whatsapp || "",
    payload.telegram || "",
    payload.role || "",
    payload.company || "",
    payload.brandName || "",
    payload.website || "",
    payload.category || "",
    payload.confidence || "",
    payload.directCount || "",
    payload.reportSent || "No",
    payload.competitors_source || "",
    payload.competitors_list || "",
    payload.quiet_cause || ""
  ]);

  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleLeadFailure(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FAILURES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(FAILURES_SHEET_NAME);
    sheet.appendRow(["Timestamp", "Email", "Brand Name", "Error Code"]);
  }

  sheet.appendRow([
    payload.timestamp || new Date().toISOString(),
    payload.email || "",
    payload.brandName || "",
    payload.errorCode || ""
  ]);

  // Send Tin-facing alert
  if (TIN_EMAIL) {
    MailApp.sendEmail({
      to: TIN_EMAIL,
      subject: "[Trend Pulse] Report delivery failed: " + (payload.brandName || "unknown"),
      body: "A report could not be delivered.\n\n"
        + "Lead email: " + (payload.email || "unknown") + "\n"
        + "Brand: " + (payload.brandName || "unknown") + "\n"
        + "Error code: " + (payload.errorCode || "unknown") + "\n"
        + "Time: " + (payload.timestamp || new Date().toISOString()) + "\n"
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleLeadFallback(payload) {
  if (!payload.email) {
    return ContentService.createTextOutput(JSON.stringify({ error: "missing_email" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  MailApp.sendEmail({
    to: payload.email,
    subject: "Your Trend Pulse for " + (payload.brandName || "your brand"),
    body: payload.emailBody || "[FALLBACK COPY PENDING]"
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleHealth(payload) {
  if (TIN_EMAIL) {
    MailApp.sendEmail({
      to: TIN_EMAIL,
      subject: payload.subject || "[Trend Pulse] Health alert",
      body: payload.body || "No details provided."
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleReport(payload) {
  if (!payload.email) {
    return ContentService.createTextOutput(JSON.stringify({ error: "missing_email" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // reportHtml is fully composed by Netlify (lib/lead-store.js's
  // buildReportHtml) — this branch only relays it. Report copy/formatting
  // lives in exactly one place, same principle as the fallback email body.
  MailApp.sendEmail({
    to: payload.email,
    subject: "Your Trend Pulse: " + (payload.brandName || "Report"),
    htmlBody: payload.reportHtml || "(no report content)"
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}
