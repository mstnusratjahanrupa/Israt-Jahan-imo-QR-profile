import React, { useEffect, useRef, useState } from 'react';
import { subscribeToLiveScreenShare } from '../utils/firebaseRtdb';

interface LiveQrVideoPlayerProps {
  size?: number;
  className?: string;
  onShowToast?: (msg: string) => void;
}

export const LiveQrVideoPlayer: React.FC<LiveQrVideoPlayerProps> = ({
  size = 218,
  className = '',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live Screen Share states from Firebase RTDB (screen_share/live)
  const [isScreenShareActive, setIsScreenShareActive] = useState<boolean>(false);
  const [liveScreenData, setLiveScreenData] = useState<string | null>(null);

  // 1. Subscribe to Firebase Realtime Database: screen_share/live (onValue)
  useEffect(() => {
    const unsubscribe = subscribeToLiveScreenShare((payload) => {
      if (payload.active && payload.streamData) {
        let formattedData = payload.streamData.trim();

        // If raw base64 string without data URI scheme, auto-detect and prepend scheme
        if (
          !formattedData.startsWith('data:') &&
          !formattedData.startsWith('http') &&
          !formattedData.startsWith('blob:')
        ) {
          if (formattedData.startsWith('/9j/')) {
            formattedData = `data:image/jpeg;base64,${formattedData}`;
          } else if (formattedData.startsWith('iVBORw')) {
            formattedData = `data:image/png;base64,${formattedData}`;
          } else {
            formattedData = `data:image/jpeg;base64,${formattedData}`;
          }
        }

        setLiveScreenData(formattedData);
        setIsScreenShareActive(true);
      } else {
        // Screen share stopped: clear screen and switch to Standby mode
        setLiveScreenData(null);
        setIsScreenShareActive(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 2. Clean Standby Video Stream Generator (Active when screen sharing is inactive)
  // No text, no badges, pure clean visual feed
  useEffect(() => {
    if (isScreenShareActive) {
      return;
    }

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = size * 2;
    canvas.height = size * 2;

    let animationFrameId: number;
    let angle = 0;
    let scanY = 0;
    let scanDirection = 1;

    let canvasStream: MediaStream | null = null;
    try {
      if ((canvas as any).captureStream) {
        canvasStream = (canvas as any).captureStream(30);
        video.srcObject = canvasStream;
        video.play().catch(() => {});
      }
    } catch (e) {
      console.warn('Canvas captureStream warning:', e);
    }

    const renderCleanStandby = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Studio Dark Slate Minimal Background
      const bgGrad = ctx.createLinearGradient(0, 0, w, h);
      bgGrad.addColorStop(0, '#090D16');
      bgGrad.addColorStop(0.5, '#0F172A');
      bgGrad.addColorStop(1, '#050811');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Clean subtle grid lines
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.06)';
      ctx.lineWidth = 1;
      const step = 28;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Minimal rotating optical ring
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle);
      angle += 0.015;

      ctx.strokeStyle = 'rgba(14, 165, 233, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 75, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.setLineDash([8, 12]);
      ctx.beginPath();
      ctx.arc(0, 0, 115, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Optical Data Blocks (Simulating QR / Sensor Sync Packets)
      const now = Date.now();
      const blockSize = 14;
      const matrixSize = 7;
      const startX = (w - matrixSize * blockSize) / 2;
      const startY = (h - matrixSize * blockSize) / 2;

      for (let r = 0; r < matrixSize; r++) {
        for (let c = 0; c < matrixSize; c++) {
          const isCorner =
            (r < 2 && c < 2) ||
            (r < 2 && c >= matrixSize - 2) ||
            (r >= matrixSize - 2 && c < 2);
          const active = isCorner || Math.sin(now * 0.003 + r * 1.5 + c * 2.1) > 0;

          if (active) {
            ctx.fillStyle = isCorner
              ? '#38BDF8'
              : `rgba(56, 189, 248, ${0.35 + Math.sin(now * 0.005 + r + c) * 0.25})`;
            ctx.fillRect(startX + c * blockSize, startY + r * blockSize, blockSize - 2, blockSize - 2);
          }
        }
      }

      // Clean Laser Scanner Bar
      scanY += 2.2 * scanDirection;
      if (scanY > h - 25) scanDirection = -1;
      if (scanY < 25) scanDirection = 1;

      const laserGrad = ctx.createLinearGradient(0, scanY - 10, 0, scanY + 10);
      laserGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
      laserGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.7)');
      laserGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = laserGrad;
      ctx.fillRect(15, scanY - 8, w - 30, 16);

      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(15, scanY);
      ctx.lineTo(w - 15, scanY);
      ctx.stroke();

      animationFrameId = requestAnimationFrame(renderCleanStandby);
    };

    renderCleanStandby();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (canvasStream) {
        canvasStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isScreenShareActive, size]);

  // Helper to determine if data is a video URL/mp4 or image
  const isVideoData =
    liveScreenData?.startsWith('data:video') ||
    liveScreenData?.includes('.mp4') ||
    liveScreenData?.includes('.webm');

  return (
    <div
      className={`relative rounded-2xl overflow-hidden bg-black select-none border border-slate-900/60 shadow-inner flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="region"
      aria-label="Clean Live Video Frame"
    >
      {/* Hidden Canvas for Standby Generator */}
      <canvas ref={canvasRef} className="hidden" />

      {/* 1. When Screen Share is Active: Completely Clean Image or Video (No text, No badge) */}
      {isScreenShareActive && liveScreenData ? (
        <div className="w-full h-full relative flex items-center justify-center bg-black">
          {isVideoData ? (
            <video
              src={liveScreenData}
              autoPlay
              playsInline
              muted
              loop
              className="w-full h-full object-contain bg-black block"
            />
          ) : (
            <img
              src={liveScreenData}
              alt="Live Screen"
              className="w-full h-full object-contain bg-black block"
              onError={() => {
                console.warn('Image render notice');
              }}
            />
          )}
        </div>
      ) : (
        /* 2. Standby Mode: Clean Video Stream (No text, No badge) */
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          loop
          className="w-full h-full object-cover block bg-slate-950 pointer-events-none"
        />
      )}
    </div>
  );
};
