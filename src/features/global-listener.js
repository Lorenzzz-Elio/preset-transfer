// ==================== 全局预设监听器 ====================

import { PT } from '../core/api-compat.js';
import { getRegexBindingEnabled, switchPresetRegexes } from './regex-binding.js';
import { getCurrentApiInfo, getJQuery, getParentWindow } from '../core/utils.js';
import { updatePresetRegexStatus } from '../ui/regex-ui.js';
import {
  updateNativeEntryStatesPanel,
  renderNativeEntryStatesContent,
  bindNativeEntryStatesPanelEvents,
  renderNativePresetRegexContent,
  bindNativePresetRegexPanelEvents,
  updateNativeRegexPanel,
} from '../ui/native-panel.js';

// 负责追踪当前加载的预设，并在预设切换时触发正则切换与原生折叠面板更新
let globalPresetListener = {
  isActive: false,
  currentPreset: null,
  pollInterval: null,
  originalLoadPreset: null,
  originalSelectPreset: null,
  hookedPresetManager: null,
  switchInProgress: false,
  parentWindow: null,

  // 初始化全局监听器
  init() {
    if (this.isActive) return;

    try {
      this.parentWindow = getParentWindow?.() ?? window;

      // 记录当前预设作为基准
      this.currentPreset = this.getCurrentPresetName();

      // 方案 1：监听酒馆原生事件
      this.listenToPresetEvents();

      // 方案 2：Hook loadPreset 函数（备选）
      this.hookLoadPreset();

      // 方案 3：轮询检测（最后兜底）
      this.startPolling();

      // 初始化时也对当前预设执行一次处理（跨设备进入时保证正则绑定/面板状态能被正确应用）
      const initialPreset = this.currentPreset;
      if (initialPreset) {
        setTimeout(() => {
          try {
            void this.handlePresetChange(null, initialPreset);
          } catch {
            /* ignore */
          }
        }, 0);
      }

      this.isActive = true;
    } catch (error) {
      console.error('初始化全局预设监听器失败:', error);
    }
  },

  // 停止监听器
  stop() {
    if (!this.isActive) return;

    // 恢复原始函数
    if (this.originalLoadPreset) {
      const pw = this.parentWindow ?? window;
      if (typeof pw.loadPreset === 'function') pw.loadPreset = this.originalLoadPreset;
      this.originalLoadPreset = null;
    }

    if (this.hookedPresetManager && this.originalSelectPreset) {
      try {
        this.hookedPresetManager.selectPreset = this.originalSelectPreset;
      } catch {
        /* ignore */
      }
      this.originalSelectPreset = null;
      this.hookedPresetManager = null;
    }

    // 停止轮询
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.isActive = false;
  },

  // 通过 PT.API 统一获取当前预设名
  getCurrentPresetName() {
    try {
      const nameFromApi = PT.API.getLoadedPresetName?.() ?? null;
      if (nameFromApi) return nameFromApi;

      // OpenAI preset selector: selected option text is the real preset name.
      try {
        const $ = getJQuery();
        const t = $('#settings_preset_openai').find(':selected').text();
        if (t) return String(t);
      } catch {
        /* ignore */
      }

      const apiInfo = getCurrentApiInfo?.();
      const pm = apiInfo?.presetManager;
      if (pm && typeof pm.getCompletionPresetByName === 'function') {
        const inUse = pm.getCompletionPresetByName('in_use');
        if (inUse && inUse.name && inUse.name !== 'in_use') return inUse.name;
      }

      return null;
    } catch (error) {
      console.warn('获取当前预设名称失败:', error);
      return null;
    }
  },

  // 监听酒馆原生“预设切换”事件
  listenToPresetEvents() {
    try {
      const self = this;
      const handle = data => {
        let presetName = data;
        if (typeof data === 'object' && data !== null) {
          presetName = data.name || data.presetName || data.preset || String(data);
        }

        // Some events (like oai_preset_changed_after) may not pass a name.
        if (!presetName || typeof presetName !== 'string') {
          presetName = self.getCurrentPresetName();
        }

        if (presetName && typeof presetName === 'string') {
          self.handlePresetChange(self.currentPreset, presetName);
        }
      };

      const pw = self.parentWindow ?? window;

      // Use the extension's native event API (SillyTavern context eventSource).
      // Avoid relying on any third-party globals that may or may not exist.
      const eventOnFn = typeof PT.API.eventOn === 'function' ? PT.API.eventOn : null;

      if (eventOnFn) {
        // OpenAI preset change in ST 1.13+ uses this event, typically without args.
        eventOnFn('oai_preset_changed_after', () => setTimeout(() => handle(null), 0));
        // Generic preset change (may include arg depending on implementation).
        eventOnFn('preset_changed', data => setTimeout(() => handle(data), 0));
      }

      // DOM fallback: OpenAI preset select change (immediate in most builds).
      try {
        const $ = getJQuery();
        $(document)
          .off('change.presetTransfer', '#settings_preset_openai')
          .on('change.presetTransfer', '#settings_preset_openai', function () {
            const name = $(this).find(':selected').text();
            if (name) handle({ name: String(name) });
          });
      } catch {
        /* ignore */
      }

      // 兼容各种大小写 / 命名风格
      ['PRESET_CHANGED', 'presetChanged', 'preset-changed'].forEach(evt => {
        try {
          eventOnFn?.(evt, pn => {
            console.log(`事件监听检测到预设切换 (${evt}): ${self.currentPreset} -> ${pn}`);
            self.handlePresetChange(self.currentPreset, pn);
          });
        } catch {
          // 忽略单个事件名失败
        }
      });
    } catch (error) {
      console.warn('监听预设事件失败:', error);
    }
  },

  // Hook loadPreset 函数（优先 Hook 酒馆原生的 window.loadPreset，避免 PT.API 包装引起递归）
  hookLoadPreset() {
    try {
      const pw = this.parentWindow ?? window;
      const nativeLoadPreset =
        (typeof pw?.loadPreset === 'function' && pw.loadPreset) || (typeof loadPreset === 'function' ? loadPreset : null);
      const self = this;

      if (!nativeLoadPreset) {
        // Many ST builds don't expose a global `loadPreset`. Prefer hooking the native PresetManager instance.
        try {
          const apiInfo = getCurrentApiInfo?.();
          const pm = apiInfo?.presetManager;

          if (pm && typeof pm.selectPreset === 'function') {
            // Avoid double-wrapping if init() runs multiple times.
            if (!self.originalSelectPreset) {
              self.hookedPresetManager = pm;
              self.originalSelectPreset = pm.selectPreset;

              pm.selectPreset = function (...args) {
                const previousPreset = self.getCurrentPresetName();
                const result = self.originalSelectPreset.apply(this, args);

                Promise.resolve(result)
                  .catch(() => {})
                  .finally(() => {
                    const nextPreset = self.getCurrentPresetName();
                    if (nextPreset && nextPreset !== previousPreset) {
                      self.handlePresetChange(previousPreset, nextPreset);
                    }
                  });

                return result;
              };

              console.log('PresetManager.selectPreset Hook 成功');
            }
            return;
          }
        } catch (e) {
          console.warn('Hook PresetManager.selectPreset 失败，将回退到事件监听/轮询兜底:', e);
        }

        console.debug('未找到可 Hook 的 loadPreset / PresetManager.selectPreset，将使用事件监听/轮询兜底');
        return;
      }

      // 记录原始函数，stop() 时可以恢复
      this.originalLoadPreset = nativeLoadPreset;

      pw.loadPreset = function (presetName) {
        const previousPreset = self.getCurrentPresetName();
        console.log(`Hook 检测到预设切换: ${previousPreset} -> ${presetName}`);

        const result = nativeLoadPreset.call(this, presetName);

        // 不管同步/异步，都尽快触发 UI 刷新；handlePresetChange 内部有防重入保护
        Promise.resolve(result)
          .catch(() => {})
          .finally(() => {
            if (presetName && presetName !== previousPreset) {
              self.handlePresetChange(previousPreset, presetName);
            }
          });

        return result;
      };

      console.log('loadPreset 函数 Hook 成功');
    } catch (error) {
      console.error('Hook loadPreset 函数失败:', error);
    }
  },

  // 启动轮询兜底（事件/Hook 失效时仍能检测到变更）
  startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(() => {
      const newPreset = this.getCurrentPresetName();
      if (newPreset && newPreset !== this.currentPreset) {
        console.log(`轮询检测到预设切换: ${this.currentPreset} -> ${newPreset}`);
        this.handlePresetChange(this.currentPreset, newPreset);
      }
    }, 1500);

    console.log('预设轮询检测已启动 (1.5s)');
  },

  // 处理预设切换
  async handlePresetChange(fromPreset, toPreset) {
    // 防止重复处理
    if (this.switchInProgress) {
      console.log('正则切换正在进行中，跳过重复处理');
      return;
    }

    try {
      this.switchInProgress = true;
      this.currentPreset = toPreset;

      // 检查正则绑定开关，只有开启时才执行正则切换
      if (getRegexBindingEnabled()) {
        try {
          // Ensure preset data is actually updated before applying regex state.
          const waitForPreset = async name => {
            const start = Date.now();
            while (Date.now() - start < 1500) {
              try {
                const loaded = this.getCurrentPresetName();
                // Wait until the preset selector reflects the new preset.
                if (loaded === name) {
                  if (Date.now() - start > 120) return true; // small grace period for preset data to settle
                }
              } catch {
                /* ignore */
              }
              await new Promise(r => setTimeout(r, 80));
            }
            return false;
          };

          await waitForPreset(toPreset);

          // Apply preset-scoped regex enable/disable (may still be async-populated; retry a bit if needed).
          let applied = false;
          for (let i = 0; i < 6; i++) {
            await switchPresetRegexes(fromPreset, toPreset);
            // If this preset has bindings, we should be able to see them after apply.
            try {
              const p = PT.API.getPreset?.(toPreset);
              if (!p?.extensions?.regexBindings) {
                // No bindings stored; one pass is enough.
                applied = true;
                break;
              }
              applied = true;
              break;
            } catch {
              /* ignore */
            }
            await new Promise(r => setTimeout(r, 120));
          }
          // 等待一小段时间确保正则状态已完全更新
          await new Promise(r => setTimeout(r, 150));
          if (!applied) {
            console.warn('正则切换未确认完成（可能是预设数据延迟加载）');
          }
        } catch (e) {
          console.warn('正则切换失败（已忽略）:', e);
        }
      }

      // 更新工具界面与原生折叠面板状态（如果存在）
      if (toPreset) {
        updatePresetRegexStatus(toPreset);

        // 更新条目状态管理面板
        if (typeof updateNativeEntryStatesPanel === 'function') {
          updateNativeEntryStatesPanel(toPreset);

          // 如果面板已经展开，则刷新内容
          try {
            const $ = getJQuery();
            const entryStatesPanel = $('#st-native-entry-states-panel');
            if (entryStatesPanel.length) {
              const $content = entryStatesPanel.find('.content');
              const expanded = $content.is(':visible');
              if (expanded) {
                renderNativeEntryStatesContent(toPreset);
                bindNativeEntryStatesPanelEvents(toPreset);
              }
            }
          } catch {
            // 忽略原生面板更新异常
          }
        }

        // 更新正则绑定面板
        if (typeof updateNativeRegexPanel === 'function') {
          updateNativeRegexPanel(toPreset);

          // 如果面板已经展开，则刷新列表并保留筛选/搜索状态
          try {
            const $ = getJQuery();
            const panel = $('#st-native-regex-panel');
            if (panel.length) {
              const $content = panel.find('.content');
              const expanded = $content.is(':visible');
              const searchVal = $('#preset-regex-search').val();

              if (expanded) {
                renderNativePresetRegexContent(toPreset);
                bindNativePresetRegexPanelEvents(toPreset);

                if (searchVal) $('#preset-regex-search').val(searchVal);
              }
            }
          } catch {
            // 忽略原生面板更新异常
          }
        }

        // Keep polling as a fallback; hook/event reliability varies by environment.
      }
    } catch (error) {
      console.error('处理预设切换失败:', error);
    } finally {
      this.switchInProgress = false;
    }
  },
};

// 旧的“正则绑定配置”弹窗已弃用，改为原生面板内联编辑；保留导出名称避免旧调用报错

export { globalPresetListener };

// 导出便捷方法
export const init = () => globalPresetListener.init();
export const stop = () => globalPresetListener.stop();
