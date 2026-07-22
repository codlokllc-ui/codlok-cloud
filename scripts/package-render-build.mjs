import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const standalone = join('.next', 'standalone');

mkdirSync(join(standalone, '.next'), { recursive: true });
cpSync('public', join(standalone, 'public'), { recursive: true });
cpSync(join('.next', 'static'), join(standalone, '.next', 'static'), { recursive: true });
