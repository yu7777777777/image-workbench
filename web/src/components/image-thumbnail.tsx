"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type ImageThumbnailProps = {
  src: string;
  thumbnailSrc?: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
};

/** 把日志里保存的绝对地址（可能写死了内网 IP / 端口）归一为同源相对路径。
 *  日志记录的是生成时的 base_url，用户改用域名或 HTTPS 访问后，
 *  直接使用这些绝对地址会跨域或触发混合内容拦截，导致缩略图裂开。 */
export function toSameOriginUrl(src: string) {
  if (!src) return src;
  const marker = "/images/";
  const index = src.indexOf(marker);
  if (index < 0) return src;
  return src.slice(index);
}

export function getImageThumbnailUrl(src: string) {
  const relative = toSameOriginUrl(src);
  const marker = "/images/";
  const index = relative.indexOf(marker);
  if (index < 0) return relative;
  return `/image-thumbnails/${relative.slice(index + marker.length)}`;
}

export function ImageThumbnail({ src, thumbnailSrc, alt = "", className, imageClassName }: ImageThumbnailProps) {
  const fallbackSrc = useMemo(() => toSameOriginUrl(src), [src]);
  const initialSrc = useMemo(() => thumbnailSrc || getImageThumbnailUrl(src), [src, thumbnailSrc]);
  const [currentSrc, setCurrentSrc] = useState(initialSrc);

  useEffect(() => {
    setCurrentSrc(initialSrc);
  }, [initialSrc]);

  return (
    <span className={cn("block overflow-hidden bg-stone-100", className)}>
      <img
        src={currentSrc}
        alt={alt}
        className={cn("h-full w-full object-cover", imageClassName)}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (currentSrc !== fallbackSrc) {
            setCurrentSrc(fallbackSrc);
          }
        }}
      />
    </span>
  );
}
