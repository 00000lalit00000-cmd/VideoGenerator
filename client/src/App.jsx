import { useState, useRef, useEffect } from 'react';
import './App.css';

const API_BASE = 'http://localhost:4000';

const VIDEO_OPTION_CHOICES = [
  { value: 'fadeTransitions', label: 'Fade transitions' },
  { value: 'slideMotion', label: 'Slide motion' },
  { value: 'zoomBurst', label: 'Zoom burst' },
  { value: 'flipSpin', label: 'Flip spin' },
  { value: 'blurZoom', label: 'Blur zoom' },
  { value: 'glowPulse', label: 'Glow pulse' },
  { value: 'strobeFlash', label: 'Strobe flash' },
  { value: 'colorShift', label: 'Color shift' },
  { value: 'shakePulse', label: 'Shake pulse' },
  { value: 'curtainReveal', label: 'Curtain reveal' },
  { value: 'sparkleTrail', label: 'Sparkle trail' },
  { value: 'neonGlow', label: 'Neon glow' },
];

const ANIMATION_EFFECT_CHOICES = [
  { value: 'fade', label: 'Fade' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'slide', label: 'Slide' },
  { value: 'flip', label: 'Flip' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'pan', label: 'Pan' },
  { value: 'blur', label: 'Blur' },
  { value: 'glitch', label: 'Glitch' },
  { value: 'rotate', label: 'Rotate' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'sparkle', label: 'Sparkle' },
];

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
  const [animationEffects, setAnimationEffects] = useState([]);
  const [animationOpen, setAnimationOpen] = useState(false);
  const [videoOptions, setVideoOptions] = useState([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const imageInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const optionsRef = useRef(null);
  const animationRef = useRef(null);

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

  const toggleAnimationEffect = (value) => {
    setAnimationEffects((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  };

  const toggleSelectAllAnimationEffects = () => {
    if (animationEffects.length === ANIMATION_EFFECT_CHOICES.length) {
      setAnimationEffects([]);
    } else {
      setAnimationEffects(ANIMATION_EFFECT_CHOICES.map((option) => option.value));
    }
  };

  const toggleVideoOption = (value) => {
    setVideoOptions((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  };

  const toggleOptionsOpen = () => {
    setOptionsOpen((open) => !open);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      const clickedInsideOptions = optionsRef.current && optionsRef.current.contains(event.target);
      const clickedInsideAnimation = animationRef.current && animationRef.current.contains(event.target);

      if (!clickedInsideOptions) {
        setOptionsOpen(false);
      }
      if (!clickedInsideAnimation) {
        setAnimationOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    formData.append('animationEffects', JSON.stringify(animationEffects));
    formData.append('videoOptions', JSON.stringify(videoOptions));

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
            Choose animation effect:
            <div className="dropdown" ref={animationRef}>
              <button
                type="button"
                className={`dropdown-toggle${animationOpen ? ' open' : ''}`}
                aria-expanded={animationOpen}
                onClick={() => setAnimationOpen((open) => !open)}
                disabled={isGenerating}
              >
                {animationEffects.length > 0
                  ? `${animationEffects.length} effect${animationEffects.length > 1 ? 's' : ''} selected`
                  : 'Choose animation effects'}
              </button>

              {animationOpen && (
                <div className="dropdown-panel">
                  <label className="dropdown-option select-all">
                    <input
                      type="checkbox"
                      checked={animationEffects.length === ANIMATION_EFFECT_CHOICES.length}
                      onChange={toggleSelectAllAnimationEffects}
                      disabled={isGenerating}
                    />
                    Select all animation effects
                  </label>
                  {ANIMATION_EFFECT_CHOICES.map((option) => (
                    <label key={option.value} className="dropdown-option">
                      <input
                        type="checkbox"
                        checked={animationEffects.includes(option.value)}
                        onChange={() => toggleAnimationEffect(option.value)}
                        disabled={isGenerating}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </label>

          {animationEffects.length > 0 && (
            <div className="file-preview">
              <strong>Selected animation effects:</strong> {ANIMATION_EFFECT_CHOICES.filter((option) => animationEffects.includes(option.value)).map((option) => option.label).join(', ')}
            </div>
          )}

          <label className="field-label">
            Apply video options:
            <div className="dropdown" ref={optionsRef}>
              <button
                type="button"
                className={`dropdown-toggle${optionsOpen ? ' open' : ''}`}
                aria-expanded={optionsOpen}
                onClick={toggleOptionsOpen}
                disabled={isGenerating}
              >
                {videoOptions.length > 0
                  ? `${videoOptions.length} option${videoOptions.length > 1 ? 's' : ''} selected`
                  : 'Choose options'}
              </button>
              {optionsOpen && (
                <div className="dropdown-panel">
                  {VIDEO_OPTION_CHOICES.map((option) => (
                    <label key={option.value} className="dropdown-option">
                      <input
                        type="checkbox"
                        checked={videoOptions.includes(option.value)}
                        onChange={() => toggleVideoOption(option.value)}
                        disabled={isGenerating}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </label>

          {videoOptions.length > 0 && (
            <div className="file-preview">
              <strong>Selected options:</strong> {VIDEO_OPTION_CHOICES.filter((option) => videoOptions.includes(option.value)).map((option) => option.label).join(', ')}
            </div>
          )}

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
