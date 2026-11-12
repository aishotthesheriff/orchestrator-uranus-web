import { useEffect, useRef } from 'react';

interface CRTBackgroundProps {
  intensity?: 'low' | 'medium' | 'high' | 'extreme';
}

export default function CRTBackground({ intensity = 'high' }: CRTBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Adjust density based on intensity
    const densityConfig = {
      low: { cols: 40, rows: 15, baseOpacity: 0.3 },
      medium: { cols: 60, rows: 20, baseOpacity: 0.5 },
      high: { cols: 80, rows: 25, baseOpacity: 0.7 },
      extreme: { cols: 120, rows: 40, baseOpacity: 1.0 },
    };

    const config = densityConfig[intensity];
    const cols = config.cols;
    const rows = config.rows;
    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;
    ctx.font = `${cellH * 0.9}px monospace`;
    ctx.textBaseline = 'top';

    const glyphs = ['░', '▒', '▓', '█', '·', ':', '*', '+', '•', ' '];
    const basePalette = [
      [0, 255, 255],
      [255, 102, 255],
      [255, 170, 0],
      [255, 255, 255],
      [0, 170, 255],
    ];

    const phosphor = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({
        glyph: glyphs[Math.floor(Math.random() * glyphs.length)],
        color: basePalette[Math.floor(Math.random() * basePalette.length)],
        intensity: Math.random(),
        decay: Math.random() * 0.02 + 0.01,
        hueShift: Math.random() * 360,
      }))
    );

    function hslToRgb(h: number, s: number, l: number): [number, number, number] {
      s /= 100;
      l /= 100;
      const k = (n: number) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) =>
        l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return [255 * f(0), 255 * f(8), 255 * f(4)];
    }

    function draw() {
      if (!ctx || !canvas) return;
      const trailOpacity = intensity === 'extreme' ? 0.05 : 0.15;
      ctx.fillStyle = `rgba(0,0,0,${trailOpacity})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const p = phosphor[y][x];
          const hueSpeed = intensity === 'extreme' ? 2.0 : intensity === 'high' ? 0.5 : 0.2;
          p.hueShift += hueSpeed;
          if (p.hueShift > 360) p.hueShift -= 360;
          const intensityVariation = intensity === 'extreme' ? 0.1 : 0.02;
          const decayRate = intensity === 'extreme' ? p.decay * 0.5 : p.decay;
          p.intensity = Math.max(0, p.intensity - decayRate + Math.random() * intensityVariation);
          const regenerationChance = intensity === 'extreme' ? 0.15 : 0.02;
          if (p.intensity < 0.1 && Math.random() < regenerationChance) {
            p.glyph = glyphs[Math.floor(Math.random() * glyphs.length)];
            p.intensity = 1.0;
          }
          const [r, g, b] = hslToRgb(p.hueShift, 100, 60);
          const finalOpacity = p.intensity * config.baseOpacity;
          ctx.fillStyle = `rgba(${r},${g},${b},${finalOpacity})`;
          ctx.fillText(p.glyph, x * cellW, y * cellH);
        }
      }
      requestAnimationFrame(draw);
    }

    draw();

    return () => {
      window.removeEventListener('resize', resize);
    };
  }, [intensity]);

  const filterStyle = intensity === 'extreme' 
    ? 'blur(1px) contrast(3) brightness(2) saturate(2)'
    : intensity === 'high'
    ? 'blur(1.5px) contrast(2) brightness(1.5)'
    : 'blur(2px) contrast(1.6) brightness(1.3)';

  const flickerSpeed = intensity === 'extreme' ? '0.05s' : intensity === 'high' ? '0.08s' : '0.14s';

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 crt-canvas" />
      <style>{`
        .crt-canvas {
          filter: ${filterStyle};
          animation: flicker ${flickerSpeed} infinite;
        }
        @keyframes flicker {
          0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; }
          20%, 24%, 55% { opacity: ${intensity === 'extreme' ? 0.7 : 0.85}; }
        }
      `}</style>
    </>
  );
}
