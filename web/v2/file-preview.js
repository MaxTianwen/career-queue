// Private passive previews only: no iframe, HTML injection, object URL or persistent cache.
export function filePreview({ load, download }) {
  const $ = s => document.querySelector(s),
    dialog = $('#file-preview-dialog'),
    content = $('#file-preview-content'),
    status = $('#file-preview-status'),
    closeButton = $('#file-preview-close'),
    retry = $('#file-preview-retry'),
    downloadButton = $('#file-preview-download');
  let ticket = 0,
    controller = null,
    current = null,
    opener = null;
  function clear(restore = true) {
    ticket++;
    controller?.abort();
    controller = null;
    current = null;
    content.replaceChildren();
    status.textContent = '';
    $('#file-preview-title').textContent = '文件预览';
    $('#file-preview-note').textContent = '';
    retry.hidden = true;
    if (dialog.open) dialog.close();
    const target = opener;
    opener = null;
    if (restore && target?.isConnected && !target.disabled) target.focus({ preventScroll: true });
  }
  async function read() {
    const file = current,
      version = ++ticket;
    controller?.abort();
    controller = new AbortController();
    content.replaceChildren();
    status.dataset.state = 'loading';
    status.textContent = '正在读取预览…';
    retry.hidden = true;
    try {
      const result = await load(file, controller.signal);
      if (version !== ticket || !dialog.open) return;
      if (result.mode === 'pages') {
        if (
          !Number.isInteger(result.pages) ||
          result.pages < 1 ||
          result.pages > 10 ||
          result.images?.length !== result.pages
        )
          throw Error('预览页数无效，请重试');
        const figures = result.images.map((data, i) => {
          if (typeof data !== 'string' || !data.startsWith('iVBORw0KGgo') || !/^[-A-Za-z0-9+/=]+$/.test(data))
            throw Error('预览图片无效，请重试');
          const figure = document.createElement('figure'),
            img = document.createElement('img'),
            caption = document.createElement('figcaption');
          img.src = 'data:image/png;base64,' + data;
          img.alt = file.name + '，第' + (i + 1) + '页';
          caption.textContent = '第 ' + (i + 1) + ' / ' + result.pages + ' 页';
          figure.append(img, caption);
          return figure;
        });
        content.append(...figures);
        $('#file-preview-note').textContent = 'PDF版式预览 · 原件逐页图片，链接和脚本不会执行。';
      } else if (result.mode === 'text' && typeof result.text === 'string' && result.text.length <= 100000) {
        const pre = document.createElement('pre');
        pre.textContent = result.text;
        content.append(pre);
        $('#file-preview-note').textContent =
          'Word文字预览 · 不代表原始排版，图片、页眉和分页可能不显示。完整格式请下载原件查看。';
      } else throw Error('预览结果无效，请重试');
      status.dataset.state = 'success';
      status.textContent = file.deletedAt
        ? '回收站文件 · 只读预览，原件仍保留。'
        : '预览完成；不会启用简历或确认申请材料。';
    } catch (error) {
      if (version !== ticket || !dialog.open) return;
      status.dataset.state = 'error';
      status.textContent = error.message || '预览失败，请重试或下载原件';
      retry.hidden = false;
    }
  }
  function open(file, trigger) {
    clear(false);
    current = file;
    opener = trigger || document.activeElement;
    $('#file-preview-title').textContent = file.name + ' · ' + file.format.toUpperCase();
    downloadButton.disabled = false;
    closeButton.disabled = false;
    dialog.showModal();
    closeButton.focus();
    void read();
  }
  closeButton.addEventListener('click', () => clear());
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    clear();
  });
  retry.addEventListener('click', () => void read());
  downloadButton.addEventListener('click', async () => {
    if (!current) return;
    const file = current,
      version = ticket;
    downloadButton.disabled = true;
    try {
      await download({ ...file, viewDownload: true });
    } catch (e) {
      if (version === ticket && dialog.open) {
        status.dataset.state = 'error';
        status.textContent = e.message;
      }
    } finally {
      if (version === ticket) downloadButton.disabled = false;
    }
  });
  window.addEventListener('pagehide', () => clear(false));
  return { open, clear };
}
