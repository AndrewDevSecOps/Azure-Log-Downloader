'use strict';

/**
 * Lightweight file-backed state store.
 * Persists the timestamp of the last successful download cycle so the app
 * resumes correctly after a restart without re-downloading old blobs.
 */

const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const STATE_FILE = path.join(process.cwd(), '.last-run-state.json');

function loadLastRunTime(fallback) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const date = new Date(parsed.lastRunAt);
    if (isNaN(date.getTime())) throw new Error('Invalid date in state file');
    log('info', `Resuming from last run: ${date.toISOString()}`);
    return date;
  } catch {
    log('info', `No valid state file found. Using fallback date: ${fallback.toISOString()}`);
    return fallback;
  }
}

function saveLastRunTime(date) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastRunAt: date.toISOString() }, null, 2));
  } catch (err) {
    log('warn', `Could not persist state file: ${err.message}`);
  }
}

module.exports = { loadLastRunTime, saveLastRunTime };
