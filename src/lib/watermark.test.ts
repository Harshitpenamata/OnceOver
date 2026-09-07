import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildWatermarkLabel, watermarkImage, watermarkPdf } from "./watermark";

describe("buildWatermarkLabel", () => {
  it("combines the viewer identity and a UTC timestamp", () => {
    const label = buildWatermarkLabel("jane@example.com", new Date("2026-01-02T03:04:05.678Z"));
    expect(label).toBe("jane@example.com - 2026-01-02 03:04:05 UTC");
  });
});

describe("watermarkImage", () => {
  it("returns a valid JPEG the same size as the source image", async () => {
    const original = await sharp({
      create: { width: 200, height: 150, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const watermarked = await watermarkImage(original, "QA Tester - 2026-01-01 00:00:00 UTC");
    const metadata = await sharp(watermarked).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(150);
    // The watermark overlay should actually change pixel data, not pass the image through untouched.
    expect(Buffer.compare(watermarked, original)).not.toBe(0);
  });
});

describe("watermarkPdf", () => {
  it("returns a valid PDF with the same page count as the source, with visible text added", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    doc.addPage([300, 400]);
    const original = Buffer.from(await doc.save());

    const watermarked = await watermarkPdf(original, "QA Tester - 2026-01-01 00:00:00 UTC");
    const result = await PDFDocument.load(watermarked);

    expect(result.getPageCount()).toBe(2);
    expect(watermarked.length).toBeGreaterThan(original.length);
  });

  it("strips OpenAction/JavaScript and the Names tree so an auto-run script can't survive", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);

    const jsAction = doc.context.obj({
      Type: PDFName.of("Action"),
      S: PDFName.of("JavaScript"),
      JS: PDFString.of('app.alert("pwned")'),
    });
    doc.catalog.set(PDFName.of("OpenAction"), doc.context.register(jsAction));

    const namesTree = doc.context.obj({ JavaScript: doc.context.obj({ Names: [] }) });
    doc.catalog.set(PDFName.of("Names"), doc.context.register(namesTree));

    // Sanity check the fixture actually has them before we assert they're gone.
    expect(doc.catalog.get(PDFName.of("OpenAction"))).toBeDefined();
    expect(doc.catalog.get(PDFName.of("Names"))).toBeDefined();

    const original = Buffer.from(await doc.save());
    const watermarked = await watermarkPdf(original, "QA Tester - 2026-01-01 00:00:00 UTC");
    const result = await PDFDocument.load(watermarked);

    expect(result.catalog.get(PDFName.of("OpenAction"))).toBeUndefined();
    expect(result.catalog.get(PDFName.of("Names"))).toBeUndefined();
  });

  it("strips AcroForm and per-annotation AA triggers (a JS vector independent of OpenAction)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);

    const aaAction = doc.context.obj({
      Type: PDFName.of("Action"),
      S: PDFName.of("JavaScript"),
      JS: PDFString.of('app.alert("field pwned")'),
    });
    const fieldDict = doc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Widget"),
      Rect: [0, 0, 100, 20],
      FT: PDFName.of("Tx"),
      AA: doc.context.obj({ F: doc.context.register(aaAction) }),
    });
    const fieldRef = doc.context.register(fieldDict);
    page.node.set(PDFName.of("Annots"), doc.context.obj([fieldRef]));
    doc.catalog.set(
      PDFName.of("AcroForm"),
      doc.context.register(doc.context.obj({ Fields: [fieldRef] }))
    );

    // Sanity check the fixture actually has them before we assert they're gone.
    expect(doc.catalog.get(PDFName.of("AcroForm"))).toBeDefined();
    expect(fieldDict.get(PDFName.of("AA"))).toBeDefined();

    const original = Buffer.from(await doc.save());
    const watermarked = await watermarkPdf(original, "QA Tester - 2026-01-01 00:00:00 UTC");
    const result = await PDFDocument.load(watermarked);

    expect(result.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();

    const resultAnnots = result.getPages()[0].node.Annots();
    expect(resultAnnots).toBeDefined();
    const resultField = result.context.lookupMaybe(resultAnnots!.get(0), PDFDict);
    expect(resultField?.get(PDFName.of("AA"))).toBeUndefined();
  });
});
