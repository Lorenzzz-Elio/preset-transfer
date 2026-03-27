import { escapeAttr, getCurrentApiInfo, getJQuery, getParentWindow } from '../core/utils.js';
import { PT } from '../core/api-compat.js';
import { duplicatePresetEntries } from '../operations/copy-move.js';
import { CommonStyles } from '../styles/common-styles.js';

const MORE_BUTTON_SELECTOR = '.pt-entry-more-btn';
const MENU_SELECTOR = '.pt-entry-more-menu';
const EVENT_NAMESPACE = '.pt-entry-more-btn';

let eventsBound = false;
let promptManagerPatched = false;
let nativeEntryMoreEnabled = false;

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

function stopEvent(event) {
  event.preventDefault();
  event.stopPropagation();
}

function stopEventPropagation(event) {
  event.stopPropagation();
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

function isSupportedPromptManagerInstance(instance) {
  return (
    nativeEntryMoreEnabled &&
    instance?.configuration?.prefix === 'completion_' &&
    instance?.configuration?.containerIdentifier === 'completion_prompt_manager'
  );
}

function createMoreButtonHtml(identifier) {
  const vars = CommonStyles.getVars();

  return `
    <span
      class="pt-entry-more-btn fa-solid fa-ellipsis fa-xs"
      role="button"
      tabindex="0"
      title="\u66f4\u591a\u64cd\u4f5c"
      aria-label="\u66f4\u591a\u64cd\u4f5c"
      style="
        margin-inline-start: calc(${vars.gap} / 3);
        font-size: ${vars.fontSizeSmall};
      "
      data-pt-identifier="${escapeAttr(identifier)}">
    </span>
  `;
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
}

async function handleDuplicateEntry(identifier) {
  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) {
    throw new Error('\u65e0\u6cd5\u8bbf\u95ee\u5f53\u524d\u9884\u8bbe\u7ba1\u7406\u5668\u3002');
  }

  const presetName = resolveCurrentPresetName();
  if (!presetName) {
    throw new Error('\u65e0\u6cd5\u786e\u5b9a\u5f53\u524d\u6fc0\u6d3b\u7684\u9884\u8bbe\u3002');
  }

  const { getPresetDataFromManager } = await import('../preset/preset-manager.js');
  const presetData = getPresetDataFromManager(apiInfo, presetName);
  const entry = presetData?.prompts?.find((prompt) => prompt?.identifier === identifier);

  if (!entry) {
    throw new Error('\u627e\u4e0d\u5230\u9009\u4e2d\u7684\u6761\u76ee\u3002');
  }

  await duplicatePresetEntries(apiInfo, presetName, [entry], { refreshDisplay: false });
  await refreshNativePromptManager();
  notify('success', `\u5df2\u590d\u5236\u6761\u76ee\uff1a${entry.name ?? identifier}`);
}

async function handleBeautifyEntry(identifier) {
  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) {
    throw new Error('\u65e0\u6cd5\u8bbf\u95ee\u5f53\u524d\u9884\u8bbe\u7ba1\u7406\u5668\u3002');
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
      data-pt-identifier="${escapeAttr(identifier)}"
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
        \u590d\u5236\u6761\u76ee
      </button>
      <button type="button" class="pt-entry-more-action" data-pt-action="beautify">
        \u7f8e\u5316\u6b63\u5219
      </button>
    </div>
  `);

  menu.on('pointerdown mousedown click', stopEventPropagation);

  menu.on('click', '.pt-entry-more-action', async (event) => {
    stopEvent(event);

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
      notify('error', `\u64cd\u4f5c\u5931\u8d25\uff1a${error.message}`);
    }
  });

  const $panelContainer = findPanelContainer(buttonElement);
  ($panelContainer.length ? $panelContainer : $(getParentDocument().body)).append(menu);
  positionEntryMoreMenu(menu[0], buttonElement);
  $(buttonElement).addClass('is-open');
}

function handleMoreButtonClick(event) {
  stopEvent(event);

  const buttonElement = event.currentTarget;
  const identifier = String(buttonElement.getAttribute('data-pt-identifier') ?? '').trim();
  if (!identifier) return;

  showEntryMoreMenu(buttonElement, identifier);
}

function handleMoreButtonKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  stopEvent(event);
  handleMoreButtonClick(event);
}

function bindEntryMoreButtonEvents(promptManagerList) {
  Array.from(promptManagerList.querySelectorAll(MORE_BUTTON_SELECTOR)).forEach((el) => {
    el.addEventListener('pointerdown', stopEventPropagation);
    el.addEventListener('mousedown', stopEventPropagation);
    el.addEventListener('click', handleMoreButtonClick);
    el.addEventListener('keydown', handleMoreButtonKeydown);
  });
}

function bindDocumentEvents() {
  if (eventsBound) return;

  const $ = getJQuery();
  const parentDocument = getParentDocument();
  const parentWindow = getParentWindow();
  const $document = $(parentDocument);

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

async function ensurePromptManagerPatched() {
  if (promptManagerPatched) return;

  const [{ PromptManager, INJECTION_POSITION }, { renderTemplateAsync }, { escapeHtml }] = await Promise.all([
    import('/scripts/PromptManager.js'),
    import('/scripts/templates.js'),
    import('/scripts/utils.js'),
  ]);

  const prototype = PromptManager?.prototype;
  if (!prototype) return;

  if (prototype.__ptEntryMorePatched) {
    promptManagerPatched = true;
    return;
  }

  const originalRenderPromptManagerListItems = prototype.renderPromptManagerListItems;

  prototype.renderPromptManagerListItems = async function (...args) {
    if (!isSupportedPromptManagerInstance(this)) {
      return originalRenderPromptManagerListItems.apply(this, args);
    }

    if (!this.serviceSettings.prompts) return;

    closeEntryMoreMenu();

    const promptManagerList = this.listElement;
    promptManagerList.innerHTML = '';

    const { prefix } = this.configuration;
    let listItemHtml = await renderTemplateAsync('promptManagerListHeader', { prefix });

    this.getPromptsForCharacter(this.activeCharacter).forEach((prompt) => {
      if (!prompt) return;

      const listEntry = this.getPromptOrderEntry(this.activeCharacter, prompt.identifier);
      const enabledClass = listEntry.enabled ? '' : `${prefix}prompt_manager_prompt_disabled`;
      const draggableClass = `${prefix}prompt_manager_prompt_draggable`;
      const markerClass = prompt.marker ? `${prefix}prompt_manager_marker` : '';
      const tokens = this.tokenHandler?.getCounts()[prompt.identifier] ?? 0;

      let warningClass = '';
      let warningTitle = '';

      const tokenBudget = this.serviceSettings.openai_max_context - this.serviceSettings.openai_max_tokens;
      if (this.tokenUsage > tokenBudget * 0.8 && prompt.identifier === 'chatHistory') {
        const warningThreshold = this.configuration.warningTokenThreshold;
        const dangerThreshold = this.configuration.dangerTokenThreshold;

        if (tokens <= dangerThreshold) {
          warningClass = 'fa-solid tooltip fa-triangle-exclamation text_danger';
          warningTitle = 'Very little of your chat history is being sent, consider deactivating some other prompts.';
        } else if (tokens <= warningThreshold) {
          warningClass = 'fa-solid tooltip fa-triangle-exclamation text_warning';
          warningTitle = 'Only a few messages worth chat history are being sent.';
        }
      }

      const calculatedTokens = tokens ? tokens : '-';

      let detachSpanHtml = '';
      if (this.isPromptDeletionAllowed(prompt)) {
        detachSpanHtml = `
          <span title="Remove" class="prompt-manager-detach-action caution fa-solid fa-chain-broken fa-xs"></span>
        `;
      } else {
        detachSpanHtml = '<span class="fa-solid"></span>';
      }

      let editSpanHtml = '';
      let moreSpanHtml = '';
      if (this.isPromptEditAllowed(prompt)) {
        editSpanHtml = `
          <span title="Edit" class="prompt-manager-edit-action fa-solid fa-pencil fa-xs"></span>
        `;
        moreSpanHtml = createMoreButtonHtml(prompt.identifier);
      } else {
        editSpanHtml = '<span class="fa-solid"></span>';
        moreSpanHtml = '<span class="fa-solid"></span>';
      }

      let toggleSpanHtml = '';
      if (this.isPromptToggleAllowed(prompt)) {
        toggleSpanHtml = `
          <span class="prompt-manager-toggle-action ${listEntry.enabled ? 'fa-solid fa-toggle-on' : 'fa-solid fa-toggle-off'}"></span>
        `;
      } else {
        toggleSpanHtml = '<span class="fa-solid"></span>';
      }

      const encodedName = escapeHtml(prompt.name);
      const isMarkerPrompt = prompt.marker && prompt.injection_position !== INJECTION_POSITION.ABSOLUTE;
      const isSystemPrompt =
        !prompt.marker &&
        prompt.system_prompt &&
        prompt.injection_position !== INJECTION_POSITION.ABSOLUTE &&
        !prompt.forbid_overrides;
      const isImportantPrompt =
        !prompt.marker &&
        prompt.system_prompt &&
        prompt.injection_position !== INJECTION_POSITION.ABSOLUTE &&
        prompt.forbid_overrides;
      const isUserPrompt =
        !prompt.marker &&
        !prompt.system_prompt &&
        prompt.injection_position !== INJECTION_POSITION.ABSOLUTE;
      const isInjectionPrompt = prompt.injection_position === INJECTION_POSITION.ABSOLUTE;
      const isOverriddenPrompt =
        Array.isArray(this.overriddenPrompts) && this.overriddenPrompts.includes(prompt.identifier);
      const importantClass = isImportantPrompt ? `${prefix}prompt_manager_important` : '';
      const iconLookup = prompt.role === 'system' && (prompt.marker || prompt.system_prompt) ? '' : prompt.role;

      const promptRoles = {
        assistant: { roleIcon: 'fa-robot', roleTitle: 'Prompt will be sent as Assistant' },
        user: { roleIcon: 'fa-user', roleTitle: 'Prompt will be sent as User' },
      };
      const roleIcon = promptRoles[iconLookup]?.roleIcon || '';
      const roleTitle = promptRoles[iconLookup]?.roleTitle || '';

      listItemHtml += `
        <li class="${prefix}prompt_manager_prompt ${draggableClass} ${enabledClass} ${markerClass} ${importantClass}" data-pm-identifier="${escapeHtml(prompt.identifier)}">
          <span class="drag-handle">☰</span>
          <span class="${prefix}prompt_manager_prompt_name" data-pm-name="${encodedName}">
            ${isMarkerPrompt ? '<span class="fa-fw fa-solid fa-thumb-tack" title="Marker"></span>' : ''}
            ${isSystemPrompt ? '<span class="fa-fw fa-solid fa-square-poll-horizontal" title="Global Prompt"></span>' : ''}
            ${isImportantPrompt ? '<span class="fa-fw fa-solid fa-star" title="Important Prompt"></span>' : ''}
            ${isUserPrompt ? '<span class="fa-fw fa-solid fa-asterisk" title="Preset Prompt"></span>' : ''}
            ${isInjectionPrompt ? '<span class="fa-fw fa-solid fa-syringe" title="In-Chat Injection"></span>' : ''}
            ${this.isPromptInspectionAllowed(prompt) ? `<a title="${encodedName}" class="prompt-manager-inspect-action">${encodedName}</a>` : `<span title="${encodedName}">${encodedName}</span>`}
            ${roleIcon ? `<span data-role="${escapeHtml(prompt.role)}" class="fa-xs fa-solid ${roleIcon}" title="${roleTitle}"></span>` : ''}
            ${isInjectionPrompt ? `<small class="prompt-manager-injection-depth">@ ${escapeHtml(prompt.injection_depth.toString())}</small>` : ''}
            ${isOverriddenPrompt ? '<small class="fa-solid fa-address-card prompt-manager-overridden" title="Pulled from a character card"></small>' : ''}
          </span>
          <span>
            <span class="prompt_manager_prompt_controls">
              ${detachSpanHtml}
              ${editSpanHtml}
              ${moreSpanHtml}
              ${toggleSpanHtml}
            </span>
          </span>
          <span class="prompt_manager_prompt_tokens" data-pm-tokens="${calculatedTokens}"><span class="${warningClass}" title="${warningTitle}"> </span>${calculatedTokens}</span>
        </li>
      `;
    });

    promptManagerList.insertAdjacentHTML('beforeend', listItemHtml);

    Array.from(promptManagerList.getElementsByClassName('prompt-manager-detach-action')).forEach((el) => {
      el.addEventListener('click', this.handleDetach);
    });

    Array.from(promptManagerList.getElementsByClassName('prompt-manager-inspect-action')).forEach((el) => {
      el.addEventListener('click', this.handleInspect);
    });

    Array.from(promptManagerList.getElementsByClassName('prompt-manager-edit-action')).forEach((el) => {
      el.addEventListener('click', this.handleEdit);
    });

    Array.from(promptManagerList.querySelectorAll('.prompt-manager-toggle-action')).forEach((el) => {
      el.addEventListener('click', this.handleToggle);
    });

    bindEntryMoreButtonEvents(promptManagerList);
  };

  prototype.__ptEntryMorePatched = true;
  promptManagerPatched = true;
}

function initNativeEntryMoreBtns() {
  const shouldRefresh = !nativeEntryMoreEnabled || !promptManagerPatched;
  nativeEntryMoreEnabled = true;

  bindDocumentEvents();

  void ensurePromptManagerPatched().then(() => {
    if (shouldRefresh && nativeEntryMoreEnabled) {
      return refreshNativePromptManager();
    }
  });
}

function destroyNativeEntryMoreBtns() {
  const $ = getJQuery();
  const parentDocument = getParentDocument();
  const parentWindow = getParentWindow();

  nativeEntryMoreEnabled = false;

  if (eventsBound) {
    $(parentDocument).off(EVENT_NAMESPACE);
    parentWindow.removeEventListener('resize', closeEntryMoreMenu);
    eventsBound = false;
  }

  closeEntryMoreMenu();
  $(MORE_BUTTON_SELECTOR).remove();
  void refreshNativePromptManager();
}

export {
  initNativeEntryMoreBtns,
  destroyNativeEntryMoreBtns,
  closeEntryMoreMenu,
};
