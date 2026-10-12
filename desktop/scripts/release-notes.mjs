/**
 * desktop/scripts/release-notes.mjs
 * Prints the notes of a release: a short summary (the bold title of each point of that version in CHANGELOG.md) and a
 * link to the full changelog. Used by .github/workflows/desktop.yml.
 *
 *   node desktop/scripts/release-notes.mjs 2.30.0
 */
import fs from 'node:fs';
import path from 'node:path';

/** The most points the summary lists. */
const MAX_POINTS = 10;

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node release-notes.mjs <major.minor.patch>');
  process.exit(1);
}
const repo = process.env.GITHUB_REPOSITORY || 'Jondals/ChatterlyRenewed';
const changelog = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'CHANGELOG.md'),
  'utf8',
);

/** The bold title that opens a point of the changelog ("- **Title.** text"). */
function titleOf(line) {
  const match = /^- \*\*(.+?)\*\*/.exec(line);
  return match ? match[1].replace(/[.:]$/, '') : '';
}

/** True for a title that is not empty. */
function isFilled(title) {
  return title.length > 0;
}

const lines = changelog.split(/\r?\n/);
const start = lines.findIndex(function isHeading(line) {
  return line.trim() === '## ' + version;
});
let end = lines.length;
for (let i = start + 1; start >= 0 && i < lines.length; i++) {
  if (lines[i].startsWith('## ')) {
    end = i;
    break;
  }
}
const titles =
  start < 0
    ? []
    : lines
        .slice(start + 1, end)
        .map(titleOf)
        .filter(isFilled);
const shown = titles.slice(0, MAX_POINTS).map(function bullet(title) {
  return '- ' + title;
});
if (titles.length > MAX_POINTS) {
  shown.push('- and ' + (titles.length - MAX_POINTS) + ' more');
}
const base = 'https://github.com/' + repo + '/blob/v' + version;
console.log(
  [
    '## Chatterly ' + version,
    '',
    ...(shown.length ? shown : ['Small improvements and fixes.']),
    '',
    'Full details: [Changelog](' +
      base +
      '/CHANGELOG.md) · [Registro de cambios](' +
      base +
      '/CHANGELOG.es.md)',
    '',
    'Windows: download `Chatterly-Setup-' +
      version +
      '.exe`. The installer is not signed yet, so Windows may show its SmartScreen warning.',
  ].join('\n'),
);
