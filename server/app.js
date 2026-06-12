const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const gTTS = require('gtts');
const { spawnAsync, resolveExecutable, formatSubtitlePath, buildSubtitles } = require('./utils/ffmpeg');

const app = express();
const PORT = process.env.PORT || 4000;
const uploadsDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');

async function ensureDirectories() {
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
}

function createStorage() {
  return multer.diskStorage({
    destination: uploadsDir,
    filename(req, file, cb) {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${timestamp}-${safeName}`);
    }
  });
}

function createUploadHandler() {
  const storage = createStorage();
  return multer({ storage, limits: { fileSize: 1024 * 1024 * 150 } }).fields([
    { name: 'images', maxCount: 30 },
    { name: 'audio', maxCount: 1 }
  ]);
}

async function getAudioDuration(audioPath) {
  try {
    const { stdout } = await spawnAsync(resolveExecutable('ffprobe'), [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath
    ]);

    const duration = parseFloat(stdout.trim());
    if (Number.isNaN(duration) || duration <= 0) {
      throw new Error('Unable to determine audio duration.');
    }

    return duration;
  } catch (error) {
    if (error.code === 'ENOENT' || error.message?.includes('Executable not found')) {
      const { stderr } = await spawnAsync(resolveExecutable('ffmpeg'), ['-hide_banner', '-i', audioPath]);
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (!match) {
        throw new Error('Unable to determine audio duration from ffmpeg output. Install ffprobe or set the correct FFMPEG_PATH.');
      }

      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      return hours * 3600 + minutes * 60 + seconds;
    }

    throw error;
  }
}

function getWindowsVoiceName(gender) {
  const voices = {
    male: 'Microsoft David Desktop',
    female: 'Microsoft Zira Desktop'
  };
  const key = String(gender || 'female').toLowerCase();
  return voices[key] || voices.female;
}

function splitTextIntoChunks(text, maxLength = 1000) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized.split(/(?<=[.!?।])\s+/);
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      const words = sentence.split(' ');
      let piece = '';
      for (const word of words) {
        if ((piece + ' ' + word).trim().length > maxLength) {
          if (piece) {
            chunks.push(piece.trim());
          }
          piece = word;
        } else {
          piece = `${piece} ${word}`.trim();
        }
      }
      if (piece) {
        chunks.push(piece.trim());
      }
      continue;
    }

    if ((current + ' ' + sentence).trim().length > maxLength) {
      if (current) {
        chunks.push(current.trim());
      }
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks;
}

async function saveGTTSAudioChunk(text, lang, outPath) {
  return new Promise((resolve, reject) => {
    const speech = new gTTS(text, lang);
    speech.save(outPath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function generateGTTSAudio(text, lang, outputPath) {
  const chunks = splitTextIntoChunks(text, 100);
  if (!chunks.length) {
    throw new Error('No text provided for TTS generation.');
  }

  const chunkFiles = [];
  const baseTimestamp = Date.now();
  const listFile = path.join(outputDir, `tts-list-${baseTimestamp}.txt`);

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const chunkPath = path.join(outputDir, `tts-${baseTimestamp}-${index}.mp3`);
      await saveGTTSAudioChunk(chunks[index], lang, chunkPath);
      chunkFiles.push(chunkPath);
    }

    const listContent = chunkFiles.map((filePath) => `file '${filePath.replace(/'/g, "''")}'`).join('\n');
    await fs.writeFile(listFile, listContent, 'utf8');

    await spawnAsync(resolveExecutable('ffmpeg'), [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outputPath
    ]);
  } finally {
    await cleanupFiles([...chunkFiles, listFile]);
  }
}

async function mergeWavFiles(wavFiles, mergedWav) {
  const listFile = path.join(outputDir, `tts-list-${Date.now()}.txt`);
  const listContent = wavFiles.map((wavPath) => `file '${wavPath.replace(/'/g, "''")}'`).join('\n');
  await fs.writeFile(listFile, listContent, 'utf8');

  try {
    await spawnAsync(resolveExecutable('ffmpeg'), [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      mergedWav
    ]);
  } finally {
    await cleanupFiles([listFile]);
  }
}

async function generateWindowsSpeechAudio(text, voice, outputPath) {
  const chunks = splitTextIntoChunks(text, 1200);
  const chunkWavs = [];
  const tempFiles = [];
  const baseTimestamp = Date.now();
  const mergedWav = outputPath.replace(/\.mp3$/i, `-${baseTimestamp}-merged.wav`);

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const chunkTextFile = path.join(outputDir, `tts-${baseTimestamp}-${index}.txt`);
      const chunkWavPath = outputPath.replace(/\.mp3$/i, `-${baseTimestamp}-chunk-${index}.wav`);
      const chunkScriptFile = path.join(outputDir, `tts-script-${baseTimestamp}-${index}.ps1`);

      await fs.writeFile(chunkTextFile, chunk, 'utf8');
      tempFiles.push(chunkTextFile, chunkScriptFile, chunkWavPath);

      const escapedWavPath = chunkWavPath.replace(/'/g, "''");
      const escapedTextPath = chunkTextFile.replace(/'/g, "''");
      const script = `Add-Type -AssemblyName System.Speech\n` +
        `$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer\n` +
        `$synth.SelectVoice('${voice}')\n` +
        `$synth.SetOutputToWaveFile('${escapedWavPath}')\n` +
        `$text = Get-Content -Path '${escapedTextPath}' -Raw -Encoding UTF8\n` +
        `$synth.Speak($text)`;

      await fs.writeFile(chunkScriptFile, script, 'utf8');
      await spawnAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', chunkScriptFile]);
      chunkWavs.push(chunkWavPath);
    }

    console.log('generateWindowsSpeechAudio: merging wavs ->', chunkWavs.length, 'chunks, mergedWav=', mergedWav);
    await mergeWavFiles(chunkWavs, mergedWav);
    await spawnAsync(resolveExecutable('ffmpeg'), [
      '-y',
      '-i', mergedWav,
      '-codec:a', 'libmp3lame',
      '-b:a', '192k',
      outputPath
    ]);
  } finally {
    const toCleanup = [...tempFiles, ...chunkWavs];
    if (typeof mergedWav !== 'undefined') toCleanup.push(mergedWav);
    console.log('generateWindowsSpeechAudio: cleanup files count=', toCleanup.length);
    await cleanupFiles(toCleanup);
  }
}

function getXfadeTransition(effect) {
  const transitionMap = {
    fade: 'fade',
    zoom: 'zoomin',
    slide: 'slideleft',
    flip: 'circlecrop',
    bounce: 'squeeze',
    pan: 'slideup',
    blur: 'pixelize',
    glitch: 'dissolve',
    rotate: 'circlecrop',
    wipe: 'wipeleft',
    sparkle: 'blend',
  };

  return transitionMap[effect] || 'fade';
}

async function createSlideshowVideo(images, imageDuration, outputVideoPath, dimensions, animationEffect = 'none') {
  const args = ['-y'];
  const { width, height } = dimensions;

  images.forEach((imagePath) => {
    args.push('-loop', '1', '-t', String(imageDuration), '-i', imagePath);
  });

  const videoFilters = images
    .map((_, index) => {
      return `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${index}]`;
    })
    .join(';');

  let filterComplex;
  if (images.length === 1 || animationEffect === 'none') {
    const inputLabels = images.map((_, index) => `[v${index}]`).join('');
    filterComplex = `${videoFilters};${inputLabels}concat=n=${images.length}:v=1:a=0,format=yuv420p[v]`;
  } else {
    const transition = getXfadeTransition(animationEffect);
    const xfadeDuration = Math.min(0.8, imageDuration / 2);
    const filterParts = [];
    let currentLabel = `[v0]`;

    console.log(`Creating slideshow with animation effect: ${animationEffect} (transition: ${transition})`);

    for (let index = 1; index < images.length; index += 1) {
      const nextLabel = `[v${index}]`;
      const outputLabel = `[x${index}]`;
      const offset = (index * imageDuration) - (index * xfadeDuration);
      filterParts.push(`${currentLabel}${nextLabel}xfade=transition=${transition}:duration=${xfadeDuration}:offset=${offset}${outputLabel}`);
      currentLabel = outputLabel;
    }

    filterComplex = `${videoFilters};${filterParts.join(';')};${currentLabel}format=yuv420p[v]`;
  }

  console.log(`FFmpeg filter complex: ${filterComplex}`);

  args.push(
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-r', '30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    outputVideoPath
  );

  console.log(`Executing FFmpeg with ${images.length} images, animation: ${animationEffect}`);
  await spawnAsync(resolveExecutable('ffmpeg'), args);
}

function getVideoDimensions(videoType) {
  switch (videoType) {
    case 'story':
      return { width: 720, height: 1280 };
    case 'real':
      return { width: 1080, height: 1920 };
    default:
      return { width: 1920, height: 1080 };
  }
}

async function mergeAudioAndSubtitles(videoPath, audioPath, subtitlePath, finalOutputPath) {
  const args = ['-y', '-i', videoPath, '-i', audioPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest'];

  if (subtitlePath) {
    const subtitleFilter = `subtitles='${formatSubtitlePath(subtitlePath)}':force_style='FontName=Arial,FontSize=24,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,BackColour=&H80000000&'`;
    args.push('-vf', subtitleFilter);
  }

  args.push(finalOutputPath);
  await spawnAsync(resolveExecutable('ffmpeg'), args);
}

function cleanupFiles(filePaths = []) {
  return Promise.all(
    filePaths.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        // ignore cleanup errors
      }
    })
  );
}

app.use(cors());
app.use(express.json());
app.use('/download', express.static(outputDir));

const clientDist = path.join(__dirname, '../client/dist');
if (fsSync.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Audio generation route
app.post('/api/generate-audio', async (req, res) => {
  try {
    const { text, language, gender } = req.body;

    console.log(`Received audio request: text="${typeof text}", language="${language}", gender="${gender}"`);

    if (!text || (typeof text === 'string' && !text.trim())) {
      return res.status(400).json({ error: 'Please provide text to convert.' });
    }

    if (!language) {
      return res.status(400).json({ error: 'Please select a language.' });
    }

    console.log(`Generating audio: text="${String(text).substring(0, 50)}...", language=${language}, gender=${gender}`);

    // Map language codes for fallback TTS
    const languageMap = {
      'hi': 'hi',        // Hindi
      'en-IN': 'en',     // Indian English
      'en-US': 'en',     // US English
      'mr': 'mr'         // Marathi
    };

    const mappedLang = String(languageMap[language] || language).trim();
    const textString = String(text).trim();

    console.log(`Mapped language: "${mappedLang}", text length: ${textString.length}`);

    // Save audio file
    const audioFileName = `audio-${Date.now()}.mp3`;
    const audioPath = path.join(outputDir, audioFileName);

    const useWindowsNativeVoice = process.platform === 'win32' && ['en-IN', 'en-US'].includes(language);

    if (useWindowsNativeVoice) {
      const voiceName = getWindowsVoiceName(gender);
      console.log(`Using Windows voice: ${voiceName}`);
      await generateWindowsSpeechAudio(textString, voiceName, audioPath);
    } else {
      console.log(`Using gTTS for language: ${mappedLang}`);
      await generateGTTSAudio(textString, mappedLang, audioPath);
    }

    console.log(`Audio generated successfully: ${audioFileName}`);

    return res.json({ downloadUrl: `/download/${audioFileName}` });
  } catch (error) {
    console.error('Audio generation error:', error);
    return res.status(500).json({ error: error.message || 'Audio generation failed.' });
  }
});

app.post('/api/render', async (req, res) => {
  const upload = createUploadHandler();

  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }

    try {
      const images = (req.files.images || []).map((file) => file.path);
      const audioFile = req.files.audio?.[0];
      const script = (req.body.script || '').toString().trim();
      let animationEffects = [];
      if (req.body.animationEffects) {
        try {
          animationEffects = JSON.parse(req.body.animationEffects);
        } catch (parseError) {
          animationEffects = Array.isArray(req.body.animationEffects)
            ? req.body.animationEffects
            : [req.body.animationEffects];
        }
      }
      const animationEffect = animationEffects.length ? String(animationEffects[0]) : 'none';
      console.log(`Received animationEffects: ${JSON.stringify(animationEffects)}, using: ${animationEffect}`);
      let videoOptions = [];
      try {
        videoOptions = req.body.videoOptions ? JSON.parse(req.body.videoOptions) : [];
      } catch (parseError) {
        videoOptions = [];
      }

      if (!images.length) {
        return res.status(400).json({ error: 'Please upload at least one image.' });
      }

      if (!audioFile) {
        return res.status(400).json({ error: 'Please upload one MP3 audio file.' });
      }

      const audioDuration = await getAudioDuration(audioFile.path);
      const imageDuration = audioDuration / images.length;
      const videoType = (req.body.videoType || 'desktop').toString();
      const dimensions = getVideoDimensions(videoType);
      const now = Date.now();
      const slideshowPath = path.join(outputDir, `slideshow-${videoType}-${now}.mp4`);
      const finalFilename = `video-${videoType}-${now}.mp4`;
      const finalPath = path.join(outputDir, finalFilename);

      await createSlideshowVideo(images, imageDuration, slideshowPath, dimensions, animationEffect);

      let subtitlePath = null;
      if (script) {
        const subtitleText = buildSubtitles(script, audioDuration);
        if (subtitleText) {
          subtitlePath = path.join(outputDir, `subtitles-${now}.srt`);
          await fs.writeFile(subtitlePath, subtitleText, 'utf8');
        }
      }

      await mergeAudioAndSubtitles(slideshowPath, audioFile.path, subtitlePath, finalPath);

      await cleanupFiles([slideshowPath, subtitlePath, ...images, audioFile.path]);

      return res.json({ downloadUrl: `/download/${finalFilename}` });
    } catch (error) {
      console.error('Render error:', error);
      return res.status(500).json({ error: error.message || 'Video generation failed.' });
    }
  });
});

app.listen(PORT, async () => {
  await ensureDirectories();
  console.log(`Video generator server is running on http://localhost:${PORT}`);
});
