import { useState, useEffect, useRef } from "react";

interface Props {
  src: string;
  size?: number;
  className?: string;
}

const cache = new Map<string, string>();

const downscale = (src: string, size: number): Promise<string> => {
  const key = `${src}@${size}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const px = size * (window.devicePixelRatio || 1);
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, px, px);
      const blob = canvas.toDataURL("image/jpeg", 0.7);
      cache.set(key, blob);
      resolve(blob);
    };
    img.onerror = reject;
    img.src = src;
  });
};

export const Thumb = ({ src, size = 52, className }: Props) => {
  const [thumbUrl, setThumbUrl] = useState(() => cache.get(`${src}@${size}`) || "");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const key = `${src}@${size}`;
    const cached = cache.get(key);
    if (cached) {
      setThumbUrl(cached);
      return;
    }
    downscale(src, size).then((url) => {
      if (mountedRef.current) setThumbUrl(url);
    }).catch(() => {});
  }, [src, size]);

  if (!thumbUrl) {
    return <div className={className} />;
  }

  return <img className={className} src={thumbUrl} alt="" />;
};
