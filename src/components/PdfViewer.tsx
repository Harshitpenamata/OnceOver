"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

// Renders to <canvas> via PDF.js instead of <iframe src="blob:...">. That
// approach was silently failing to load PDFs on mobile - WebKit's embedded
// PDF viewer doesn't reliably handle blob: URLs inside an iframe. It also
// exposed a real desktop gap: the "#toolbar=0" hint only Chrome's PDFium
// viewer respects, so Firefox/Safari showed the native PDF toolbar with an
// explicit download button, undermining the no-download posture entirely.
// Canvas rendering sidesteps both - no native viewer chrome anywhere.
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const buffer = await (await fetch(fileUrl)).arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled || !containerRef.current) return;

        containerRef.current.innerHTML = "";
        const containerWidth = containerRef.current.clientWidth || 800;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: containerWidth / baseViewport.width });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mb-2 w-full rounded-lg shadow-2xl";
          containerRef.current.appendChild(canvas);

          await page.render({ canvas, viewport }).promise;
        }
      } catch {
        if (!cancelled) setError("Could not render this PDF.");
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  return <div ref={containerRef} className="mx-auto w-full max-w-3xl" />;
}
