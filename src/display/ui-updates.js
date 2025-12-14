import { getJQuery } from '../core/utils.js';
function updatePanelButtons(side) {
  const $ = getJQuery();
  const total = $(`#${side}-entries-list .entry-checkbox`).length;
  const selected = $(`#${side}-entries-list .entry-checkbox:checked`).length;

  $(`#${side}-selection-count`).text(`已选择 ${selected}/${total}`);
  $(`#${side}-edit`).prop('disabled', selected === 0);
  $(`#${side}-delete`).prop('disabled', selected === 0);
  $(`#${side}-copy`).prop('disabled', selected === 0);

  if (side === 'left') {
    $('#transfer-to-right').prop('disabled', selected === 0 || !$('#right-preset').val());
  } else if (side === 'right') {
    $('#transfer-to-left').prop('disabled', selected === 0 || !$('#left-preset').val());
  } else if (side === 'single') {
    $(`#${side}-move`).prop('disabled', selected === 0);
  }
}

function updateSelectionCount() {
  const $ = getJQuery();
  if ($('#single-container').is(':visible')) {
    updatePanelButtons('single');
  } else {
    updatePanelButtons('left');
    updatePanelButtons('right');
  }
}


export {
  updatePanelButtons,
  updateSelectionCount
};
