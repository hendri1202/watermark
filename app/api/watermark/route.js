import sharp from "sharp";
import { NextResponse } from "next/server";

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

/**
 * Generate a tiled, diagonal watermark SVG string.
 *
 * How it works:
 * - We use an SVG <pattern> element to create a repeating tile.
 * - The pattern contains a <text> element with the user's watermark text.
 * - `patternTransform="rotate(...)"` rotates the entire pattern to create
 *   a diagonal effect across the image.
 * - The pattern is applied to a full-size <rect> that covers the entire image.
 * - Opacity is controlled via the `fill` color's alpha channel.
 *
 * Why SVG?
 * - SVG is rendered natively by Sharp (via librsvg), no need for node-canvas
 *   or OS-level dependencies. This makes it fully compatible with Vercel
 *   serverless environments.
 * - SVG patterns provide precise control over repetition and rotation.
 */
function generateWatermarkSvg({ width, height, text, opacity, rotation, spacing }) {
  const safeText = escapeXml(text);

  // Font size scales relative to spacing so text looks proportional
  const fontSize = Math.max(14, Math.round(spacing * 0.12));

  // We make the SVG much larger than the image to ensure full coverage
  // even after rotation. This prevents empty corners.
  const svgWidth = width * 3;
  const svgHeight = height * 3;

  // Offset the rect so the pattern covers beyond all edges
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
          patternTransform="rotate(${rotation})"
        >
          <!--
            Each tile contains the watermark text, centered within the tile.
            The text uses a semi-transparent white fill for visibility on
            both light and dark images.
          -->
          <text
            x="${spacing / 2}"
            y="${spacing / 2}"
            font-size="${fontSize}"
            font-family="Arial, Helvetica, sans-serif"
            font-weight="bold"
            fill="rgba(255, 255, 255, ${opacity})"
            text-anchor="middle"
            dominant-baseline="middle"
            letter-spacing="2"
          >${safeText}</text>
        </pattern>
      </defs>

      <!--
        A large rect filled with the repeating pattern.
        Oversized and offset to guarantee complete coverage after rotation.
      -->
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
        { status: 400 }
      );
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Watermark text is required. Please enter some text." },
        { status: 400 }
      );
    }

    // Check file size limit (10MB for Vercel serverless compatibility)
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (imageFile.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Image is too large. Maximum size is 10MB." },
        { status: 413 }
      );
    }

    // Parse optional parameters with validation and defaults
    const opacity = Math.min(0.50, Math.max(0.05, parseFloat(formData.get("opacity")) || 0.15));
    const rotation = Math.min(0, Math.max(-60, parseFloat(formData.get("rotation")) || -30));
    const spacing = Math.min(400, Math.max(100, parseInt(formData.get("spacing")) || 200));

    // --- 2. Read the uploaded image into a buffer ---
    const arrayBuffer = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // --- 3. Get image metadata to know its dimensions ---
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height, format } = metadata;

    if (!width || !height) {
      return NextResponse.json(
        { error: "Could not read image dimensions. The file may be corrupted." },
        { status: 400 }
      );
    }

    // --- 4. Generate the SVG watermark overlay ---
    const svgWatermark = generateWatermarkSvg({
      width,
      height,
      text: text.trim(),
      opacity,
      rotation,
      spacing,
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
    console.error("Watermark processing error:", error);
    return NextResponse.json(
      { error: "Failed to process image. Please try a different file." },
      { status: 500 }
    );
  }
}
