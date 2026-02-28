/**
 * WebM video recorder using the browser's MediaRecorder + Canvas API.
 * Renders SVG frames to a canvas and captures the stream.
 */
export class VideoRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(width: number, height: number) {
    // @2x for sharpness
    this.canvas        = document.createElement("canvas");
    this.canvas.width  = width  * 2;
    this.canvas.height = height * 2;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D canvas context");
    this.ctx = ctx;
  }

  start(): void {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder API is not supported in this browser");
    }

    if (typeof this.canvas.captureStream !== "function") {
      throw new Error("canvas.captureStream is not supported in this browser");
    }

    this.chunks = [];
    const stream = this.canvas.captureStream(24); // 24 fps target

    let mimeType: string;
    if (typeof MediaRecorder.isTypeSupported === "function") {
      if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
        mimeType = "video/webm;codecs=vp9";
      } else if (MediaRecorder.isTypeSupported("video/webm")) {
        mimeType = "video/webm";
      } else {
        throw new Error("WebM video recording is not supported in this browser");
      }
    } else {
      // Fallback for environments without isTypeSupported; assume basic WebM support.
      mimeType = "video/webm";
    }

    try {
      this.mediaRecorder = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      throw new Error(`Failed to create MediaRecorder with mimeType "${mimeType}": ${err}`);
    }
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start(100); // emit data every 100 ms
  }

  async captureFrame(svgStr: string): Promise<void> {
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url  = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src   = url;
      await new Promise<void>((resolve, reject) => {
        img.onload  = () => resolve();
        img.onerror = () => reject(new Error("SVG frame load failed"));
      });
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  stop(): Promise<string> {
    if (!this.mediaRecorder) {
      return Promise.reject(new Error("MediaRecorder has not been started"));
    }

    const recorder = this.mediaRecorder;
    const STOP_TIMEOUT_MS = 10_000;

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        recorder.onstop  = null;
        recorder.onerror = null;
        this.mediaRecorder = null;
        fn();
      };

      const timeoutId = setTimeout(() => {
        settle(() => reject(new Error("MediaRecorder stop timed out")));
        try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* ignore */ }
      }, STOP_TIMEOUT_MS);

      recorder.onstop = () => {
        settle(() => {
          const blob = new Blob(this.chunks, { type: "video/webm" });
          resolve(URL.createObjectURL(blob));
        });
      };

      recorder.onerror = (event) => {
        const err = (event as Event & { error?: DOMException }).error;
        settle(() => reject(err ?? new Error("MediaRecorder error")));
      };

      recorder.stop();
    });
  }
}
