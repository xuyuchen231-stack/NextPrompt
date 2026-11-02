const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const manifest = JSON.parse(fs.readFileSync('extension/manifest.json'));
const files = [...manifest.content_scripts.flatMap(x => x.js), manifest.background.service_worker];
for (const file of files) cp.execFileSync(process.execPath, ['--check', path.join('extension', file)]);
for (const file of Object.values(manifest.icons)) if (!fs.existsSync(path.join('extension', file))) throw new Error('Missing icon: ' + file);
if (JSON.stringify(manifest.permissions) !== '["storage"]') throw new Error('Review changed permissions');
if (manifest.content_scripts.some(x => x.matches.some(y => y !== 'https://chatgpt.com/*'))) throw new Error('Unexpected host access');
for (const entry of manifest.web_accessible_resources || []) {
  if (JSON.stringify(entry.matches) !== '[\"https://chatgpt.com/*\"]') throw new Error('Unexpected asset host');
  for (const asset of entry.resources) if (!fs.existsSync(path.join('extension',asset))) throw new Error('Missing exposed asset: ' + asset);
}
console.log('Manifest, icons, JavaScript syntax and minimal permissions verified.');
