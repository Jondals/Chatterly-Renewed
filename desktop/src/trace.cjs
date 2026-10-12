/**
 * desktop/src/trace.cjs
 * Start-up timings, for measuring and not for users: with CHATTERLY_TRACE=<file> each step writes one line there
 * (milliseconds since the process started). Without the variable it does nothing at all.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ! Only a plain text file at an absolute path: the variable must not turn the app into a way to write anywhere.
const wanted = process.env.CHATTERLY_TRACE || '';
const file = path.isAbsolute(wanted) && /\.(txt|log)$/i.test(wanted) ? wanted : '';

/** Writes "<ms> <name>" to the trace file. */
function trace(name) {
  if (!file) return;
  try {
    fs.appendFileSync(file, Math.round(performance.now()) + ' ' + name + '\n');
  } catch (error) {
    // Tracing must never break the app.
  }
}

module.exports = { trace };
