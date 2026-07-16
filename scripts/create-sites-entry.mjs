import { writeFileSync } from 'node:fs';

const entry = `import { startProdServer } from 'vinext/server/prod-server';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';
const serverDir = dirname(fileURLToPath(import.meta.url));

startProdServer({
  port,
  host,
  outDir: join(serverDir, '..'),
  rscEntryPath: join(serverDir, 'app.mjs'),
}).catch((error) => {
  console.error('[vinext] Failed to start Sites server');
  console.error(error);
  process.exit(1);
});
`;

writeFileSync('dist/sites-runtime-entry.mjs', entry);
writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }));
