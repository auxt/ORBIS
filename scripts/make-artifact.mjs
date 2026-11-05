// Writes dist/orbis-page.html: the single-file build without its document skeleton, for hosts that
// wrap a page themselves (for example a claude.ai artifact). Run after `npm run build`.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const html = readFileSync(new URL('dist/index.html', root), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>/g, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync(new URL('dist/orbis-page.html', root), `<meta name="claude:viewport-fit-sides" content="cover">\n${head.trim()}\n${body.trim()}\n`);
console.log('dist/orbis-page.html');
