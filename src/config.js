'use strict';

require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '3600000', 10);
if (isNaN(POLL_INTERVAL_MS) || POLL_INTERVAL_MS < 1000) {
  throw new Error('POLL_INTERVAL_MS must be a number >= 1000');
}

const CONTAINER_NAMES = requireEnv('CONTAINER_NAMES')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (CONTAINER_NAMES.length === 0) {
  throw new Error('CONTAINER_NAMES must contain at least one container name');
}

module.exports = {
  // Auth — at least one of these groups must be present
  connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
  accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
  accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,

  containerNames: CONTAINER_NAMES,
  outputDir: process.env.OUTPUT_DIR ?? './downloaded-logs',
  pollIntervalMs: POLL_INTERVAL_MS,
  blobPrefix: process.env.BLOB_PREFIX ?? '',
  sinceDate: process.env.SINCE_DATE ? new Date(process.env.SINCE_DATE) : null,
};
