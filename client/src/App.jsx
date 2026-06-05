import { useState, useRef } from 'react';
import './App.css';

const API_BASE = 'http://localhost:4000';

function formatFileSize(bytes) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function App() {
  const [images, setImages] = useState([]);
  const [audio, setAudio] = useState(null);
  const [script, setScript] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [videoType, setVideoType] = useState('desktop');
  const [isGenerating, setIsGenerating] = useState(false);
  const imageInputRef = useRef(null);
  const audioInputRef = useRef(null);

  const handleImageChange = (event) => {
    setDownloadUrl('');
    setError('');
    const selected = Array.from(event.target.files || []);

    if (!selected.length) {
      return;
    }

    setImages((currentImages) => {
      const merged = [...currentImages, ...selected];
      const unique = [];
      const seen = new Set();

      for (const file of merged) {
        const key = `${file.name}-${file.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(file);
        }
      }

      return unique;
    });

    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  const handleAudioChange = (event) => {
    setDownloadUrl('');
    setError('');
    setAudio(event.target.files?.[0] || null);
  };

  const clearImages = () => {
    setImages([]);
    setDownloadUrl('');
    setError('');
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  const clearAudio = () => {
    setAudio(null);
    setDownloadUrl('');
    setError('');
    if (audioInputRef.current) {
      audioInputRef.current.value = '';
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus('Preparing upload...');
    setError('');
    setDownloadUrl('');
    setIsGenerating(true);

    if (!images.length) {
      setError('Please select at least one image.');
      setStatus('');
      setIsGenerating(false);
      return;
    }

    if (!audio) {
      setError('Please select an MP3 audio file.');
      setStatus('');
      setIsGenerating(false);
      return;
    }

    const formData = new FormData();
    images.forEach((image) => formData.append('images', image));
    formData.append('audio', audio);
    formData.append('script', script);
    formData.append('videoType', videoType);

    try {
      setStatus('Uploading files and generating video...');
      const response = await fetch(`${API_BASE}/api/render`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Video creation failed.');
      }

      const data = await response.json();
      setDownloadUrl(`${API_BASE}${data.downloadUrl}`);
      setStatus('Video generated successfully!');
    } catch (uploadError) {
      setError(uploadError.message || 'Upload failed.');
      setStatus('');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="content-card">
        <header>
          <h1>Video Generator</h1>
          <p>Create a video from ordered images, audio, and optional subtitles.</p>
        </header>

        <form onSubmit={handleSubmit} className="upload-form">
          <label className="field-label">
            Select images (ordered):
            <div className="input-row">
              <input ref={imageInputRef} type="file" accept="image/*" multiple onChange={handleImageChange} disabled={isGenerating} />
              {images.length > 0 && (
                <button type="button" className="secondary-button" onClick={clearImages} disabled={isGenerating}>
                  Clear images
                </button>
              )}
            </div>
          </label>

          {images.length > 0 && (
            <div className="file-preview">
              <h2>Image order</h2>
              <ul>
                {images.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <strong>{index + 1}.</strong> {file.name} ({formatFileSize(file.size)})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="field-label">
            Select audio file (MP3):
            <div className="input-row">
              <input ref={audioInputRef} type="file" accept="audio/mpeg" onChange={handleAudioChange} disabled={isGenerating} />
              {audio && (
                <button type="button" className="secondary-button" onClick={clearAudio} disabled={isGenerating}>
                  Clear audio
                </button>
              )}
            </div>
          </label>

          {audio && (
            <div className="file-preview">
              <strong>Audio:</strong> {audio.name} ({formatFileSize(audio.size)})
            </div>
          )}

          <label className="field-label">
            Choose video type:
            <select value={videoType} onChange={(event) => setVideoType(event.target.value)} disabled={isGenerating}>
              <option value="desktop">Desktop (1920x1080)</option>
              <option value="story">Story (720x1280)</option>
              <option value="real">Real (1080x1920)</option>
            </select>
          </label>

          <label className="field-label">
            Optional script for subtitles:
            <textarea
              value={script}
              onChange={(event) => setScript(event.target.value)}
              placeholder="Enter script text. Each line becomes one subtitle block."
              disabled={isGenerating}
            />
          </label>

          <button type="submit" className="primary-button" disabled={isGenerating}>
            {isGenerating ? 'Generating video…' : 'Generate Video'}
          </button>
        </form>

        {status && <div className="status-message">{status}</div>}
        {error && <div className="error-message">{error}</div>}

        {downloadUrl && (
          <div className="download-panel">
            <a className="download-button" href={downloadUrl} target="_blank" rel="noreferrer">
              Download final video
            </a>
          </div>
        )}

        <footer>
          <p>Built with React, Express, Multer, and FFmpeg.</p>
        </footer>
      </div>
    </div>
  );
}
