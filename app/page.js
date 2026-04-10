"use client";

import { useState, useRef, useCallback } from "react";

export default function Home() {
  // --- State Management ---
  const [file, setFile] = useState(null);
  const [originalPreview, setOriginalPreview] = useState(null);
  const [watermarkText, setWatermarkText] = useState("");
  const [opacity, setOpacity] = useState(0.15);
  const [rotation, setRotation] = useState(-30);
  const [spacing, setSpacing] = useState(200);
  const [resultUrl, setResultUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const fileInputRef = useRef(null);

  // --- File Handling ---
  const handleFileSelect = useCallback((selectedFile) => {
    if (!selectedFile) return;

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/avif"];
    if (!validTypes.includes(selectedFile.type)) {
      setError("Please upload a valid image file (JPEG, PNG, WebP, GIF, TIFF, or AVIF).");
      return;
    }

    // Validate file size (10MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError("Image is too large. Maximum size is 10MB.");
      return;
    }

    setFile(selectedFile);
    setError(null);
    setResultUrl(null);

    // Create preview URL for the original image
    const previewUrl = URL.createObjectURL(selectedFile);
    setOriginalPreview(previewUrl);
  }, []);

  const handleFileInputChange = (e) => {
    handleFileSelect(e.target.files?.[0]);
  };

  const handleRemoveFile = () => {
    setFile(null);
    setOriginalPreview(null);
    setResultUrl(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // --- Drag & Drop ---
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    handleFileSelect(e.dataTransfer.files?.[0]);
  };

  // --- Submit / Apply Watermark ---
  const handleSubmit = async () => {
    if (!file || !watermarkText.trim()) {
      setError("Please upload an image and enter watermark text.");
      return;
    }

    setLoading(true);
    setError(null);
    setResultUrl(null);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("text", watermarkText.trim());
      formData.append("opacity", opacity.toString());
      formData.append("rotation", rotation.toString());
      formData.append("spacing", spacing.toString());

      const response = await fetch("/api/watermark", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Server error (${response.status})`);
      }

      // Read the response as a blob and create an object URL
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // --- Download ---
  const handleDownload = () => {
    if (!resultUrl) return;

    const link = document.createElement("a");
    link.href = resultUrl;

    // Determine extension from original file
    const ext = file?.name?.split(".").pop() || "png";
    link.download = `watermarked-image.${ext}`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Helpers ---
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isReady = file && watermarkText.trim().length > 0;

  return (
    <main className="app-container">
      {/* --- Header --- */}
      <header className="header fade-in">
        <span className="header__icon" role="img" aria-label="watermark">
          💧
        </span>
        <h1 className="header__title">Watermark Studio</h1>
        <p className="header__subtitle">
          Professional diagonal watermarks for your images
        </p>
      </header>

      {/* --- Error Display --- */}
      {error && (
        <div className="error-msg" role="alert" id="error-message">
          <span className="error-msg__icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* --- Upload Card --- */}
      <section className="card fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="card__title">
          <span className="card__title-icon">📁</span>
          Upload Image
        </div>

        <div
          className={`upload-zone ${isDragActive ? "upload-zone--active" : ""} ${file ? "upload-zone--has-file" : ""}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          id="upload-zone"
        >
          {!file ? (
            <>
              <span className="upload-zone__icon">🖼️</span>
              <p className="upload-zone__text">
                Drag & drop your image here, or click to browse
              </p>
              <p className="upload-zone__hint">
                Supports JPEG, PNG, WebP, GIF, TIFF, AVIF • Max 10MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif"
                onChange={handleFileInputChange}
                className="upload-zone__input"
                id="file-input"
                aria-label="Upload image file"
              />
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif"
                onChange={handleFileInputChange}
                className="upload-zone__input"
                id="file-input"
                aria-label="Upload image file"
              />
              <div className="file-info">
                <span className="file-info__icon">🖼️</span>
                <div className="file-info__details">
                  <div className="file-info__name">{file.name}</div>
                  <div className="file-info__size">{formatFileSize(file.size)}</div>
                </div>
                <button
                  className="file-info__remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFile();
                  }}
                  aria-label="Remove file"
                  id="remove-file-btn"
                >
                  ✕
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* --- Watermark Settings Card --- */}
      <section className="card fade-in" style={{ animationDelay: "0.2s" }}>
        <div className="card__title">
          <span className="card__title-icon">✏️</span>
          Watermark Settings
        </div>

        {/* Watermark Text */}
        <div className="input-group">
          <label className="input-label" htmlFor="watermark-text">
            Watermark Text
          </label>
          <input
            type="text"
            id="watermark-text"
            className="input-text"
            placeholder="e.g. © Your Brand Name"
            value={watermarkText}
            onChange={(e) => setWatermarkText(e.target.value)}
            maxLength={60}
          />
        </div>

        {/* Sliders Grid */}
        <div className="settings-grid">
          {/* Opacity Slider */}
          <div className="slider-group">
            <div className="slider-header">
              <label className="slider-label" htmlFor="opacity-slider">
                Opacity
              </label>
              <span className="slider-value">{(opacity * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              id="opacity-slider"
              className="slider-input"
              min="0.05"
              max="0.50"
              step="0.01"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
            />
          </div>

          {/* Rotation Slider */}
          <div className="slider-group">
            <div className="slider-header">
              <label className="slider-label" htmlFor="rotation-slider">
                Rotation
              </label>
              <span className="slider-value">{rotation}°</span>
            </div>
            <input
              type="range"
              id="rotation-slider"
              className="slider-input"
              min="-60"
              max="0"
              step="1"
              value={rotation}
              onChange={(e) => setRotation(parseInt(e.target.value))}
            />
          </div>

          {/* Spacing Slider */}
          <div className="slider-group">
            <div className="slider-header">
              <label className="slider-label" htmlFor="spacing-slider">
                Spacing
              </label>
              <span className="slider-value">{spacing}px</span>
            </div>
            <input
              type="range"
              id="spacing-slider"
              className="slider-input"
              min="100"
              max="400"
              step="10"
              value={spacing}
              onChange={(e) => setSpacing(parseInt(e.target.value))}
            />
          </div>
        </div>
      </section>

      {/* --- Apply Button --- */}
      <div className="fade-in" style={{ animationDelay: "0.3s", marginBottom: "24px" }}>
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={!isReady || loading}
          id="apply-btn"
        >
          {loading ? (
            <>
              <span className="spinner"></span>
              <span>Processing...</span>
            </>
          ) : (
            <>
              <span>✨</span>
              <span>Apply Watermark</span>
            </>
          )}
        </button>
      </div>

      {/* --- Preview / Result --- */}
      {(originalPreview || resultUrl) && (
        <section className="card fade-in" style={{ animationDelay: "0.1s" }}>
          <div className="card__title">
            <span className="card__title-icon">👁️</span>
            Preview
          </div>

          <div className="preview-container">
            {/* Original */}
            {originalPreview && (
              <div className="preview-item">
                <div className="preview-label">Original</div>
                <div className="preview-image-wrapper">
                  <img
                    src={originalPreview}
                    alt="Original uploaded image"
                    className="preview-image"
                    id="original-preview"
                  />
                </div>
              </div>
            )}

            {/* Watermarked */}
            {resultUrl && (
              <div className="preview-item">
                <div className="preview-label">Watermarked</div>
                <div className="preview-image-wrapper">
                  <img
                    src={resultUrl}
                    alt="Watermarked result image"
                    className="preview-image"
                    id="result-preview"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Download Button */}
          {resultUrl && (
            <div style={{ marginTop: "24px" }}>
              <button
                className="btn-download"
                onClick={handleDownload}
                id="download-btn"
              >
                <span>⬇️</span>
                <span>Download Watermarked Image</span>
              </button>
            </div>
          )}
        </section>
      )}

      {/* --- Footer --- */}
      <footer className="footer fade-in" style={{ animationDelay: "0.4s" }}>
        <p>
          Watermark Studio — Built with{" "}
          <a href="https://nextjs.org" target="_blank" rel="noopener noreferrer">
            Next.js
          </a>{" "}
          &{" "}
          <a href="https://sharp.pixelplumbing.com" target="_blank" rel="noopener noreferrer">
            Sharp
          </a>
        </p>
      </footer>
    </main>
  );
}
