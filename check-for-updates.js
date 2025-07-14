import 'dotenv/config.js';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import mongoose from 'mongoose';
import config from './config/index.js';
import LeaseUpdateLog from './models/LeaseUpdateLog.js';
import unzipper from 'unzipper';
import { pipeline } from 'stream/promises';


// Config
const API_BASE = 'https://use-land-property-data.service.gov.uk/api/v1/datasets/leases';
const DATA_DIR = './data';

// Extract YYYY-MM version from filename
function extractVersionFromFilename(filename) {
  const match = filename.match(/_(\d{4})_(\d{2})\.zip$/);
  return match ? `${match[1]}-${match[2]}` : null;
}

// Download file with auth header
async function downloadFileWithAuth(url, filePath, headers) {
  const res = await fetch(url);

  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`Download failed with status ${res.status}`);
    console.error('Response body:', errorBody);
    throw new Error(`Failed to download file: ${res.status}`);
  }

  const fileStream = fs.createWriteStream(filePath);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on('error', reject);
    fileStream.on('finish', resolve);
  });
}


async function checkForUpdate() {
  await mongoose.connect(config.mongodbUri);
  console.log('Connected to MongoDB');

  const headers = { Authorization: config.govuk.apiKey };

  // Step 1: Fetch dataset metadata
  const res = await fetch(API_BASE, { headers });
  if (!res.ok) throw new Error(`Failed to fetch dataset metadata: ${res.status}`);
  const { result } = await res.json();

  const changeFile = result.resources.find(r => r.name === 'Change Only File');
  if (!changeFile) throw new Error('Change Only File not found in dataset');

  const version = extractVersionFromFilename(changeFile.file_name);
  if (!version) throw new Error('Could not extract version from filename');

  const alreadyApplied = await LeaseUpdateLog.findOne({ version }).lean();
  if (alreadyApplied) {
    console.log(`Version ${version} already applied. Exiting.`);
    process.exit(0);
  }

  console.log(`New version found: ${version}`);

  // Step 2: Get signed download URL
  const fileMetaRes = await fetch(`${API_BASE}/${changeFile.file_name}`, { headers });
  if (!fileMetaRes.ok) throw new Error(`Failed to fetch file metadata: ${fileMetaRes.status}`);
  const { result: fileMeta } = await fileMetaRes.json();

  const fileUrl = fileMeta.download_url;
  const filePath = path.join(DATA_DIR, changeFile.file_name);

  console.log(`Downloading file to ${filePath}...`);
  await downloadFileWithAuth(fileUrl, filePath, headers);

  console.log(`File downloaded successfully: ${filePath}`);

  await unzipAndCleanCsv(filePath);

  process.exit(0);
}

// Unzip the file and process the CSV
async function unzipAndCleanCsv(zipPath) {
  console.log(`Extracting ZIP: ${zipPath}`);

  const directory = await unzipper.Open.file(zipPath);
  const csvEntry = directory.files.find(file => file.path.toLowerCase().endsWith('.csv'));

  if (!csvEntry) throw new Error('No CSV file found in ZIP');

  const csvPath = path.join(DATA_DIR, csvEntry.path);

  await pipeline(
    csvEntry.stream(),
    fs.createWriteStream(csvPath)
  );

  console.log(`Extracted CSV to ${csvPath}`);

  await cleanCsvTrailingRowCount(csvPath);
}

async function cleanCsvTrailingRowCount(csvPath) {
  let lines = fs.readFileSync(csvPath, 'utf-8').split('\n');

  // Remove blank lines at end
  while (lines.length && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  // Find the last Row Count line
  const rowCountIndex = lines.findIndex(line =>
    /^"Row Count:"\s*,\s*"\d+"\s*$/.test(line.trim())
  );

  if (rowCountIndex !== -1) {
    lines = lines.slice(0, rowCountIndex);
    fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf-8');
    console.log('Removed Row Count line and any trailing content');
  } else {
    console.log('No Row Count line found at end of CSV');
  }
}

checkForUpdate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});