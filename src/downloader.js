'use strict';

const fs = require('fs');
const path = require('path');
const { createBlobServiceClient, listNewBlobs, downloadBlob } = require('./storage');
const config = require('./config');
const { log } = require('./logger');

/**
 * Run one download cycle across all configured containers.
 * Returns the timestamp that should be used as the "since" marker for the next run.
 *
 * @param {Date} since  - only blobs modified after this date are downloaded
 * @returns {Promise<Date>}  - timestamp to use as `since` on the next run
 */
async function runDownloadCycle(since) {
  log('info', `Starting download cycle. Fetching blobs modified after ${since.toISOString()}`);

  const client = createBlobServiceClient();
  // Mark the start so we don't miss blobs written while we are iterating
  const cycleStart = new Date();
  let totalDownloaded = 0;
  let totalSkipped = 0;

  for (const containerName of config.containerNames) {
    log('info', `Scanning container: ${containerName}`);

    try {
      for await (const blob of listNewBlobs(client, containerName, since)) {
        const localPath = buildLocalPath(containerName, blob.name);
        const alreadyExists = fileExistsWithSameSize(localPath, blob.properties.contentLength);

        if (alreadyExists) {
          totalSkipped++;
          continue;
        }

        await ensureDir(path.dirname(localPath));

        log('info', `Downloading: ${containerName}/${blob.name} → ${localPath}`);

        try {
          const writeStream = fs.createWriteStream(localPath);
          await downloadBlob(client, containerName, blob.name, writeStream);
          totalDownloaded++;
          log('info', `  Saved: ${localPath}`);
        } catch (err) {
          log('error', `  Failed to download ${blob.name}: ${err.message}`);
          // Remove partial file so it will be retried next cycle
          fs.unlink(localPath, () => {});
        }
      }
    } catch (err) {
      log('error', `Error scanning container "${containerName}": ${err.message}`);
    }
  }

  log(
    'info',
    `Cycle complete. Downloaded: ${totalDownloaded}, Skipped (already exists): ${totalSkipped}`
  );

  return cycleStart;
}

/**
 * Map a blob path to a local file path under the output directory.
 * Container name is used as the top-level folder to avoid name collisions.
 *
 * Example:
 *   container = "logs"
 *   blobName  = "mysite/LogFiles/2024/01/01/http.log"
 *   → <outputDir>/logs/mysite/LogFiles/2024/01/01/http.log
 */
function buildLocalPath(containerName, blobName) {
  // Normalise Windows-style separators that can appear in blob names
  const safeName = blobName.replace(/\\/g, '/');
  return path.join(config.outputDir, containerName, ...safeName.split('/'));
}

function fileExistsWithSameSize(filePath, expectedSize) {
  try {
    const stat = fs.statSync(filePath);
    return stat.size === expectedSize;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

module.exports = { runDownloadCycle };
