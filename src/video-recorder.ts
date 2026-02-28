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
    this.canvas        = document.createElement('canvas');
    this.canvas.width  = width  * 2;
    this.canvas.height = height * 2;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D canvas context');
    this.ctx = ctx;
  }

  start(): void {
    this.chunks = [];
    const stream   = this.canvas.captureStream(24); // 24 fps target
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    this.mediaRecorder = new MediaRecorder(stream, { mimeType });
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start(100); // emit data every 100 ms
  }

  async captureFrame(svgStr: string): Promise<void> {
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src   = url;
      await new Promise<void>((resolve, reject) => {
        img.onload  = () => resolve();
        img.onerror = () => reject(new Error('SVG frame load failed'));
      });
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  stop(): Promise<string> {
    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'video/webm' });
        resolve(URL.createObjectURL(blob));
      };
      this.mediaRecorder!.stop();
    });
  }
}
