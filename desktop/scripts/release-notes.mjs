/**
 * desktop/scripts/release-notes.mjs
 * Prints the notes of a release: a short summary (the bold title of each point of that version in CHANGELOG.md) and a
 * link to the full changelog. Used by .github/workflows/desktop.yml.
 *
 *   node desktop/scripts/release-notes.mjs 2.30.0
 *   node desktop/scripts/release-notes.mjs 2.32.0-beta.5 v2.32.0-b1   (a build of the beta branch: the points of 2.32.0, a
 *                                                                     warning, and the name people read for it)
 */
import fs from 'node:fs';
import path from 'node:path';

/** The most points the summary lists. */
const MAX_POINTS = 10;

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(version || '')) {
  console.error('Usage: node release-notes.mjs <major.minor.patch>[-beta.<n>]');
  process.exit(1);
}
const beta = version.includes('-beta.');
const base = version.replace(/-.*$/, '');
/** What people read: v2.32.0 for a release and v2.32.0-b1 for the first beta of it (given by the workflow). */
const label = process.argv[3] || 'v' + version;
/** The part that names the files: 2.32.0 or 2.32.0-b1. */
const fileLabel = label.replace(/^v/, '');
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
  return line.trim() === '## ' + base;
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
const blob = 'https://github.com/' + repo + '/blob/v' + version;
const warning = beta
  ? [
      '**Beta version** for the testers of the project: it is still being tried and can have mistakes.',
      '',
    ]
  : [];
console.log(
  [
    '## Chatterly ' + label,
    '',
    ...warning,
    ...(shown.length ? shown : ['Small improvements and fixes.']),
    '',
    'Full details: [Changelog](' +
      blob +
      '/CHANGELOG.md) · [Registro de cambios](' +
      blob +
      '/CHANGELOG.es.md)',
    '',
    'Windows: download `Chatterly-' +
      fileLabel +
      '.exe`. The installer is not signed yet, so Windows may show its SmartScreen warning.',
    '',
    'Linux: download `Chatterly-' + fileLabel + '.AppImage` (make it executable and run it).',
  ].join('\n'),
);
