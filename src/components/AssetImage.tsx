import { useEffect, useState } from 'react';

interface AssetImageProps {
  src?: string;
  fallback: string;
  alt: string;
  className: string;
}

export function AssetImage({ src, fallback, alt, className }: AssetImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span className={className}>
      {src && !failed ? (
        <img className="asset-image" src={src} alt={alt} onError={() => setFailed(true)} draggable={false} />
      ) : (
        <span className="asset-fallback" aria-hidden="true">
          {fallback}
        </span>
      )}
    </span>
  );
}
