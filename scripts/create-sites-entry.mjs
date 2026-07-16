import { writeFileSync } from 'node:fs';

const entry = `import { startProdServer } from 'vinext/server/prod-server';
import { join } from 'node:path';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';

startProdServer({
  port,
  host,
  outDir: join(import.meta.dirname, '..'),
  rscEntryPath: join(import.meta.dirname, 'app.mjs'),
}).catch((error) => {
  console.error('[vinext] Failed to start Sites server');
  console.error(error);
  process.exit(1);
});
`;

writeFileSync('dist/server/index.js', entry);
writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }));
