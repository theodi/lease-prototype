import fs from 'fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import crypto from 'crypto';
import path from 'path';
import { once } from 'events';

// Field name mapping
const FIELD_MAP = {
  'Unique Identifier': 'uid',
  'Register Property Description': 'rpd',
  'County': 'cty',
  'Region': 'rgn',
  'Associated Property Description ID': 'apid',
  'Associated Property Description': 'apd',
  'OS UPRN': 'uprn',
  'Price Paid': 'ppd',
  'Reg Order': 'ro',
  'Date of Lease': 'dol',
  'Term': 'term',
  'Alienation Clause Indicator': 'aci'
};

// Utility: Create hash of lease row (excluding Postcode)
function hashLeaseRecord(row) {
  const fields = { ...row };
  delete fields['Postcode'];
  const values = Object.keys(fields)
    .sort()
    .map(k => (fields[k] || '').toString().trim())
    .join('|');
  return crypto.createHash('sha256').update(values).digest('hex');
}

// Utility: Extract postcode from address fields
function extractPostcode(originalRow) {
  const text = `${originalRow['Register Property Description'] || ''} ${originalRow['Associated Property Description'] || ''}`;
  const postcodeRegex = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/i;
  const match = text.match(postcodeRegex);
  return match ? match[0].toUpperCase().replace(/\s+/, ' ').trim() : null;
}

async function processCSV(inputPath, outputBasePath) {
  const parser = fs.createReadStream(inputPath, { highWaterMark: 1024 * 1024 }).pipe(
    parse({ columns: true, skip_empty_lines: true })
  );

  const ROWS_PER_FILE = 1000000;
  let fileIndex = 1;
  let rowCount = 0;
  let output, stringifier;
  let headerKeys;

  function getOutputPath(base, idx) {
    const ext = path.extname(base);
    const name = path.basename(base, ext);
    const dir = path.dirname(base);
    return path.join(dir, `${name}-${idx}${ext}`);
  }

  async function openNewOutput() {
    if (stringifier) {
      stringifier.end();
      await once(stringifier, 'finish');
    }
    if (output) output.end();

    const outPath = getOutputPath(outputBasePath, fileIndex);
    output = fs.createWriteStream(outPath, { highWaterMark: 1024 * 1024 });
    stringifier = stringify({ header: true, columns: headerKeys });
    stringifier.pipe(output);
    console.log(`✍️  Writing to ${outPath}`);
    fileIndex++;
    rowCount = 0;
  }

  for await (const originalRow of parser) {
    // Drop 'Tenure' and map fields to short keys
    const row = {};

    for (const [originalKey, shortKey] of Object.entries(FIELD_MAP)) {
      row[shortKey] = originalRow[originalKey] || '';
    }

    // Add derived fields
    row.pc = extractPostcode(originalRow);
    row.hash = hashLeaseRecord(row);

    if (!headerKeys) {
      headerKeys = Object.keys(row);
      await openNewOutput();
    }

    if (rowCount >= ROWS_PER_FILE) {
      await openNewOutput();
    }

    const canWrite = stringifier.write(row);
    if (!canWrite) {
      await once(stringifier, 'drain');
    }

    rowCount++;
  }

  if (stringifier) {
    stringifier.end();
    await once(stringifier, 'finish');
  }
  if (output) output.end();

  console.log('✅ Finished writing split CSV files.');
}

// Usage: node prepare-csv.js input.csv output.csv
const [,, inputPath, outputBasePath] = process.argv;
if (!inputPath || !outputBasePath) {
  console.error('Usage: node prepare-csv.js input.csv output.csv');
  process.exit(1);
}

processCSV(inputPath, outputBasePath);