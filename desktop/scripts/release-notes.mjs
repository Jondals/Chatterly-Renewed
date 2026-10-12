/**
 * desktop/scripts/release-notes.mjs
 * Prints the notes of a release: the section of CHANGELOG.md for that version. Used by .github/workflows/desktop.yml.
 *
 *   node desktop/scripts/release-notes.mjs 2.27.0
 */
import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node release-notes.mjs <major.minor.patch>');
  process.exit(1);
}
const changelog = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'CHANGELOG.md'),
  'utf8',
);
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex(function isHeading(line) {
  return line.trim() === '## ' + version;
});
if (start < 0) {
  console.log('Chatterly ' + version);
} else {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  console.log(
    lines
      .slice(start + 1, end)
      .join('\n')
      .trim(),
  );
}
