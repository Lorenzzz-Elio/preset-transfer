import { getJQuery, getParentWindow } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { regexGroupIcon } from './icons.js';

const BULK_GROUP_BUTTON_ID = 'pt_bulk_group_regex';

function findBulkOperationsContainer() {
  const $ = getJQuery();
  return $('#regex_container .regex_bulk_operations').first();
}

export function ensureRegexBulkGroupButtonInjected() {
  const $ = getJQuery();
  const $container = findBulkOperationsContainer();
  if (!$container.length) return false;

  if ($(`#${BULK_GROUP_BUTTON_ID}`).length) return true;

  const vars = CommonStyles.getVars();
  const $button = $(
    `<div id="${BULK_GROUP_BUTTON_ID}" class="menu_button menu_button_icon" title="分组" style="color: ${vars.textColor};">
      <span class="pt-icon-wrap" aria-hidden="true">${regexGroupIcon()}</span>
      <small>分组</small>
    </div>`,
  );

  const $delete = $container.find('#bulk_delete_regex').first();
  if ($delete.length) {
    $delete.before($button);
  } else {
    $container.append($button);
  }

  return true;
}

export function getSelectedGlobalRegexIds() {
  const $ = getJQuery();
  const $list = $('#saved_regex_scripts');
  if (!$list.length) return [];

  return $list
    .find('.regex_bulk_checkbox:checked')
    .closest('.regex-script-label')
    .toArray()
    .map((el) => String(el?.id ?? ''))
    .filter(Boolean);
}

export function clearRegexBulkSelection() {
  const $ = getJQuery();
  const $checkboxes = $('#regex_container .regex_bulk_checkbox');
  if (!$checkboxes.length) return;

  $checkboxes.prop('checked', false);

  const $selectAllIcon = $('#bulk_select_all_toggle').find('i');
  if ($selectAllIcon.length) {
    $selectAllIcon.toggleClass('fa-check-double', true);
    $selectAllIcon.toggleClass('fa-minus', false);
  }
}

export function bindRegexBulkGroupButton(onClick) {
  const $ = getJQuery();
  const parentWindow = getParentWindow();
  const doc = parentWindow?.document ?? document;

  $(doc)
    .off('click.pt-regex-bulk-group', `#${BULK_GROUP_BUTTON_ID}`)
    .on('click.pt-regex-bulk-group', `#${BULK_GROUP_BUTTON_ID}`, async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onClick === 'function') await onClick(e);
    });
}

export function unbindRegexBulkGroupButton() {
  const $ = getJQuery();
  const parentWindow = getParentWindow();
  const doc = parentWindow?.document ?? document;
  $(doc).off('click.pt-regex-bulk-group', `#${BULK_GROUP_BUTTON_ID}`);
}

export function removeRegexBulkGroupButton() {
  const $ = getJQuery();
  $(`#${BULK_GROUP_BUTTON_ID}`).remove();
}
