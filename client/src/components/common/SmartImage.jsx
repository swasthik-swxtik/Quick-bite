/**
 * SmartImage.jsx — <img> with a graceful fallback.
 *
 * Outlet and menu images come from external URLs (Unsplash in the seed data).
 * If the URL is missing, the image fails to load, or the device is offline, we
 * render a neutral letter placeholder instead of a broken-image icon.
 *
 * The wrapper element owns the sizing (aspect-ratio / fixed box); this
 * component fills it, so callers pass the wrapper's image/fallback classes.
 */

import { useState } from 'react';
import styles from './SmartImage.module.css';

const SmartImage = ({
  src,
  alt = '',
  name = '',
  imgClassName = '',
  fallbackClassName = '',
}) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    const letter = name.trim().charAt(0).toUpperCase() || '?';
    return (
      <span
        className={`${styles.fallback} ${fallbackClassName}`}
        role="img"
        aria-label={alt || name || 'Image unavailable'}
      >
        {letter}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={imgClassName}
      onError={() => setFailed(true)}
    />
  );
};

export default SmartImage;
