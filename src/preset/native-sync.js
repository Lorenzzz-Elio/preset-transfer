import { PT } from '../core/api-compat.js';
import { getJQuery } from '../core/utils.js';

/**
 * Checks whether the specified preset name is currently active in SillyTavern.
 * @param {string} presetName
 * @param {object} [apiInfo]
 * @returns {boolean}
 */
export function isCurrentActivePreset(presetName, apiInfo) {
  if (!presetName) return false;
  const targetName = String(presetName).trim().toLowerCase();

  try {
    const loaded = PT.API.getLoadedPresetName?.();
    if (loaded && String(loaded).trim().toLowerCase() === targetName) {
      return true;
    }
  } catch {
    /* ignore */
  }

  try {
    const selected = apiInfo?.presetManager?.getSelectedPresetName?.();
    if (selected && String(selected).trim().toLowerCase() === targetName) {
      return true;
    }
  } catch {
    /* ignore */
  }

  try {
    const $ = getJQuery();
    const text = $('#settings_preset_openai option:selected').text();
    if (text && text.trim().toLowerCase() === targetName) {
      return true;
    }
  } catch {
    /* ignore */
  }

  try {
    const oai = apiInfo?.context?.chatCompletionSettings;
    if (oai?.preset_settings_openai && String(oai.preset_settings_openai).trim().toLowerCase() === targetName) {
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Synchronously updates SillyTavern's in-memory preset cache and, if the preset
 * is currently active, updates oai_settings and re-renders the native PromptManager.
 *
 * @param {object} apiInfo
 * @param {string} presetName
 * @param {object} [updatedPresetData]
 * @returns {Promise<boolean>}
 */
export async function syncNativePromptManagerIfActive(apiInfo, presetName, updatedPresetData = null) {
  try {
    if (!presetName) return false;

    // 1. Resolve preset data
    let presetData = updatedPresetData;
    if (!presetData && apiInfo?.presetManager?.getCompletionPresetByName) {
      presetData = apiInfo.presetManager.getCompletionPresetByName(presetName);
    }
    if (!presetData) {
      try {
        presetData = PT.API.getPreset?.(presetName);
      } catch {
        /* ignore */
      }
    }

    // 2. Ensure in-memory preset cache (openai_settings) is kept in sync
    if (apiInfo?.presetManager?.getPresetList && presetData) {
      try {
        const { presets, preset_names } = apiInfo.presetManager.getPresetList();
        if (presets) {
          if (Array.isArray(preset_names)) {
            const index = preset_names.indexOf(presetName);
            if (index !== -1) presets[index] = presetData;
          } else if (preset_names && typeof preset_names === 'object') {
            const index = preset_names[presetName];
            if (index !== undefined) presets[index] = presetData;
          }
        }
      } catch (err) {
        console.warn('[preset-transfer] Failed to sync preset cache:', err);
      }
    }

    // 3. If this preset is not currently active, we are done
    if (!isCurrentActivePreset(presetName, apiInfo)) {
      return false;
    }

    if (!presetData) return false;

    // 4. Update SillyTavern's active settings (oai_settings)
    let mod = null;
    try {
      mod = await import('/scripts/openai.js');
    } catch {
      /* ignore */
    }

    const oaiSettings =
      mod?.oai_settings ||
      apiInfo?.presetManager?.getPresetList?.()?.settings ||
      apiInfo?.context?.chatCompletionSettings;

    if (oaiSettings) {
      if (Array.isArray(presetData.prompts)) {
        oaiSettings.prompts = structuredClone(presetData.prompts);
      }
      if (Array.isArray(presetData.prompt_order)) {
        oaiSettings.prompt_order = structuredClone(presetData.prompt_order);
      }
      if (presetData.extensions) {
        oaiSettings.extensions = structuredClone(presetData.extensions);
      }
    }

    // 5. Update PromptManager and re-render
    const pm = mod?.promptManager;
    if (pm) {
      if (pm.serviceSettings) {
        if (Array.isArray(presetData.prompts)) {
          pm.serviceSettings.prompts = oaiSettings?.prompts ?? structuredClone(presetData.prompts);
        }
        if (Array.isArray(presetData.prompt_order)) {
          pm.serviceSettings.prompt_order = oaiSettings?.prompt_order ?? structuredClone(presetData.prompt_order);
        }
        if (presetData.extensions) {
          pm.serviceSettings.extensions = oaiSettings?.extensions ?? structuredClone(presetData.extensions);
        }
      }

      // Update quick edit fields if present
      try {
        const mainPrompt = pm.getPromptById?.('main');
        if (mainPrompt) pm.updateQuickEdit?.('main', mainPrompt);
        const nsfwPrompt = pm.getPromptById?.('nsfw');
        if (nsfwPrompt) pm.updateQuickEdit?.('nsfw', nsfwPrompt);
        const jailbreakPrompt = pm.getPromptById?.('jailbreak');
        if (jailbreakPrompt) pm.updateQuickEdit?.('jailbreak', jailbreakPrompt);
      } catch {
        /* ignore */
      }

      // Clear token count cache to reflect changes
      try {
        pm.tokenHandler?.clear?.();
      } catch {
        /* ignore */
      }

      // Re-render native prompt manager
      try {
        pm.render?.(false);
      } catch (err) {
        console.warn('[preset-transfer] pm.render failed:', err);
      }
    }

    // 6. Re-apply native grouping UI
    try {
      const { scheduleApplyGrouping } = await import('../ui/entry-grouping-ui.js');
      scheduleApplyGrouping?.(0);
    } catch {
      /* ignore */
    }

    // 7. Re-apply native entry states panel
    try {
      const { updateNativeEntryStatesPanel } = await import('../ui/native-panel.js');
      updateNativeEntryStatesPanel?.(presetName);
    } catch {
      /* ignore */
    }

    return true;
  } catch (error) {
    console.warn('[preset-transfer] syncNativePromptManagerIfActive error:', error);
    return false;
  }
}
