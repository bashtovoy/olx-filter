import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'dist', 'chrome');
const sourceFiles = ['common.js', 'content.js', 'popup.html', 'popup.css', 'popup.js'];

function extractPageBridge(contentSource) {
  const startMarker = '// BEGIN PAGE BRIDGE';
  const endMarker = '// END PAGE BRIDGE';
  const start = contentSource.indexOf(startMarker);
  const end = contentSource.indexOf(endMarker);

  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not find page bridge markers in content.js');
  }

  const bridge = contentSource
    .slice(start + startMarker.length, end)
    .trim();

  return `(() => {\n  'use strict';\n${bridge}\n  pageBridge();\n})();\n`;
}

async function main() {
  const firefoxManifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8')
  );
  const contentSource = await readFile(join(root, 'content.js'), 'utf8');
  const { browser_specific_settings: _firefoxOnly, ...chromeManifest } = firefoxManifest;
  const pageBridgeSource = extractPageBridge(contentSource);

  chromeManifest.minimum_chrome_version = '111';
  chromeManifest.content_scripts = [
    {
      ...chromeManifest.content_scripts[0],
      js: ['page-bridge.js'],
      world: 'MAIN'
    },
    ...chromeManifest.content_scripts
  ];

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const file of sourceFiles) {
    await cp(join(root, file), join(outDir, file));
  }
  await cp(join(root, 'icons'), join(outDir, 'icons'), { recursive: true });
  await writeFile(join(outDir, 'page-bridge.js'), pageBridgeSource);

  await writeFile(
    join(outDir, 'manifest.json'),
    `${JSON.stringify(chromeManifest, null, 2)}\n`
  );

  for (const file of ['common.js', 'content.js', 'page-bridge.js', 'popup.js']) {
    execFileSync(process.execPath, ['--check', join(outDir, file)], {
      stdio: 'inherit'
    });
  }

  console.log(`Chrome build ready: ${outDir}`);
  console.log(`Version: ${chromeManifest.version}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
