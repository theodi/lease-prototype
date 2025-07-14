// update-dataset.js
import 'dotenv/config.js';
import fs from 'fs';
import { parse } from 'csv-parse';
import mongoose from 'mongoose';
import Lease from './models/Lease.js';
import config from './config/index.js';
import readline from 'readline';
import LeaseTracker from './models/LeaseTracker.js';
import LeaseUpdateLog from './models/LeaseUpdateLog.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function promptUser(question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim().toLowerCase())));
}

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

function extractPostcode(originalRow) {
  const text = `${originalRow['Register Property Description'] || ''} ${originalRow['Associated Property Description'] || ''}`;
  const postcodeRegex = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/i;
  const match = text.match(postcodeRegex);
  return match ? match[0].toUpperCase().replace(/\s+/, ' ').trim() : null;
}

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

async function processChanges(csvPath, { dryRun = true } = {}) {
  await mongoose.connect(config.mongodbUri);
  if (DEBUG) console.log('📦 Connected to database.');

  const parser = fs.createReadStream(csvPath).pipe(parse({ columns: true, skip_empty_lines: true }));
  let deleteCount = 0, addCount = 0, unknownCount = 0, processedCount = 0, skippedCount = 0;

  // Extract lastUpdated from CSV filename
  const csvFileName = csvPath.split('/').pop();
  const lastUpdatedMatch = csvFileName && csvFileName.match(/(\d{4})_(\d{2})/);
  const lastUpdated = lastUpdatedMatch ? `${lastUpdatedMatch[1]}-${lastUpdatedMatch[2]}` : null;
  const updatedUids = new Set();

  // First, read and separate all rows
  const deleteRows = [];
  const addRows = [];
  for await (const originalRow of parser) {
    const indicator = (originalRow['Change Indicator'] || '').toUpperCase();
    if (indicator === 'D') deleteRows.push(originalRow);
    else if (indicator === 'A') addRows.push(originalRow);
  }
  console.log(`To delete: ${deleteRows.length}`);
  console.log(`To add: ${addRows.length}`);
  console.log('PROCESSING DELETE');

  // Helper to map row
  function mapRow(originalRow) {
    const mappedRow = {};
    for (const [key, shortKey] of Object.entries(FIELD_MAP)) {
      mappedRow[shortKey] = (originalRow[key] || '').toString().trim();
    }
    mappedRow.pc = extractPostcode(originalRow);
    return mappedRow;
  }

  // Process deletes first
  for (const originalRow of deleteRows) {
    const mappedRow = mapRow(originalRow);
    const uid = mappedRow.uid;
    const ro = mappedRow.ro;
    const apid = mappedRow.apid;
    const dbMatches = await Lease.find({ uid }).lean();
    const normalise = val => (val || '').toString().trim();
    const candidateMatches = dbMatches.filter(r => normalise(r.ro) === ro && normalise(r.apid) === apid);
    if (candidateMatches.length === 0) {
      if (DEBUG) console.log(`❌ Delete UID ${uid} — no matches for RO ${ro} and APID ${apid}`);
      unknownCount++;
      continue;
    }
    // If exactly one candidate match, delete it directly
    if (candidateMatches.length === 1) {
      if (DEBUG) console.log(`🗑️ Deleting single candidate match for UID ${uid}`);
      if (!dryRun) {
        await Lease.deleteOne({ _id: candidateMatches[0]._id });
        if (lastUpdated && !updatedUids.has(uid)) {
          await LeaseTracker.upsertLastUpdated(uid, lastUpdated);
          updatedUids.add(uid);
        }
      }
      deleteCount += 1;
      processedCount++;
      if (processedCount % 1000 === 0) {
        console.log(`📊 Processed ${processedCount} records...`);
      }
      continue;
    }
    const exactMatches = candidateMatches.filter(dbRow =>
      Object.entries(FIELD_MAP).every(([csvKey, dbKey]) =>
        (originalRow[csvKey] || '').toString().trim() === (dbRow[dbKey] || '').toString().trim()
      )
    );
    if (exactMatches.length > 0) {
      if (DEBUG) console.log(`🗑️ Would delete ${exactMatches.length} record(s) for UID ${uid}`);
      if (!dryRun) {
        const ids = exactMatches.map(doc => doc._id);
        await Lease.deleteMany({ _id: { $in: ids } });
        if (lastUpdated && !updatedUids.has(uid)) {
          await LeaseTracker.upsertLastUpdated(uid, lastUpdated);
          updatedUids.add(uid);
        }
      }
      deleteCount += exactMatches.length;
    } else {
      // Count character differences for ambiguous deletion
      let totalCharDiffs = 0;
      let charDiffDetails = [];
      for (const record of candidateMatches) {
        let recordDiffs = [];
        for (const [csvKey, dbKey] of Object.entries(FIELD_MAP)) {
          const csvVal = (originalRow[csvKey] || '').toString().trim();
          const dbVal = (record[dbKey] || '').toString().trim();
          if (csvVal !== dbVal) {
            const maxLen = Math.max(csvVal.length, dbVal.length);
            let charDiff = 0;
            for (let i = 0; i < maxLen; i++) {
              if (csvVal[i] !== dbVal[i]) charDiff++;
            }
            totalCharDiffs += charDiff;
            recordDiffs.push({ csvKey, csvVal, dbVal, charDiff });
          }
        }
        if (recordDiffs.length > 0) {
          charDiffDetails.push({ _id: record._id, diffs: recordDiffs });
        }
      }
      if (totalCharDiffs === 1) {
        // Treat as exact match, proceed with delete
        if (!dryRun) {
          await Lease.deleteMany({ _id: { $in: candidateMatches.map(d => d._id) } });
          if (lastUpdated && !updatedUids.has(uid)) {
            await LeaseTracker.upsertLastUpdated(uid, lastUpdated);
            updatedUids.add(uid);
          }
        }
        deleteCount += candidateMatches.length;
        continue;
      }
      // Only output details if user needs to make a choice
      console.log(`⚠️ Ambiguous deletion for UID ${uid} — no exact match:`);
      for (const detail of charDiffDetails) {
        console.log(`   ⚠️ _id: ${detail._id}`);
        for (const diff of detail.diffs) {
          console.log(`      🔸 ${diff.csvKey}: "${diff.csvVal}" ≠ "${diff.dbVal}" (char diff: ${diff.charDiff})`);
        }
      }
      console.log(`   🔢 Total character differences in this ambiguous deletion: ${totalCharDiffs}`);
      const choice = await promptUser('❓ [k]eep DB, [d]elete anyway, [s]kip? (k/d/s): ');
      if (choice === 'd' && !dryRun) {
        await Lease.deleteMany({ _id: { $in: candidateMatches.map(d => d._id) } });
        if (lastUpdated && !updatedUids.has(uid)) {
          await LeaseTracker.upsertLastUpdated(uid, lastUpdated);
          updatedUids.add(uid);
        }
        deleteCount += candidateMatches.length;
      } else if (choice === 'd') {
        deleteCount += candidateMatches.length;
      } else {
        unknownCount++;
      }
    }
    processedCount++;
    if (processedCount % 1000 === 0) {
      console.log(`📊 Processed ${processedCount} records...`);
    }
  }
  console.log('DELETE COMPLETE');
  console.log('BULK ADDING');

  // Process adds in bulk after all deletes
  if (!dryRun) {
    const BATCH_SIZE = 1000;
    let batch = [];
    let leaseTrackerOps = [];
    let batchCount = 0;
    for (const originalRow of addRows) {
      const mappedRow = mapRow(originalRow);
      batch.push(mappedRow);
      // Prepare LeaseTracker upserts for unique UIDs
      const uid = mappedRow.uid;
      if (lastUpdated && !updatedUids.has(uid)) {
        leaseTrackerOps.push({ updateOne: {
          filter: { uid },
          update: { $set: { lastUpdated } },
          upsert: true
        }});
        updatedUids.add(uid);
      }
      if (batch.length === BATCH_SIZE) {
        await Lease.insertMany(batch, { ordered: false });
        batchCount += batch.length;
        console.log(`📊 Bulk added ${batchCount} records so far...`);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await Lease.insertMany(batch, { ordered: false });
      batchCount += batch.length;
      console.log(`📊 Bulk added ${batchCount} records in total.`);
    }
    if (leaseTrackerOps.length > 0) {
      await LeaseTracker.bulkWrite(leaseTrackerOps);
    }
    addCount = addRows.length;
  } else {
    // Dry run: just count
    addCount = addRows.length;
    let processedCount = 0;
    for (const _ of addRows) {
      processedCount++;
      if (processedCount % 1000 === 0) {
        console.log(`📊 Would process ${processedCount} records...`);
      }
    }
  }

  console.log('\n🔍 Summary:');
  console.log(` - Additions: ${addCount}`);
  console.log(` - Deletions: ${deleteCount}`);
  console.log(` - Manual/Skipped: ${unknownCount}`);
  console.log(` - Skipped (bad columns): ${skippedCount}`);

  await mongoose.disconnect();
  rl.close();

  //Update the database

  if (!dryRun && lastUpdated) {
    await LeaseUpdateLog.updateOne(
      { version: lastUpdated },
      {
        $set: {
          added: addCount,
          deleted: deleteCount,
          skipped: skippedCount,
          manualReview: unknownCount,
          notes: `Change file: ${csvFileName}`
        }
      },
      { upsert: true }
    );
  }
}

// Usage: node run-changes.js path/to/file.csv --apply
const [,, csvPath, ...flags] = process.argv;
if (!csvPath) {
  console.error('❌ Usage: node run-changes.js path/to/changes.csv [--apply]');
  process.exit(1);
}

const dryRun = !flags.includes('--apply');
console.log(dryRun ? '🧪 Running in DRY-RUN mode — no database changes will be made.' : '🚨 APPLY mode — database will be modified.');

processChanges(csvPath, { dryRun }).catch(err => {
  if (err && err.name === 'CsvError' && /Invalid Record Length/.test(err.message)) {
    console.warn('⚠️ CSV Error:', err.message, '\nContinuing processing...');
    // Optionally, you could attempt to resume or just return here
    return;
  }
  console.error('❌ Error:', err);
  rl.close();
  process.exit(1);
});