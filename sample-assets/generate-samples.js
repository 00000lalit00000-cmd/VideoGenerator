const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const outDir = path.join(__dirname);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const pngBase = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAkkB9W6AhJsAAAAASUVORK5CYII=';
for (let i = 1; i <= 3; i++) {
  fs.writeFileSync(path.join(outDir, `image${i}.png`), Buffer.from(pngBase, 'base64'));
}
const sampleRate = 22050;
const channels = 1;
const durationSec = 2;
const samplesCount = sampleRate * durationSec * channels;
const data = Buffer.alloc(samplesCount * 2);
for (let i = 0; i < samplesCount; i++) {
  const t = i / sampleRate;
  const sample = Math.round(Math.sin(2 * Math.PI * 440 * t) * 32767 * 0.2);
  data.writeInt16LE(sample, i * 2);
}
const wavHeader = Buffer.alloc(44);
wavHeader.write('RIFF', 0);
wavHeader.writeUInt32LE(36 + data.length, 4);
wavHeader.write('WAVE', 8);
wavHeader.write('fmt ', 12);
wavHeader.writeUInt32LE(16, 16);
wavHeader.writeUInt16LE(1, 20);
wavHeader.writeUInt16LE(channels, 22);
wavHeader.writeUInt32LE(sampleRate, 24);
wavHeader.writeUInt32LE(sampleRate * channels * 2, 28);
wavHeader.writeUInt16LE(channels * 2, 32);
wavHeader.writeUInt16LE(16, 34);
wavHeader.write('data', 36);
wavHeader.writeUInt32LE(data.length, 40);
const wavPath = path.join(outDir, 'audio.wav');
fs.writeFileSync(wavPath, Buffer.concat([wavHeader, data]));
const mp3Path = path.join(outDir, 'audio.mp3');
const result = spawnSync(ffmpegStatic, ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '128k', mp3Path], { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('FFmpeg conversion failed');
  process.exit(1);
}
fs.unlinkSync(wavPath);
console.log('Created sample assets in', outDir);
