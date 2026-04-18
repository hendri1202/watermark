import sharp from "sharp";
import { NextResponse } from "next/server";
import fs from "fs";
import { fileURLToPath } from "url";
import opentype from "opentype.js";

export const runtime = "nodejs";

/**
 * Escape special XML characters to prevent SVG injection.
 * This ensures user-provided text is safe to embed inside SVG markup.
 */
function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function alphaToHex(alpha) {
  return Math.round(clamp(alpha, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

function resolveFontPath() {
  const bundledFontPath = fileURLToPath(
    new URL("../../../public/fonts/Inter-Bold.woff", import.meta.url),
  );

  return fs.existsSync(bundledFontPath) ? bundledFontPath : null;
}

let _fontPath = undefined;
function getCachedFontPath() {
  if (_fontPath === undefined) {
    _fontPath = resolveFontPath();
    if (!_fontPath) {
      console.warn(
        "[watermark] No local font file found. Falling back to server fonts.",
      );
    }
  }
  return _fontPath;
}

let _outlineFont = undefined;

function loadOutlineFont() {
  const fontPath = getCachedFontPath();
  if (!fontPath) {
    return null;
  }

  try {
    const fontBuffer = fs.readFileSync(fontPath);
    const arrayBuffer = fontBuffer.buffer.slice(
      fontBuffer.byteOffset,
      fontBuffer.byteOffset + fontBuffer.byteLength,
    );
    return opentype.parse(arrayBuffer);
  } catch (err) {
    console.warn("[watermark] Failed to parse outline font:", err.message);
    return null;
  }
}

function getCachedOutlineFont() {
  if (_outlineFont === undefined) {
    _outlineFont = loadOutlineFont();
  }

  return _outlineFont;
}

function canFontRenderText(font, text) {
  const glyphs = font.stringToGlyphs(text);
  return !glyphs.some((glyph) => glyph?.name === ".notdef");
}

function buildTextPath(font, text, fontSize) {
  const baselineY = (font.ascender * fontSize) / font.unitsPerEm;
  const path = font.getPath(text, 0, baselineY, fontSize, { kerning: true });
  const bbox = path.getBoundingBox();
  const width = Math.max(1, Math.ceil(bbox.x2 - bbox.x1));
  const height = Math.max(1, Math.ceil(bbox.y2 - bbox.y1));

  return {
    pathData: path.toPathData(2),
    bbox,
    width,
    height,
  };
}

async function renderTextBufferFromOutline({ text, opacity, spacing }) {
  const font = getCachedOutlineFont();
  if (!font || !canFontRenderText(font, text)) {
    return null;
  }

  let fontSize = Math.max(14, Math.round(spacing * 0.12));
  let pathInfo = buildTextPath(font, text, fontSize);

  const targetMaxWidth = Math.max(120, Math.round(spacing * 0.9));
  if (pathInfo.width > targetMaxWidth) {
    const scale = targetMaxWidth / pathInfo.width;
    fontSize = Math.max(10, Math.floor(fontSize * scale));
    pathInfo = buildTextPath(font, text, fontSize);
  }

  const paddingX = Math.max(8, Math.round(spacing * 0.08));
  const paddingY = Math.max(6, Math.round(spacing * 0.06));
  const svgWidth = pathInfo.width + paddingX * 2;
  const svgHeight = pathInfo.height + paddingY * 2;
  const fillColor = `#808080${alphaToHex(opacity)}`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
      <path
        d="${pathInfo.pathData}"
        fill="${fillColor}"
        transform="translate(${paddingX - pathInfo.bbox.x1} ${paddingY - pathInfo.bbox.y1})"
      />
    </svg>
  `.trim();

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderTextBufferWithFallback({
  markupText,
  width,
  height,
  fontPath,
}) {
  const attemptOptions = [
    {
      font: "Inter 700",
      ...(fontPath ? { fontfile: fontPath } : {}),
      width,
      height,
      align: "center",
      rgba: true,
    },
    {
      font: "sans 700",
      width,
      height,
      align: "center",
      rgba: true,
    },
    {
      width,
      height,
      align: "center",
      rgba: true,
    },
  ];

  let lastError = null;

  for (const textOptions of attemptOptions) {
    try {
      return await sharp({
        text: {
          text: markupText,
          ...textOptions,
        },
      })
        .png()
        .toBuffer();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to render watermark text.");
}

/**
 * Create a single transparent tile (PNG) containing rotated text.
 *
 * Why this approach:
 * - Sharp/librsvg on serverless may not honor embedded SVG fonts consistently.
 * - We render text directly via Sharp's text input with `fontfile`, then tile
 *   that image in SVG. This avoids runtime dependence on system fonts.
 */
async function createWatermarkTileBuffer({ text, opacity, rotation, spacing }) {
  const safeText = escapeXml(text);
  const fontPath = getCachedFontPath();
  const textColor = `#808080${alphaToHex(opacity)}`;

  // Prefer outline paths so glyph rendering is not dependent on server fonts.
  let textBuffer = await renderTextBufferFromOutline({
    text,
    opacity,
    spacing,
  });

  if (!textBuffer) {
    textBuffer = await renderTextBufferWithFallback({
      markupText: `<span foreground="${textColor}">${safeText}</span>`,
      fontPath,
      width: Math.max(120, Math.round(spacing * 0.9)),
      height: Math.max(48, Math.round(spacing * 0.42)),
    });
  }

  const rotatedTextBuffer = await sharp(textBuffer)
    .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: spacing,
      height: spacing,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: rotatedTextBuffer,
        gravity: "center",
      },
    ])
    .png()
    .toBuffer();
}

function generateWatermarkSvg({ width, height, spacing, tileBase64 }) {
  const svgWidth = width * 3;
  const svgHeight = height * 3;
  const offsetX = -width;
  const offsetY = -height;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <pattern
          id="watermarkPattern"
          patternUnits="userSpaceOnUse"
          width="${spacing}"
          height="${spacing}"
        >
          <image
            href="data:image/png;base64,${tileBase64}"
            x="0"
            y="0"
            width="${spacing}"
            height="${spacing}"
            preserveAspectRatio="none"
          />
        </pattern>
      </defs>

      <rect
        x="${offsetX}"
        y="${offsetY}"
        width="${svgWidth}"
        height="${svgHeight}"
        fill="url(#watermarkPattern)"
      />
    </svg>
  `.trim();
}

/**
 * POST /api/watermark
 *
 * Accepts multipart/form-data with:
 *   - image: File (required) — The image to watermark
 *   - text: string (required) — Watermark text
 *   - opacity: number (optional, default 0.15) — Text opacity (0.05–0.50)
 *   - rotation: number (optional, default -30) — Rotation angle in degrees
 *   - spacing: number (optional, default 200) — Pattern tile size in pixels
 *
 * Returns the watermarked image as binary with the original content type.
 */
export async function POST(request) {
  try {
    // --- 1. Parse the multipart form data ---
    const formData = await request.formData();
    const imageFile = formData.get("image");
    const text = formData.get("text");

    // Validate required fields
    if (!imageFile || !(imageFile instanceof File)) {
      return NextResponse.json(
        { error: "No image file uploaded. Please select an image." },
        { status: 400 },
      );
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Watermark text is required. Please enter some text." },
        { status: 400 },
      );
    }

    // Check file size limit (10MB for Vercel serverless compatibility)
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (imageFile.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Image is too large. Maximum size is 10MB." },
        { status: 413 },
      );
    }

    // Parse optional parameters with validation and defaults
    const opacity = Math.min(
      0.5,
      Math.max(0.05, parseFloat(formData.get("opacity")) || 0.15),
    );
    const rotation = Math.min(
      0,
      Math.max(-60, parseFloat(formData.get("rotation")) || -30),
    );
    const spacing = Math.min(
      400,
      Math.max(100, parseInt(formData.get("spacing")) || 200),
    );

    // --- 2. Read the uploaded image into a buffer ---
    const arrayBuffer = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // --- 3. Get image metadata to know its dimensions ---
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height, format } = metadata;

    if (!width || !height) {
      return NextResponse.json(
        {
          error: "Could not read image dimensions. The file may be corrupted.",
        },
        { status: 400 },
      );
    }

    // --- 4. Build a text tile and generate the SVG watermark overlay ---
    const tileBuffer = await createWatermarkTileBuffer({
      text: text.trim(),
      opacity,
      rotation,
      spacing,
    });

    const svgWatermark = generateWatermarkSvg({
      width,
      height,
      spacing,
      tileBase64: tileBuffer.toString("base64"),
    });

    // --- 5. Composite the SVG watermark onto the original image ---
    // Sharp's composite() overlays the SVG on top of the base image.
    // `tile: true` would repeat a smaller overlay, but since our SVG
    // already matches the image dimensions and uses an SVG <pattern>
    // for tiling, we don't need Sharp's tile option here.
    // `blend: 'over'` places the watermark on top with alpha transparency.
    const watermarkedBuffer = await sharp(imageBuffer)
      .composite([
        {
          input: Buffer.from(svgWatermark),
          top: 0,
          left: 0,
          blend: "over",
        },
      ])
      .toBuffer();

    // --- 6. Determine the correct content type ---
    const contentTypeMap = {
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      tiff: "image/tiff",
      avif: "image/avif",
    };
    const contentType = contentTypeMap[format] || "image/png";

    // --- 7. Return the watermarked image as a binary response ---
    return new NextResponse(watermarkedBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="watermarked.${format || "png"}"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error.";

    console.error("Watermark processing error:", message, error);

    return NextResponse.json(
      { error: `Failed to process image: ${message}` },
      { status: 500 },
    );
  }
}
