// Common layout and color helpers for the preset transfer UI.
// The palette is derived from the current UI background and body text color,
// then kept mostly neutral (no strong "danger" colors) so it blends with
// different SillyTavern themes without clashing.

import { getCssVar, parseColorToRgb, rgbToRgba, luminance } from '../core/color-utils.js';

const CommonStyles = {
  getVars() {
    // Device info: prefer global getDeviceInfo, fall back to a simple heuristic.
    const deviceInfo =
      typeof getDeviceInfo === 'function' ? getDeviceInfo() : { isMobile: false, isSmallScreen: false };
    const { isMobile, isSmallScreen } = deviceInfo;

    // Font size: prefer user slider value, otherwise follow SillyTavern body font size.
    const storedFontSize = localStorage.getItem('preset-transfer-font-size');
    let baseFontSize = 16;
    try {
      const parentWindow = window.parent && window.parent !== window ? window.parent : window;
      const bodyStyles = parentWindow.getComputedStyle(parentWindow.document.body);
      const bodyFontSize = bodyStyles.fontSize; // e.g. "16px"
      const parsed = parseInt(bodyFontSize, 10);
      if (!Number.isNaN(parsed) && parsed > 8 && parsed < 40) {
        baseFontSize = parsed;
      }
    } catch (e) {
      // keep default
    }
    const fontSize = storedFontSize || String(baseFontSize);

    // Base "UI background" – approximate from SillyTavern blur tint or page background.
    let rawBg = getCssVar('--SmartThemeBlurTintColor', '');
    if (!rawBg || rawBg === 'transparent' || rawBg === 'rgba(0, 0, 0, 0)') {
      try {
        const parentWindow = window.parent && window.parent !== window ? window.parent : window;
        const bodyStyles = parentWindow.getComputedStyle(parentWindow.document.body);
        rawBg = bodyStyles.backgroundColor || '#111827';
      } catch {
        rawBg = '#111827';
      }
    }

    const bgRgb = parseColorToRgb(rawBg) || { r: 17, g: 24, b: 39 }; // fallback slate-900
    const bgLum = luminance(bgRgb);
    const isDarkBase = bgLum < 140;

    // Main text color from theme, but ensure contrast against panel background.
    let rawText = getCssVar('--SmartThemeBodyColor', isDarkBase ? '#f9fafb' : '#111827');
    let textRgb = parseColorToRgb(rawText);
    if (textRgb) {
      const textLum = luminance(textRgb);
      if (Math.abs(textLum - bgLum) < 60) {
        rawText = isDarkBase ? '#f9fafb' : '#111827';
        textRgb = parseColorToRgb(rawText);
      }
    } else {
      rawText = isDarkBase ? '#f9fafb' : '#111827';
      textRgb = parseColorToRgb(rawText);
    }

    const textColor = rawText;

    // Derive a neutral, slightly translucent palette from the base background.
    const panelAlpha = isDarkBase ? 0.82 : 0.9;
    const sectionAlpha = isDarkBase ? 0.76 : 0.85;
    const subAlpha = isDarkBase ? 0.62 : 0.75;

    const bgColor = rgbToRgba(bgRgb, panelAlpha);
    const sectionBg = rgbToRgba(bgRgb, sectionAlpha);
    const subBg = rgbToRgba(bgRgb, subAlpha);

    const borderAlpha = isDarkBase ? 0.55 : 0.25;
    const borderColor = rgbToRgba(bgRgb, borderAlpha);

    const tipBase = textRgb || bgRgb;
    const tipAlpha = isDarkBase ? 0.65 : 0.55;
    const tipColor = rgbToRgba(tipBase, tipAlpha);

    // Soft accent for buttons and highlights – no strong danger color, only subtle variation.
    const accentAlpha = isDarkBase ? 0.5 : 0.35;
    const accentMutedAlpha = isDarkBase ? 0.4 : 0.28;
    const accentColor = rgbToRgba(bgRgb, accentAlpha);
    const accentMutedColor = rgbToRgba(bgRgb, accentMutedAlpha);

    // No separate "danger" color – keep everything harmonious.
    const dangerColor = accentColor;

    return {
      // Theme colors
      bgColor,
      textColor,
      borderColor,
      inputBg: subBg,
      inputBorder: borderColor,
      sectionBg,
      subBg,
      tipColor,
      accentColor,
      accentMutedColor,
      dangerColor,

      // Font sizes
      fontSize: `${fontSize}px`,
      fontSizeSmall: `calc(${fontSize}px * 0.75)`,
      fontSizeMedium: `calc(${fontSize}px * 0.875)`,
      fontSizeLarge: `calc(${fontSize}px * 1.125)`,

      // Spacing
      padding: isMobile ? '16px' : '24px',
      paddingSmall: isMobile ? '12px' : '16px',
      paddingLarge: isMobile ? '20px' : '28px',
      margin: isMobile ? '16px' : '20px',
      gap: isMobile ? '8px' : '12px',

      // Sizes
      borderRadius: '16px',
      borderRadiusSmall: '8px',
      borderRadiusMedium: '12px',
      maxWidth: isMobile ? '95vw' : '600px',
      maxWidthLarge: isMobile ? '95vw' : '800px',
      maxHeight: '80vh',

      // Button shapes
      buttonPadding: isMobile ? '14px 24px' : '12px 22px',
      buttonPaddingSmall: isMobile ? '8px 16px' : '6px 12px',
      buttonRadius: '8px',

      // Responsive markers
      isMobile,
      isSmallScreen,
    };
  },

  // Basic modal overlay styles
  getModalBaseStyles(customVars = {}) {
    const vars = { ...this.getVars(), ...customVars };
    return `
      position: fixed; top: 0; left: 0; width: 100vw;
      height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
      z-index: 10001; display: flex; align-items: center; justify-content: center;
      padding: ${vars.padding};
      padding-top: calc(${vars.padding} + env(safe-area-inset-top));
      padding-bottom: calc(${vars.padding} + env(safe-area-inset-bottom));
      animation: pt-fadeIn 0.3s ease-out;
    `;
  },

  // Basic modal content container styles
  getModalContentStyles(customVars = {}) {
    const vars = { ...this.getVars(), ...customVars };
    return `
      background: ${vars.bgColor}; border-radius: ${vars.borderRadius};
      padding: ${vars.padding}; max-width: ${vars.maxWidth}; width: 100%;
      max-height: ${vars.maxHeight}; overflow-y: auto; color: ${vars.textColor};
      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
    `;
  },
};

export {
  CommonStyles
};
