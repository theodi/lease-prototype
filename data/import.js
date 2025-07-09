import 'dotenv/config.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import readline from 'readline';
import { parse } from 'csv-parse';
import crypto from 'crypto';
import config from '../config/index.js';
import Lease from '../models/Lease.js';

// ─────────────────────────────────────────────
// 🔧 Utility: Create hash of lease row (excluding Postcode)
// ─────────────────────────────────────────────
function hashLeaseRecord(row) {
  const fields = { ...row };
  delete fields['Postcode'];

  const values = Object.keys(fields)
    .sort()
    .map(k => (fields[k] || '').toString().trim())
    .join('|');

  return crypto.createHash('sha256').update(values).digest('hex');
}

// ─────────────────────────────────────────────
// 🔧 Utility: Extract postcode from address fields
// ─────────────────────────────────────────────
function extractPostcode(row) {
  const postcodeRegex = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/i;
  const text = `${row['Register Property Description'] || ''} ${row['Associated Property Description'] || ''}`;
  const match = text.match(postcodeRegex);
  return match ? match[0].toUpperCase().replace(/\s+/, ' ').trim() : null;
}

// ─────────────────────────────────────────────
// 🔁 Load CSV and import into DB
// ─────────────────────────────────────────────
async function importCSV(filePath) {
  await mongoose.connect(config.mongodbUri);
  console.log('✅ Connected to MongoDB');

  // Count total lines (excluding header)
  const totalLines = await new Promise((resolve, reject) => {
    let count = 0;
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', chunk => {
        for (let i = 0; i < chunk.length; ++i) {
          if (chunk[i] === 10) count++; // 10 is '\n'
        }
      })
      .on('end', () => resolve(count - 1)); // subtract 1 for header
  });
  console.log(`📊 Total rows to import: ${totalLines}`);

  const checkpointPath = path.join('.import-checkpoint');
  let rowCount = 0;
  let resumeFrom = 0;

  if (fs.existsSync(checkpointPath)) {
    const saved = fs.readFileSync(checkpointPath, 'utf-8');
    resumeFrom = parseInt(saved, 10) || 0;
    console.log(`🔁 Resuming import from row #${resumeFrom}`);
  }

  console.log('🧹 Deleting existing leases...');
  await Lease.deleteMany({});
  console.log('✅ Existing data cleared');

  const parser = fs.createReadStream(filePath).pipe(parse({ columns: true, skip_empty_lines: true }));

  const BATCH_SIZE = 10000;
  const MAX_PARALLEL = 4;
  let batch = [];
  let activePromises = [];
  let importedCount = 0;

  async function insertBatch(batchToInsert) {
    try {
      await Lease.insertMany(batchToInsert, { ordered: false });
    } catch (err) {
      console.warn('❌ Batch insert failed:', err.message);
    }
  }

  // Helper to remove settled promises
  async function waitForSlot(activePromises) {
    await Promise.race(activePromises);
    const results = await Promise.allSettled(activePromises);
    return activePromises.filter((_, i) => results[i].status === 'pending');
  }

  for await (const row of parser) {
    rowCount++;
    if (rowCount < resumeFrom) continue;

    row.Postcode = extractPostcode(row);
    row.RecordHash = hashLeaseRecord(row);
    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      if (activePromises.length >= MAX_PARALLEL) {
        activePromises = await waitForSlot(activePromises);
      }
      const promise = insertBatch(batch);
      activePromises.push(promise);
      importedCount += batch.length;
      batch = [];

      if (importedCount % 1000 === 0) {
        console.log(`📦 Imported ${importedCount} / ${totalLines} rows`);
        fs.writeFileSync(checkpointPath, rowCount.toString());
      }
    }
  }

  // Insert any remaining rows
  if (batch.length > 0) {
    if (activePromises.length >= MAX_PARALLEL) {
      activePromises = await waitForSlot(activePromises);
    }
    activePromises.push(insertBatch(batch));
    importedCount += batch.length;
    console.log(`📦 Imported ${importedCount} / ${totalLines} rows`);
    fs.writeFileSync(checkpointPath, rowCount.toString());
  }

  // Wait for all batches to finish
  await Promise.all(activePromises);

  console.log(`✅ Import complete — total rows imported: ${rowCount}`);
  fs.unlinkSync(checkpointPath); // remove checkpoint
  mongoose.disconnect();
}

// ─────────────────────────────────────────────
// 🏁 Entry
// ─────────────────────────────────────────────
const csvFile = process.argv[2];
if (!csvFile || !fs.existsSync(csvFile)) {
  console.error('❌ Please provide a valid CSV file path: node import.js path/to/file.csv');
  process.exit(1);
}

importCSV(csvFile);