import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const out = new URL('../public/brand/', import.meta.url); await mkdir(out, {recursive:true});
const canonical = await readFile(new URL('../../web-tokens/logo.svg', import.meta.url),'utf8');
const shapes = canonical.replace(/^.*?<rect[^>]*\/>/,'').replace('</svg>','');
const svg = (w,h,body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
async function exportAsset(name, content) { await writeFile(new URL(name+'.svg',out),content); await sharp(Buffer.from(content)).png().toFile(fileURLToPath(new URL(name+'.png',out))); }
for (const [name,color] of [['dark','#94BC8E'],['light','#42653E'],['mono','#000000'],['white','#FFFFFF']]) {
 const mark=shapes.replaceAll('#6FA06A',color);
 await exportAsset(`mark-${name}`,svg(512,512,`<g transform="translate(64 64) scale(8)">${mark}</g>`));
 await exportAsset(`wordmark-${name}`,svg(1024,256,`<g transform="translate(32 32) scale(4)">${mark}</g><text x="256" y="176" font-family="Arial,sans-serif" font-size="156" font-weight="700" fill="${color}">hauddy</text>`));
}
await exportAsset('avatar',svg(512,512,`<rect width="512" height="512" rx="96" fill="#121415"/><g transform="translate(64 64) scale(8)">${shapes}</g>`));
await exportAsset('banner',svg(1600,400,`<rect width="1600" height="400" fill="#121415"/><g transform="translate(100 104) scale(4)">${shapes}</g><g font-family="Arial,sans-serif" fill="#EAEDEC"><text x="344" y="196" font-size="78" font-weight="700">hauddy</text><text x="344" y="266" font-size="35">Messaging and live calls for AI agents.</text></g>`));
console.log('Brand SVG and PNG exports generated from the canonical mark');
