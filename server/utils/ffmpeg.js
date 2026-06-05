const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolveExecutable(name) {
  const envPath = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN_DIR || process.env.FFMPEG_HOME;
  const executableName = `${name}${process.platform === 'win32' ? '.exe' : ''}`;

  if (envPath) {
    const normalized = path.normalize(envPath);
    const candidates = [];

    if (path.extname(normalized)) {
      candidates.push(normalized);
    } else {
      candidates.push(path.join(normalized, executableName));
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return executableName;
}

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        const executable = path.basename(command);
        reject(new Error(`Executable not found: ${executable}. Install FFmpeg and make sure both '${executable}' and 'ffmpeg' are available on your PATH or set FFMPEG_PATH.`));
      } else {
        reject(error);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`FFmpeg failed (${code}): ${stderr || stdout}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

function formatSubtitlePath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.replace(/'/g, "\\'");
}

function formatTimecode(seconds) {
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const date = new Date(Math.floor(seconds) * 1000).toISOString();
  const hh = date.slice(11, 13);
  const mm = date.slice(14, 16);
  const ss = date.slice(17, 19);
  return `${hh}:${mm}:${ss},${String(ms).padStart(3, '0')}`;
}

function buildSubtitles(script, totalDuration) {
  const lines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  const segment = totalDuration / lines.length;
  let start = 0;
  return lines
    .map((line, index) => {
      const end = Math.min(totalDuration, start + segment);
      const entry = `${index + 1}\n${formatTimecode(start)} --> ${formatTimecode(end)}\n${line}\n`;
      start = end;
      return entry;
    })
    .join('\n');
}

module.exports = {
  spawnAsync,
  resolveExecutable,
  formatSubtitlePath,
  formatTimecode,
  buildSubtitles
};
