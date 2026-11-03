import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile, writeFile } from "node:fs/promises";
const source = await loadImage(await readFile("assets/icon.svg"));
const canvas = createCanvas(512, 512);
canvas.getContext("2d").drawImage(source, 0, 0, 512, 512);
await writeFile("assets/icon.png", canvas.toBuffer("image/png"));
const small = createCanvas(256, 256);
small.getContext("2d").drawImage(source, 0, 0, 256, 256);
const png = small.toBuffer("image/png");
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile("assets/icon.ico", Buffer.concat([header, png]));
for (let i = 0; i < 8; i++) {
  const tray = createCanvas(40, 40);
  const ctx = tray.getContext("2d");
  ctx.drawImage(source, 5, 5, 30, 30);
  ctx.strokeStyle = "#edac42";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(20, 20, 18, (i * Math.PI) / 4, (i * Math.PI) / 4 + Math.PI * 1.2);
  ctx.stroke();
  await writeFile(`assets/tray-${i}.png`, tray.toBuffer("image/png"));
}
