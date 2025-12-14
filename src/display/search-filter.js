import { getJQuery } from '../core/utils.js';
import { getPresetDataFromManager, getNewEntries } from '../preset/preset-manager.js';
import { updateSelectionCount } from './ui-updates.js';

// Filter entries on both sides (and single mode) using the main search box.
function filterDualEntries(searchTerm) {
  const term = (searchTerm || '').toLowerCase().trim();
  const $ = getJQuery();

  // Clear previous search highlights / jump buttons
  clearSearchResults();

  const allListsSelector = '#left-entries-list .entry-item, #right-entries-list .entry-item, #single-entries-list .entry-item';

  if (!term) {
    // Show everything and restore "create here" buttons
    $(allListsSelector).each(function () {
      const $item = $(this);
      if (!$item.hasClass('position-item')) {
        $item.show();
        $item.find('.create-here-btn').show();
      }
    });
    return;
  }

  const searchContent = $('#search-content-main').is(':checked');

  $(allListsSelector).each(function () {
    const $item = $(this);
    if ($item.hasClass('position-item')) return;

    const name = ($item.find('.entry-name').text() || '').toLowerCase();

    // Resolve data source for content search
    let entriesRef = [];
    if ($item.closest('#left-entries-list').length) {
      entriesRef = window.leftEntries || [];
    } else if ($item.closest('#right-entries-list').length) {
      entriesRef = window.rightEntries || [];
    } else if ($item.closest('#single-entries-list').length) {
      entriesRef = window.singleEntries || [];
    }

    let contentText = '';
    const identifier = $item.data('identifier');
    if (identifier && entriesRef.length) {
      const entry = entriesRef.find(e => e && e.identifier === identifier);
      contentText = (entry && entry.content ? entry.content : '');
    } else {
      const idx = parseInt($item.data('index'), 10);
      if (!Number.isNaN(idx) && entriesRef[idx]) {
        contentText = entriesRef[idx].content || '';
      }
    }

    const matches = searchContent
      ? name.includes(term) || contentText.toLowerCase().includes(term)
      : name.includes(term);

    $item.toggle(matches);

    if (matches) {
      addJumpButton($item);
    } else {
      // Hide "create here" button for non‑matching entries
      $item.find('.create-here-btn').hide();
    }
  });
}

// Filter only one side (left / right) using the per‑side inline search box.
function filterSideEntries(side, searchTerm) {
  const term = (searchTerm || '').toLowerCase().trim();
  const $ = getJQuery();

  clearSearchResults(side);

  const listSelector = `#${side}-entries-list .entry-item`;

  if (!term) {
    $(listSelector).each(function () {
      const $item = $(this);
      if (!$item.hasClass('position-item')) {
        $item.show();
        $item.find('.create-here-btn').show();
      }
    });
    return;
  }

  const searchContentId = side === 'left' ? '#search-content-left' : '#search-content-right';
  const searchContent = $(searchContentId).is(':checked');

  $(listSelector).each(function () {
    const $item = $(this);
    if ($item.hasClass('position-item')) return;

    const name = ($item.find('.entry-name').text() || '').toLowerCase();

    const identifier = $item.data('identifier');
    const entriesRef =
      side === 'left'
        ? window.leftEntries || []
        : side === 'right'
        ? window.rightEntries || []
        : window.singleEntries || [];

    let contentText = '';
    if (identifier && entriesRef.length) {
      const entry = entriesRef.find(e => e && e.identifier === identifier);
      contentText = (entry && entry.content ? entry.content : '');
    } else {
      const idx = parseInt($item.data('index'), 10);
      if (!Number.isNaN(idx) && entriesRef[idx]) {
        contentText = entriesRef[idx].content || '';
      }
    }

    const matches = searchContent
      ? name.includes(term) || contentText.toLowerCase().includes(term)
      : name.includes(term);

    $item.toggle(matches);

    if (matches) {
      addJumpButton($item);
    } else {
      $item.find('.create-here-btn').hide();
    }
  });
}

// Add a small "jump" button that scrolls to the original position of this entry.
function addJumpButton($item) {
  const $ = getJQuery();

  if ($item.find('.jump-btn').length > 0) {
    return;
  }

  const $jumpBtn = $(`
    <button class="jump-btn" title="跳转到原始位置">
      <span class="jump-icon">↩</span>
    </button>
  `);

  $jumpBtn.on('click', e => {
    e.stopPropagation();
    jumpToOriginalPosition($item);
  });

  $item.append($jumpBtn);
  // When search is active, hide the "create here" button to avoid clutter.
  $item.find('.create-here-btn').hide();
}

// Remove jump buttons and restore "create here" buttons.
function clearSearchResults(side = null) {
  const $ = getJQuery();

  if (side) {
    $(`#${side}-entries-list .jump-btn`).remove();
    $(`#${side}-entries-list .create-here-btn`).show();
  } else {
    $('.jump-btn').remove();
    $('.create-here-btn').show();
  }
}

// Scroll to the original position of an entry that appeared in search results.
function jumpToOriginalPosition($searchItem) {
  const $ = getJQuery();
  const identifier = $searchItem.data('identifier');
  if (!identifier) return;

  let listSelector = '';
  if ($searchItem.closest('#left-entries-list').length) {
    listSelector = '#left-entries-list';
  } else if ($searchItem.closest('#right-entries-list').length) {
    listSelector = '#right-entries-list';
  } else if ($searchItem.closest('#single-entries-list').length) {
    listSelector = '#single-entries-list';
  }
  if (!listSelector) return;

  const $allItems = $(`${listSelector} .entry-item`);
  $allItems.show();

  const $originalItem = $allItems
    .filter(function () {
      const $item = $(this);
      return $item.data('identifier') === identifier && !$item.hasClass('position-item');
    })
    .first();

  if ($originalItem.length === 0) return;

  $originalItem[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  $originalItem.addClass('jump-highlight');
  setTimeout(() => $originalItem.removeClass('jump-highlight'), 2000);

  setTimeout(() => {
    const searchInput = getActiveSearchInput(listSelector);
    if (searchInput && searchInput.val()) {
      searchInput.val('');
      if (listSelector === '#left-entries-list') {
        filterSideEntries('left', '');
      } else if (listSelector === '#right-entries-list') {
        filterSideEntries('right', '');
      } else {
        filterDualEntries('');
      }
    }
  }, 100);
}

// Return the jQuery object for the currently relevant search input.
function getActiveSearchInput(listSelector) {
  const $ = getJQuery();

  if (listSelector === '#left-entries-list') {
    return $('#left-entry-search-inline').is(':visible')
      ? $('#left-entry-search-inline')
      : $('#left-entry-search');
  }
  if (listSelector === '#right-entries-list') {
    return $('#right-entry-search-inline');
  }
  return $('#entry-search');
}

// Toggle "show new entries" mode on a side (left/right).
function toggleNewEntries(apiInfo, side) {
  const $ = getJQuery();
  const leftPreset = $('#left-preset').val();
  const rightPreset = $('#right-preset').val();
  const button = $(`#${side}-show-new`);

  if (!leftPreset || !rightPreset || leftPreset === rightPreset) {
    alert('请先选择两个不同的预设，才能查看新增条目。');
    return;
  }

  const isShowingNew = button.hasClass('showing-new');

  if (isShowingNew) {
    // Turn off "new entries" mode and restore normal list.
    button.removeClass('showing-new');
    button.find('.btn-icon').text('');

    const searchValue = $(`#${side}-entry-search-inline`).val();
    if (searchValue) {
      setTimeout(() => filterSideEntries(side, searchValue), 50);
    } else {
      $(`#${side}-entries-list .entry-item`).each(function () {
        const $item = $(this);
        if (!$item.hasClass('position-item')) {
          $item.show();
        }
      });
    }

    const presetName = side === 'left' ? leftPreset : rightPreset;
    const sideLabel = side === 'left' ? '左侧' : '右侧';
    $(`#${side}-preset-title`).text(`${sideLabel}预设: ${presetName}`);

    setTimeout(() => {
      $(`#${side}-entries-list .entry-checkbox`).prop('checked', false);
      updateSelectionCount();
    }, 50);
    return;
  }

  // Turn on "new entries" mode.
  try {
    const leftData = getPresetDataFromManager(apiInfo, leftPreset);
    const rightData = getPresetDataFromManager(apiInfo, rightPreset);
    const allNewEntries = getNewEntries(leftData, rightData, side);
    const newEntryIdentifiers = new Set(allNewEntries.map(entry => entry.identifier));

    const sideLabel = side === 'left' ? '左侧' : '右侧';

    if (newEntryIdentifiers.size === 0) {
      alert(`${sideLabel}预设没有检测到新增条目。`);
      return;
    }

    button.addClass('showing-new');
    button.find('.btn-icon').text('');

    let visibleNewCount = 0;
    const searchValue = $(`#${side}-entry-search-inline`).val();
    const searchTerm = (searchValue || '').toLowerCase().trim();
    const entriesData = side === 'left' ? window.leftEntries || [] : window.rightEntries || [];

    $(`#${side}-entries-list .entry-item`).each(function () {
      const $item = $(this);
      if ($item.hasClass('position-item')) return;

      const identifier = $item.data('identifier');
      if (!identifier || !newEntryIdentifiers.has(identifier)) {
        $item.hide();
        return;
      }

      if (searchTerm) {
        const name = ($item.find('.entry-name').text() || '').toLowerCase();
        let contentText = '';
        const entry = entriesData.find(e => e && e.identifier === identifier);
        if (entry && entry.content) {
          contentText = entry.content.toLowerCase();
        }
        const matches = name.includes(searchTerm) || contentText.includes(searchTerm);
        if (!matches) {
          $item.hide();
          return;
        }
      }

      $item.show();
      visibleNewCount++;
      if (searchTerm) {
        addJumpButton($item);
      }
    });

    const presetName = side === 'left' ? leftPreset : rightPreset;
    $(`#${side}-preset-title`).text(`${sideLabel}预设: ${presetName} (新增 ${visibleNewCount})`);

    if (visibleNewCount === 0) {
      if (searchTerm) {
        alert(`在搜索 "${searchValue}" 的结果中，${sideLabel}预设没有符合条件的新增条目。`);
      } else {
        alert(`${sideLabel}预设没有检测到新增条目。`);
      }
      button.removeClass('showing-new');
      button.find('.btn-icon').text('');
    }
  } catch (error) {
    console.error('切换新增条目模式失败:', error);
    alert('切换新增条目模式失败: ' + error.message);
    button.removeClass('showing-new');
    button.find('.btn-icon').text('');
  }
}

export {
  filterDualEntries,
  filterSideEntries,
  addJumpButton,
  clearSearchResults,
  jumpToOriginalPosition,
  getActiveSearchInput,
  toggleNewEntries,
};
