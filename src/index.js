'use strict';

const config = require('./config');
const { runDownloadCycle } = require('./downloader');
const { loadLastRunTime, saveLastRunTime } = require('./stateStore');
const { log } = require('./logger');

async function main() {
  log('info', '=== Azure Log Downloader started ===');
  log('info', `Containers : ${config.containerNames.join(', ')}`);
  log('info', `Output dir : ${config.outputDir}`);
  log('info', `Poll every : ${config.pollIntervalMs / 1000}s`);

  // Determine the starting "since" date
  const fallbackSince = config.sinceDate ?? new Date();
  let since = loadLastRunTime(fallbackSince);

  // Run immediately on start, then on each interval tick
  since = await safeCycle(since);

  const interval = setInterval(async () => {
    since = await safeCycle(since);
  }, config.pollIntervalMs);

  // Allow the process to be shut down cleanly
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log('info', `Received ${signal}. Shutting down.`);
      clearInterval(interval);
      process.exit(0);
    });
  }
}

/**
 * Wrap a download cycle so that an unexpected error does not crash the process.
 * Returns the updated `since` value.
 */
async function safeCycle(since) {
  try {
    const nextSince = await runDownloadCycle(since);
    saveLastRunTime(nextSince);
    return nextSince;
  } catch (err) {
    log('error', `Unhandled error in download cycle: ${err.message}`);
    log('error', err.stack ?? '');
    // Keep the previous `since` so the next cycle re-tries the same window
    return since;
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
