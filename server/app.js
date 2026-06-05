const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
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
