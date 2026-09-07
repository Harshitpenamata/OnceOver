import sharp from "sharp";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

// Burns a repeating diagonal watermark (viewer identity + timestamp) directly
// into the pixels of an image, so it survives cropping/screenshotting an
// overlay and can't be stripped by removing a DOM element.
export async function watermarkImage(original: Buffer, label: string): Promise<Buffer> {
  const image = sharp(original).rotate(); // rotate() normalizes EXIF orientation
  const { width = 1200, height = 1200 } = await image.metadata();

  const tileText = escapeXml(label);
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="wm" width="${Math.round(width / 3)}" height="${Math.round(
    height / 5
  )}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
          <text x="0" y="20" font-family="sans-serif" font-size="${Math.max(
            14,
            Math.round(width / 45)
          )}" fill="rgba(255,255,255,0.55)" stroke="rgba(0,0,0,0.35)" stroke-width="0.5">${tileText}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wm)" />
    </svg>`;

  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

export async function watermarkPdf(original: Buffer, label: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(original);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    const fontSize = Math.max(12, Math.round(width / 32));

    // Tile the watermark diagonally across the page so it can't be cropped out.
    const stepX = fontSize * (label.length * 0.6 + 6);
    const stepY = fontSize * 4;

    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        page.drawText(label, {
          x,
          y,
          size: fontSize,
          font,
          color: rgb(0.85, 0.15, 0.15),
          opacity: 0.28,
          rotate: degrees(-30),
        });
      }
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export function buildWatermarkLabel(viewerIdentity: string, viewedAt: Date): string {
  const timestamp = viewedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  return `${viewerIdentity} - ${timestamp}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
