import { removeBackground } from 'https://unpkg.com/@imgly/background-removal@1.7.0/dist/index.mjs';

// ==== バージョン情報 ====
// index.html / app.js / sw.js を更新するたびにここも更新する
const APP_VERSION = '1.2.0';
const BUILD_DATE = '2026-08-15';
const BG_REMOVAL_LIB_VERSION = '1.7.0';

// Service Worker の登録
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

renderVersionInfo();

// 画面下部にバージョン情報を描画する
async function renderVersionInfo() {
  const versionDiv = document.getElementById('app-version');
  if (!versionDiv) return;

  let cacheLine = 'Service Worker: 未登録';
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      const swCache = keys.find((k) => k.startsWith('bg-remover-opt-'));
      cacheLine = swCache ? `Cache: ${swCache}` : 'Cache: (未作成 / 初回読み込み中)';
    } catch (e) {
      cacheLine = 'Cache: 取得失敗';
    }
  }

  versionDiv.innerHTML = `
    App v${APP_VERSION} (${BUILD_DATE})<br>
    @imgly/background-removal v${BG_REMOVAL_LIB_VERSION}<br>
    ${cacheLine}
  `;
}

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusDiv = document.getElementById('status');
const outputDiv = document.getElementById('output');
const downloadAllBtn = document.getElementById('download-all-btn');

// 設定要素
const maxWidthInput = document.getElementById('max-width');
const formatSelect = document.getElementById('format-select');
const qualityRange = document.getElementById('quality-range');
const qualityValue = document.getElementById('quality-value');

// 編集モーダル要素
const editModal = document.getElementById('edit-modal');
const editCanvas = document.getElementById('edit-canvas');
const editCtx = editCanvas.getContext('2d');
const brushSizeRange = document.getElementById('brush-size');
const modeEraseBtn = document.getElementById('mode-erase');
const modeRestoreBtn = document.getElementById('mode-restore');
const editResetBtn = document.getElementById('edit-reset-btn');
const editSaveBtn = document.getElementById('edit-save-btn');
const editCancelBtn = document.getElementById('edit-cancel-btn');
const brushCursor = document.getElementById('brush-cursor');

// items: { name, mimeType, quality, masterCanvas(透過保持), originalCanvas(元画像/戻す用), blob }
let items = [];
let editingIndex = null;
let editMode = 'erase'; // 'erase' | 'restore'
let isDrawing = false;
let resetSnapshot = null; // 編集開始時点のImageData（リセット用）

// 品質スライダーの表示更新
qualityRange.addEventListener('input', (e) => {
  qualityValue.textContent = `${e.target.value}%`;
});

// フォーマット選択時のスライダー無効化設定（PNGは品質圧縮対象外のため）
formatSelect.addEventListener('change', (e) => {
  const isPng = e.target.value === 'image/png';
  qualityRange.disabled = isPng;
  qualityValue.style.opacity = isPng ? '0.5' : '1';
});

// ドラッグ＆ドロップイベントハンドラー
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('hover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('hover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('hover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (files.length > 0) processFiles(files);
});

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length > 0) processFiles(files);
});

// ファイル一括処理ロジック
async function processFiles(files) {
  outputDiv.innerHTML = '';
  items = [];
  downloadAllBtn.style.display = 'none';

  // 現在の設定値を取得
  const maxWidth = parseInt(maxWidthInput.value, 10) || null;
  const mimeType = formatSelect.value;
  const quality = parseFloat(qualityRange.value) / 100;
  const extension = mimeType === 'image/png' ? 'png' : (mimeType === 'image/jpeg' ? 'jpg' : 'webp');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    statusDiv.textContent = `背景削除中... (${i + 1}/${files.length}): ${file.name}`;

    try {
      // 1. AIによる背景削除を実行
      const rawNoBgBlob = await removeBackground(file);

      statusDiv.textContent = `リサイズ・最適化処理中... (${i + 1}/${files.length}): ${file.name}`;

      // 2. 透過を保持したまま、リサイズ済みの「マスターCanvas」を作る
      const masterCanvas = await loadToCanvas(rawNoBgBlob, maxWidth);
      // 3. 「戻す」ブラシ用に、同じ解像度で元画像（背景削除前）も描画しておく
      const originalCanvas = await loadToCanvas(file, maxWidth, masterCanvas.width, masterCanvas.height);

      // 4. 指定フォーマット・品質でBlobにエンコード
      const outputBlob = await encodeCanvas(masterCanvas, mimeType, quality);
      const outputFileName = `no-bg_${file.name.replace(/\.[^/.]+$/, "")}.${extension}`;

      const item = {
        name: outputFileName,
        mimeType,
        quality,
        masterCanvas,
        originalCanvas,
        blob: outputBlob,
      };
      items.push(item);
      renderPreviewCard(item, items.length - 1);

    } catch (error) {
      console.error(`エラー (${file.name}):`, error);
    }
  }

  statusDiv.textContent = `すべての処理が完了しました！（計 ${items.length} 件）`;
  if (items.length > 0) {
    downloadAllBtn.style.display = 'block';
  }
}

// プレビューカードを描画（新規追加 / 再描画で共用）
function renderPreviewCard(item, index) {
  const url = URL.createObjectURL(item.blob);
  const sizeKB = (item.blob.size / 1024).toFixed(1);
  const extension = item.mimeType === 'image/png' ? 'PNG' : (item.mimeType === 'image/jpeg' ? 'JPG' : 'WEBP');

  let card = outputDiv.querySelector(`[data-index="${index}"]`);
  if (!card) {
    card = document.createElement('div');
    card.className = 'preview-card';
    card.dataset.index = String(index);
    outputDiv.appendChild(card);
  }

  card.innerHTML = `
    <img src="${url}" alt="${item.name}">
    <div class="file-size">${sizeKB} KB (${extension})</div>
    <div class="card-actions">
      <button type="button" class="edit-btn">手動補正</button>
      <a href="${url}" download="${item.name}">保存</a>
    </div>
  `;

  card.querySelector('.edit-btn').addEventListener('click', () => openEditor(index));
}

/**
 * 画像(File/Blob)を読み込み、透過を保持したまま指定サイズのCanvasに描画する。
 * targetWidth/targetHeightを渡した場合はそのサイズに強制フィットさせる
 * （「戻す」用の元画像Canvasを、背景削除後Canvasと同じ座標系に揃えるため）
 */
function loadToCanvas(blob, maxWidth, targetWidth, targetHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = targetWidth || img.width;
      let height = targetHeight || img.height;

      if (!targetWidth && maxWidth && width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * 透過保持Canvasを、指定フォーマット・品質のBlobにエンコードする。
 * JPEGの場合はこの時点で初めて白背景で塗りつぶす（編集中は常に透過を保持するため）
 */
function encodeCanvas(sourceCanvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const ctx = canvas.getContext('2d');

    if (mimeType === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(sourceCanvas, 0, 0);

    canvas.toBlob((resultBlob) => {
      if (resultBlob) resolve(resultBlob);
      else reject(new Error('Canvas to Blob conversion failed.'));
    }, mimeType, quality);
  });
}

// ==== 手動補正エディター ====

function openEditor(index) {
  editingIndex = index;
  const item = items[index];

  editCanvas.width = item.masterCanvas.width;
  editCanvas.height = item.masterCanvas.height;
  editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
  editCtx.drawImage(item.masterCanvas, 0, 0);

  resetSnapshot = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);

  setEditMode('erase');
  editModal.style.display = 'flex';
}

function closeEditor() {
  editModal.style.display = 'none';
  editingIndex = null;
  resetSnapshot = null;
}

function setEditMode(mode) {
  editMode = mode;
  modeEraseBtn.classList.toggle('active', mode === 'erase');
  modeRestoreBtn.classList.toggle('active', mode === 'restore');
}

modeEraseBtn.addEventListener('click', () => setEditMode('erase'));
modeRestoreBtn.addEventListener('click', () => setEditMode('restore'));

editResetBtn.addEventListener('click', () => {
  if (!resetSnapshot) return;
  editCtx.putImageData(resetSnapshot, 0, 0);
});

editCancelBtn.addEventListener('click', closeEditor);

editSaveBtn.addEventListener('click', async () => {
  if (editingIndex === null) return;
  const item = items[editingIndex];

  // 編集結果をマスターCanvasに反映
  const ctx = item.masterCanvas.getContext('2d');
  ctx.clearRect(0, 0, item.masterCanvas.width, item.masterCanvas.height);
  ctx.drawImage(editCanvas, 0, 0);

  item.blob = await encodeCanvas(item.masterCanvas, item.mimeType, item.quality);
  renderPreviewCard(item, editingIndex);

  closeEditor();
});

// キャンバス上の座標（表示上の座標 → 実ピクセル座標に変換）
function getCanvasPos(evt) {
  const rect = editCanvas.getBoundingClientRect();
  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
  const scaleX = editCanvas.width / rect.width;
  const scaleY = editCanvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function paintAt(x, y) {
  const item = items[editingIndex];
  const radius = parseInt(brushSizeRange.value, 10);

  if (editMode === 'erase') {
    editCtx.save();
    editCtx.globalCompositeOperation = 'destination-out';
    editCtx.beginPath();
    editCtx.arc(x, y, radius, 0, Math.PI * 2);
    editCtx.fill();
    editCtx.restore();
  } else {
    // 戻す: 元画像Canvasの該当円形範囲だけをクリップして描画
    editCtx.save();
    editCtx.beginPath();
    editCtx.arc(x, y, radius, 0, Math.PI * 2);
    editCtx.closePath();
    editCtx.clip();
    editCtx.globalCompositeOperation = 'source-over';
    editCtx.drawImage(item.originalCanvas, 0, 0);
    editCtx.restore();
  }
}

function updateBrushCursor(evt) {
  const rect = editCanvas.getBoundingClientRect();
  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
  const displayScale = rect.width / editCanvas.width;
  const size = parseInt(brushSizeRange.value, 10) * 2 * displayScale;
  brushCursor.style.width = `${size}px`;
  brushCursor.style.height = `${size}px`;
  brushCursor.style.left = `${clientX}px`;
  brushCursor.style.top = `${clientY}px`;
}

function handlePointerDown(evt) {
  evt.preventDefault();
  isDrawing = true;
  const { x, y } = getCanvasPos(evt);
  paintAt(x, y);
  updateBrushCursor(evt);
}

function handlePointerMove(evt) {
  updateBrushCursor(evt);
  if (!isDrawing) return;
  evt.preventDefault();
  const { x, y } = getCanvasPos(evt);
  paintAt(x, y);
}

function handlePointerUp() {
  isDrawing = false;
}

editCanvas.addEventListener('mousedown', handlePointerDown);
editCanvas.addEventListener('mousemove', handlePointerMove);
window.addEventListener('mouseup', handlePointerUp);
editCanvas.addEventListener('mouseenter', () => { brushCursor.style.display = 'block'; });
editCanvas.addEventListener('mouseleave', () => { brushCursor.style.display = 'none'; });

editCanvas.addEventListener('touchstart', handlePointerDown, { passive: false });
editCanvas.addEventListener('touchmove', handlePointerMove, { passive: false });
window.addEventListener('touchend', handlePointerUp);

// 一括ZIPダウンロード
downloadAllBtn.addEventListener('click', async () => {
  if (items.length === 0) return;

  downloadAllBtn.disabled = true;
  downloadAllBtn.textContent = 'ZIPファイル作成中...';

  const zip = new JSZip();
  items.forEach(item => {
    zip.file(item.name, item.blob);
  });

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const zipUrl = URL.createObjectURL(zipBlob);

  const a = document.createElement('a');
  a.href = zipUrl;
  a.download = `optimized_no_bg_${Date.now()}.zip`;
  a.click();

  downloadAllBtn.disabled = false;
  downloadAllBtn.textContent = '一括ZIPダウンロード (.zip)';
});
