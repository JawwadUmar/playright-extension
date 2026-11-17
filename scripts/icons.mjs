import fs from 'node:fs/promises';
import zlib from 'node:zlib';

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}
await fs.mkdir('assets/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const corners = Math.hypot(Math.max(.16 - px, 0, px - .84), Math.max(.16 - py, 0, py - .84)) <= .16;
    const bracket = ((px > .23 && px < .29 || px > .71 && px < .77) && py > .27 && py < .73)
      || ((py > .27 && py < .33 || py > .67 && py < .73) && (px > .23 && px < .41 || px > .59 && px < .77))
      || Math.hypot(px - .5, py - .5) < .055;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set(bracket ? [102, 223, 201, 255] : [16, 43, 62, corners ? 255 : 0], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header.set([8, 6, 0, 0, 0], 8);
  await fs.writeFile(`assets/icons/${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
