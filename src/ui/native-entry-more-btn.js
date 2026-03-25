import { debounce, getCurrentApiInfo, getJQuery, getParentWindow } from '../core/utils.js';
import { PT } from '../core/api-compat.js';
import { duplicatePresetEntries } from '../operations/copy-move.js';
import { CommonStyles } from '../styles/common-styles.js';

const ENTRY_SELECTOR = 'li[data-pm-identifier]';
const LIST_SELECTOR = '#completion_prompt_manager_list, [id$="prompt_manager_list"]';
const CONTROLS_SELECTOR = '.prompt_manager_prompt_controls';
const EDIT_BUTTON_SELECTOR = '.prompt-manager-edit-action';
const MORE_BUTTON_SELECTOR = '.pt-entry-more-btn';
const MENU_SELECTOR = '.pt-entry-more-menu';
const EVENT_NAMESPACE = '.pt-entry-more-btn';

let observer = null;
let eventsBound = false;
let promptManagerPatched = false;
const pendingScanRoots = new Set();

function getParentDocument() {
  return getParentWindow().document;
}

function notify(type, message) {
  const parentWindow = getParentWindow();

  if (parentWindow.toastr?.[type]) {
    parentWindow.toastr[type](message);
    return;
  }

  if (type === 'error') {
    parentWindow.alert?.(message);
  }
}

function closeEntryMoreMenu() {
  const $ = getJQuery();
  $(MENU_SELECTOR).remove();
  $(MORE_BUTTON_SELECTOR).removeClass('is-open');
}

function findPanelContainer(target) {
  const $ = getJQuery();
  const $target = $(target);
  return $target.closest('.range-block');
}

function resolveCurrentPresetName() {
  try {
    return PT.API.getLoadedPresetName?.() ?? null;
  } catch {
    return null;
  }
}

function getPromptManagerLists() {
  const parentDocument = getParentDocument();
  return Array.from(parentDocument.querySelectorAll(LIST_SELECTOR)).filter((list) => {
    return list instanceof HTMLElement && list.closest('#completion_prompt_manager');
  });
}

function scanEntryMoreButtonsInRoots(roots) {
  const $ = getJQuery();
  const normalizedRoots = Array.isArray(roots) ? roots.filter(Boolean) : getPromptManagerLists();

  for (const root of normalizedRoots) {
    const $root = $(root);
    if ($root.is(ENTRY_SELECTOR)) {
      injectMoreButton($root);
      continue;
    }

    $root.find(ENTRY_SELECTOR).each(function () {
      injectMoreButton($(this));
    });
  }
}

function injectMoreButton($entry) {
  const $ = getJQuery();
  if (!$entry?.length || $entry.find(MORE_BUTTON_SELECTOR).length) return;

  const identifier = String($entry.attr('data-pm-identifier') ?? '').trim();
  if (!identifier) return;

  const $editButton = $entry.find(EDIT_BUTTON_SELECTOR).first();
  const $controls = $entry.find(CONTROLS_SELECTOR).first();
  if (!$editButton.length || !$controls.length) return;

  const vars = CommonStyles.getVars();

  const $button = $(`
    <span
      class="pt-entry-more-btn fa-solid fa-ellipsis fa-xs"
      role="button"
      tabindex="0"
      title="更多操作"
      aria-label="更多操作"
      style="
        margin-inline-start: calc(${vars.gap} / 3);
        font-size: ${vars.fontSizeSmall};
      "
      data-pt-identifier="${identifier}">
    </span>
  `);

  $editButton.after($button);
}

function scanEntryMoreButtons() {
  scanEntryMoreButtonsInRoots(getPromptManagerLists());
}

function queueEntryMoreButtonScan(roots) {
  if (Array.isArray(roots)) {
    for (const root of roots) {
      if (root instanceof HTMLElement) {
        pendingScanRoots.add(root);
      }
    }
  }

  debouncedFlushEntryMoreButtonScan();
}

const debouncedFlushEntryMoreButtonScan = debounce(() => {
  const roots = Array.from(pendingScanRoots);
  pendingScanRoots.clear();

  if (roots.length) {
    scanEntryMoreButtonsInRoots(roots);
    return;
  }

  scanEntryMoreButtons();
}, 32);

function collectScanRootsFromNode(node, roots) {
  if (!(node instanceof HTMLElement)) return;
  if (!node.closest('#completion_prompt_manager')) return;
  if (node.matches?.(MORE_BUTTON_SELECTOR) || node.matches?.(MENU_SELECTOR)) return;

  if (node.matches?.(ENTRY_SELECTOR) || node.matches?.(LIST_SELECTOR)) {
    roots.add(node);
    return;
  }

  const entryRoot = node.closest(ENTRY_SELECTOR);
  if (entryRoot instanceof HTMLElement) {
    roots.add(entryRoot);
    return;
  }

  if (node.querySelector?.(ENTRY_SELECTOR)) {
    roots.add(node);
  }
}

function collectScanRootsFromMutations(mutations) {
  const roots = new Set();

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes ?? []) {
      collectScanRootsFromNode(node, roots);
    }
  }

  return Array.from(roots);
}

function positionEntryMoreMenu(menuElement, buttonElement) {
  const parentWindow = getParentWindow();
  const buttonRect = buttonElement.getBoundingClientRect();
  const menuRect = menuElement.getBoundingClientRect();

  const preferredLeft = buttonRect.right - menuRect.width;
  const preferredTop = buttonRect.bottom + 6;
  const maxLeft = parentWindow.innerWidth - menuRect.width - 8;
  const maxTop = parentWindow.innerHeight - menuRect.height - 8;

  menuElement.style.left = `${Math.max(8, Math.min(preferredLeft, maxLeft))}px`;
  menuElement.style.top = `${Math.max(8, Math.min(preferredTop, maxTop))}px`;
}

async function refreshNativePromptManager() {
  try {
    const mod = await import('/scripts/openai.js');
    mod.promptManager?.render?.(false);
  } catch (error) {
    console.warn('[EntryMoreBtn] Failed to refresh Prompt Manager:', error);
  }

  queueEntryMoreButtonScan();
}

async function ensurePromptManagerPatched() {
  if (promptManagerPatched) return;

  const mod = await import('/scripts/PromptManager.js');
  const prototype = mod?.PromptManager?.prototype;
  if (!prototype || prototype.__ptEntryMorePatched) {
    promptManagerPatched = true;
    return;
  }

  const originalRenderPromptManagerListItems = prototype.renderPromptManagerListItems;
  prototype.renderPromptManagerListItems = async function (...args) {
    const result = await originalRenderPromptManagerListItems.apply(this, args);

    try {
      const listElement = this?.listElement;
      if (listElement instanceof HTMLElement) {
        queueEntryMoreButtonScan([listElement]);
      }
    } catch (error) {
      console.warn('[EntryMoreBtn] Failed to inject buttons during PromptManager render:', error);
    }

    return result;
  };

  prototype.__ptEntryMorePatched = true;
  promptManagerPatched = true;
}

async function handleDuplicateEntry(identifier) {
  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) {
    throw new Error('无法访问当前预设管理器。');
  }

  const presetName = resolveCurrentPresetName();
  if (!presetName) {
    throw new Error('无法确定当前激活的预设。');
  }

  const { getPresetDataFromManager } = await import('../preset/preset-manager.js');
  const presetData = getPresetDataFromManager(apiInfo, presetName);
  const entry = presetData?.prompts?.find((prompt) => prompt?.identifier === identifier);

  if (!entry) {
    throw new Error('找不到对应的条目。');
  }

  await duplicatePresetEntries(apiInfo, presetName, [entry], { refreshDisplay: false });
  await refreshNativePromptManager();
  notify('success', `已复制条目：${entry.name ?? identifier}`);
}

async function handleBeautifyEntry(identifier) {
  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) {
    throw new Error('无法访问当前预设管理器。');
  }

  const { openBeautifyModal } = await import('./entry-beautify-modal.js');
  await openBeautifyModal(identifier, apiInfo);
}

function showEntryMoreMenu(buttonElement, identifier) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  const existingMenu = $(MENU_SELECTOR);
  const isSameButtonOpen =
    existingMenu.length &&
    existingMenu.attr('data-pt-identifier') === identifier &&
    $(buttonElement).hasClass('is-open');

  closeEntryMoreMenu();
  if (isSameButtonOpen) return;

  const menu = $(`
    <div
      class="pt-entry-more-menu"
      data-pt-identifier="${identifier}"
      style="
        --pt-entry-more-bg: ${vars.bgColor};
        --pt-entry-more-border: ${vars.borderColor};
        --pt-entry-more-text: ${vars.textColor};
        --pt-entry-more-hover-bg: ${vars.sectionBg};
        --pt-entry-more-radius: ${vars.borderRadiusSmall};
        --pt-entry-more-padding: ${vars.paddingSmall};
        --pt-entry-more-font-size: ${vars.fontSizeSmall};
      ">
      <button type="button" class="pt-entry-more-action" data-pt-action="duplicate">
        复制条目
      </button>
      <button type="button" class="pt-entry-more-action" data-pt-action="beautify">
        美化正则
      </button>
    </div>
  `);

  menu.on('pointerdown mousedown click', (event) => {
    event.stopPropagation();
  });

  menu.on('click', '.pt-entry-more-action', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const action = String(event.currentTarget.dataset.ptAction ?? '').trim();
    closeEntryMoreMenu();

    try {
      if (action === 'duplicate') {
        await handleDuplicateEntry(identifier);
        return;
      }

      if (action === 'beautify') {
        await handleBeautifyEntry(identifier);
      }
    } catch (error) {
      console.error(`[EntryMoreBtn] Failed to run "${action}" action:`, error);
      notify('error', `操作失败：${error.message}`);
    }
  });

  const $panelContainer = findPanelContainer(buttonElement);
  ($panelContainer.length ? $panelContainer : $(getParentDocument().body)).append(menu);
  positionEntryMoreMenu(menu[0], buttonElement);
  $(buttonElement).addClass('is-open');
}

function bindDocumentEvents() {
  if (eventsBound) return;

  const $ = getJQuery();
  const parentDocument = getParentDocument();
  const parentWindow = getParentWindow();
  const $document = $(parentDocument);

  $document
    .off(`pointerdown${EVENT_NAMESPACE}`, MORE_BUTTON_SELECTOR)
    .on(`pointerdown${EVENT_NAMESPACE}`, MORE_BUTTON_SELECTOR, (event) => {
      event.stopPropagation();
    });

  $document
    .off(`mousedown${EVENT_NAMESPACE}`, MORE_BUTTON_SELECTOR)
    .on(`mousedown${EVENT_NAMESPACE}`, MORE_BUTTON_SELECTOR, (event) => {
      event.stopPropagation();
    });

  $document
    .off(`click${EVENT_NAMESPACE}`, MORE_BUTTON_SELECTOR)
    .on(`click${EVENT_NAMESPACE}`, MORE_BUTTON_SELECTOR, (event) => {
      event.preventDefault();
      event.stopPropagation();

      const buttonElement = event.currentTarget;
      const identifier = String(buttonElement.getAttribute('data-pt-identifier') ?? '').trim();
      if (!identifier) return;

      showEntryMoreMenu(buttonElement, identifier);
    });

  $document
    .off(`keydown${EVENT_NAMESPACE}`, MORE_BUTTON_SELECTOR)
    .on(`keydown${EVENT_NAMESPACE}`, MORE_BUTTON_SELECTOR, (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.click();
    });

  $document
    .off(`mousedown${EVENT_NAMESPACE}`)
    .on(`mousedown${EVENT_NAMESPACE}`, (event) => {
      if (!$(event.target).closest(`${MENU_SELECTOR}, ${MORE_BUTTON_SELECTOR}`).length) {
        closeEntryMoreMenu();
      }
    });

  $document
    .off(`keydown${EVENT_NAMESPACE}`)
    .on(`keydown${EVENT_NAMESPACE}`, (event) => {
      if (event.key === 'Escape') {
        closeEntryMoreMenu();
      }
    });

  parentWindow.removeEventListener('resize', closeEntryMoreMenu);
  parentWindow.addEventListener('resize', closeEntryMoreMenu, { passive: true });

  eventsBound = true;
}

function initNativeEntryMoreBtns() {
  const parentDocument = getParentDocument();
  const target = parentDocument.querySelector('#completion_prompt_manager') ?? parentDocument.body;
  if (!target) return;

  void ensurePromptManagerPatched();
  bindDocumentEvents();
  queueEntryMoreButtonScan();

  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver((mutations) => {
    const roots = collectScanRootsFromMutations(mutations);
    if (roots.length) {
      queueEntryMoreButtonScan(roots);
    }
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
  });
}

function destroyNativeEntryMoreBtns() {
  const $ = getJQuery();
  const parentDocument = getParentDocument();
  const parentWindow = getParentWindow();

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (eventsBound) {
    $(parentDocument).off(EVENT_NAMESPACE);
    parentWindow.removeEventListener('resize', closeEntryMoreMenu);
    eventsBound = false;
  }

  closeEntryMoreMenu();
  pendingScanRoots.clear();
  $(MORE_BUTTON_SELECTOR).remove();
}

export {
  initNativeEntryMoreBtns,
  destroyNativeEntryMoreBtns,
  closeEntryMoreMenu,
};
