"use client";

import { useState, useRef, useCallback } from "react";
import JSZip from "jszip";

/**
 * Status for each image in the batch:
 * - idle: uploaded, waiting to process
 * - processing: currently being watermarked
 * - done: watermark applied successfully
 * - error: something went wrong
 */
const STATUS = {
  IDLE: "idle",
  PROCESSING: "processing",
  DONE: "done",
  ERROR: "error",
};

export default function Home() {
  // --- State ---
  // Each image entry: { id, file, originalUrl, resultUrl, resultBlob, status, error }
  const [images, setImages] = useState([]);
  const [watermarkText, setWatermarkText] = useState("");
  const [opacity, setOpacity] = useState(0.15);
  const [rotation, setRotation] = useState(-30);
  const [spacing, setSpacing] = useState(200);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  const fileInputRef = useRef(null);
  let idCounter = useRef(0);

  // --- File Handling (supports multiple) ---
  const addFiles = useCallback((fileList) => {
    const validTypes = [
      "image/jpeg", "image/png", "image/webp",
      "image/gif", "image/tiff", "image/avif",
    ];
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB per file

    const newImages = [];

    for (const file of Array.from(fileList)) {
      if (!validTypes.includes(file.type)) {
        continue; // skip invalid files silently
      }
      if (file.size > MAX_SIZE) {
        continue; // skip oversized files
      }

      idCounter.current += 1;
      newImages.push({
        id: `img-${Date.now()}-${idCounter.current}`,
        file,
        originalUrl: URL.createObjectURL(file),
        resultUrl: null,
        resultBlob: null,
        status: STATUS.IDLE,
        error: null,
      });
    }

    if (newImages.length === 0 && fileList.length > 0) {
      setError("No valid images found. Supported: JPEG, PNG, WebP, GIF, TIFF, AVIF (max 10MB each).");
      return;
    }

    setError(null);
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const handleFileInputChange = (e) => {
    if (e.target.files?.length) {
      addFiles(e.target.files);
    }
    // Reset input so same files can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (id) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img?.originalUrl) URL.revokeObjectURL(img.originalUrl);
      if (img?.resultUrl) URL.revokeObjectURL(img.resultUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const clearAll = () => {
    images.forEach((img) => {
      if (img.originalUrl) URL.revokeObjectURL(img.originalUrl);
      if (img.resultUrl) URL.revokeObjectURL(img.resultUrl);
    });
    setImages([]);
    setError(null);
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
    if (e.dataTransfer.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  };

  // --- Process a single image ---
  const processOneImage = async (imageEntry) => {
    const formData = new FormData();
    formData.append("image", imageEntry.file);
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
      throw new Error(data?.error || `Error (${response.status})`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    return { url, blob };
  };

  // --- Batch Process All ---
  const handleProcessAll = async () => {
    if (images.length === 0 || !watermarkText.trim()) {
      setError("Please add images and enter watermark text.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    // Reset all statuses to processing
    setImages((prev) =>
      prev.map((img) => ({
        ...img,
        status: STATUS.PROCESSING,
        resultUrl: img.resultUrl ? (URL.revokeObjectURL(img.resultUrl), null) : null,
        resultBlob: null,
        error: null,
      }))
    );

    // Process all images in parallel (max 3 concurrent to avoid overwhelming the server)
    const CONCURRENCY = 3;
    const queue = [...images];
    const processing = new Set();

    const processNext = async () => {
      if (queue.length === 0) return;

      const img = queue.shift();
      processing.add(img.id);

      try {
        const { url, blob } = await processOneImage(img);
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id
              ? { ...i, resultUrl: url, resultBlob: blob, status: STATUS.DONE, error: null }
              : i
          )
        );
      } catch (err) {
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id
              ? { ...i, status: STATUS.ERROR, error: err.message }
              : i
          )
        );
      } finally {
        processing.delete(img.id);
        await processNext(); // Process next in queue
      }
    };

    // Start up to CONCURRENCY workers
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      workers.push(processNext());
    }

    await Promise.all(workers);
    setIsProcessing(false);
  };

  // --- Download single image ---
  const downloadOne = (img) => {
    if (!img.resultUrl) return;
    const link = document.createElement("a");
    link.href = img.resultUrl;
    const ext = img.file.name.split(".").pop() || "png";
    link.download = `watermarked-${img.file.name}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Download All as ZIP ---
  const downloadAllAsZip = async () => {
    const doneImages = images.filter((i) => i.status === STATUS.DONE && i.resultBlob);
    if (doneImages.length === 0) return;

    setIsZipping(true);

    try {
      const zip = new JSZip();

      for (const img of doneImages) {
        const ext = img.file.name.split(".").pop() || "png";
        const baseName = img.file.name.replace(/\.[^/.]+$/, "");
        const fileName = `watermarked-${baseName}.${ext}`;
        zip.file(fileName, img.resultBlob);
      }

      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = "watermarked-images.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch {
      setError("Failed to create ZIP file.");
    } finally {
      setIsZipping(false);
    }
  };

  // --- Helpers ---
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isReady = images.length > 0 && watermarkText.trim().length > 0;
  const doneCount = images.filter((i) => i.status === STATUS.DONE).length;
  const errorCount = images.filter((i) => i.status === STATUS.ERROR).length;
  const processedCount = doneCount + errorCount;

  return (
    <main className="app-container">
      {/* --- Header --- */}
      <header className="header fade-in">
        <span className="header__icon" role="img" aria-label="watermark">
          💧
        </span>
        <h1 className="header__title">Watermark Studio</h1>
        <p className="header__subtitle">
          Professional diagonal watermarks — batch process multiple images
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
          Upload Images
          {images.length > 0 && (
            <span className="badge">{images.length} file{images.length > 1 ? "s" : ""}</span>
          )}
        </div>

        <div
          className={`upload-zone ${isDragActive ? "upload-zone--active" : ""} ${images.length > 0 ? "upload-zone--has-file" : ""}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          id="upload-zone"
        >
          <span className="upload-zone__icon">🖼️</span>
          <p className="upload-zone__text">
            {images.length === 0
              ? "Drag & drop images here, or click to browse"
              : "Drop more images or click to add"
            }
          </p>
          <p className="upload-zone__hint">
            Supports JPEG, PNG, WebP, GIF, TIFF, AVIF • Max 10MB each • Multiple files
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif"
            onChange={handleFileInputChange}
            className="upload-zone__input"
            id="file-input"
            aria-label="Upload image files"
            multiple
          />
        </div>

        {/* File List */}
        {images.length > 0 && (
          <div className="file-list">
            {images.map((img) => (
              <div key={img.id} className={`file-item file-item--${img.status}`}>
                <img
                  src={img.originalUrl}
                  alt={img.file.name}
                  className="file-item__thumb"
                />
                <div className="file-item__details">
                  <div className="file-item__name">{img.file.name}</div>
                  <div className="file-item__meta">
                    <span>{formatFileSize(img.file.size)}</span>
                    {img.status === STATUS.PROCESSING && (
                      <span className="file-item__status file-item__status--processing">
                        <span className="spinner-sm"></span> Processing...
                      </span>
                    )}
                    {img.status === STATUS.DONE && (
                      <span className="file-item__status file-item__status--done">✓ Done</span>
                    )}
                    {img.status === STATUS.ERROR && (
                      <span className="file-item__status file-item__status--error">✕ {img.error}</span>
                    )}
                  </div>
                </div>
                <div className="file-item__actions">
                  {img.status === STATUS.DONE && (
                    <button
                      className="file-item__btn file-item__btn--download"
                      onClick={() => downloadOne(img)}
                      title="Download"
                    >
                      ⬇️
                    </button>
                  )}
                  <button
                    className="file-item__btn file-item__btn--remove"
                    onClick={() => removeImage(img.id)}
                    title="Remove"
                    disabled={isProcessing}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            <div className="file-list__footer">
              <button
                className="btn-text"
                onClick={clearAll}
                disabled={isProcessing}
                id="clear-all-btn"
              >
                Clear All
              </button>
            </div>
          </div>
        )}
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

      {/* --- Action Buttons --- */}
      <div className="action-bar fade-in" style={{ animationDelay: "0.3s" }}>
        <button
          className="btn-primary"
          onClick={handleProcessAll}
          disabled={!isReady || isProcessing}
          id="apply-btn"
        >
          {isProcessing ? (
            <>
              <span className="spinner"></span>
              <span>Processing {processedCount}/{images.length}...</span>
            </>
          ) : (
            <>
              <span>✨</span>
              <span>
                Apply Watermark{images.length > 1 ? ` to ${images.length} Images` : ""}
              </span>
            </>
          )}
        </button>

        {doneCount > 1 && (
          <button
            className="btn-download"
            onClick={downloadAllAsZip}
            disabled={isZipping}
            id="download-all-btn"
          >
            {isZipping ? (
              <>
                <span className="spinner-sm"></span>
                <span>Creating ZIP...</span>
              </>
            ) : (
              <>
                <span>📦</span>
                <span>Download All as ZIP ({doneCount} images)</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* --- Results Gallery --- */}
      {images.some((i) => i.status === STATUS.DONE) && (
        <section className="card fade-in" style={{ animationDelay: "0.1s" }}>
          <div className="card__title">
            <span className="card__title-icon">👁️</span>
            Results
            <span className="badge">{doneCount} of {images.length}</span>
            {errorCount > 0 && <span className="badge badge--error">{errorCount} failed</span>}
          </div>

          <div className="results-grid">
            {images
              .filter((i) => i.status === STATUS.DONE)
              .map((img) => (
                <div key={img.id} className="result-card">
                  <div className="result-card__comparison">
                    <div className="result-card__image-wrap">
                      <div className="result-card__label">Original</div>
                      <img
                        src={img.originalUrl}
                        alt={`Original ${img.file.name}`}
                        className="result-card__image"
                      />
                    </div>
                    <div className="result-card__image-wrap">
                      <div className="result-card__label">Watermarked</div>
                      <img
                        src={img.resultUrl}
                        alt={`Watermarked ${img.file.name}`}
                        className="result-card__image"
                      />
                    </div>
                  </div>
                  <div className="result-card__footer">
                    <span className="result-card__name">{img.file.name}</span>
                    <button
                      className="btn-download-sm"
                      onClick={() => downloadOne(img)}
                    >
                      ⬇️ Download
                    </button>
                  </div>
                </div>
              ))}
          </div>
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
