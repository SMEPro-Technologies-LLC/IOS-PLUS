#!/usr/bin/env node

const fs = require("node:fs");

const docPath = "docs/ios_plus_diligence_sections_2_3_4_6.md";
const content = fs.readFileSync(docPath, "utf8");

const prohibitedPhrases = [
  "consistently blocked all multi-model jailbreaks",
  "measurably reduced adversarial bypass rates",
  "intent laundering is prevented",
  "are expected to produce structured client-error behavior",
  "thresholds assert no 5xx",
];

const lines = content.split(/\r?\n/);
const violations = [];
for (const phrase of prohibitedPhrases) {
  const phraseLower = phrase.toLowerCase();
  for (const line of lines) {
    const lineLower = line.toLowerCase();
    if (!lineLower.includes(phraseLower)) {
      continue;
    }
    const allowedQuotedBullet = line.trimStart().toLowerCase().startsWith(`- “${phraseLower}`);
    if (!allowedQuotedBullet) {
      violations.push(phrase);
      break;
    }
  }
}

if (violations.length > 0) {
  console.error("Diligence-claims guard failed.");
  for (const phrase of violations) {
    console.error(`- prohibited framing present: "${phrase}"`);
  }
  process.exit(1);
}

console.log("Diligence-claims guard passed.");
