// Shared color utility helpers for the Preset Transfer extension.
// These work in both the iframe and parent SillyTavern window.

// Read a CSS variable from the parent SillyTavern window with a safe fallback.
function getCssVar(name, fallback) {
  try {
    const parentWindow = window.parent && window.parent !== window ? window.parent : window;
    const doc = parentWindow.document;
    const styles = parentWindow.getComputedStyle(doc.documentElement);
    const value = styles.getPropertyValue(name);
    if (value && value.trim()) {
      return value.trim();
    }
  } catch (e) {
    // ignore and fall back
  }
  return fallback;
}

// Parse basic color formats (#rgb, #rrggbb, rgb(), rgba()) into { r, g, b }
function parseColorToRgb(color) {
  if (!color || typeof color !== 'string') return null;
  const c = color.trim();

  // Hex formats
  if (c[0] === '#') {
    const hex = c.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].some(n => Number.isNaN(n))) return null;
      return { r, g, b };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].some(n => Number.isNaN(n))) return null;
      return { r, g, b };
    }
    return null;
  }

  // rgb()/rgba()
  const m = c.match(/rgba?\s*\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) {
    const r = parseInt(m[1], 10);
    const g = parseInt(m[2], 10);
    const b = parseInt(m[3], 10);
    if ([r, g, b].some(n => Number.isNaN(n))) return null;
    return { r, g, b };
  }

  return null;
}

function rgbToRgba(rgb, alpha) {
  const { r, g, b } = rgb;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function luminance(rgb) {
  const { r, g, b } = rgb;
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export { getCssVar, parseColorToRgb, rgbToRgba, luminance };

