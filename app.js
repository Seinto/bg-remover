import { removeBackground } from 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.3.0/dist/browser.mjs';

// Service Worker の登録
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
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

let processedBlobs = [];

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
  processedBlobs = [];
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

      // 2. Canvasを使ってリサイズおよび品質・フォーマット変換
      const optimizedBlob = await processImageCanvas(rawNoBgBlob, maxWidth, mimeType, quality);
      const outputFileName = `no-bg_${file.name.replace(/\.[^/.]+$/, "")}.${extension}`;

      processedBlobs.push({ name: outputFileName, blob: optimizedBlob });

      // 3. UIにプレビュー表示
      const url = URL.createObjectURL(optimizedBlob);
      const sizeKB = (optimizedBlob.size / 1024).toFixed(1);
      
      const card = document.createElement('div');
      card.className = 'preview-card';
      card.innerHTML = `
        <img src="${url}" alt="${outputFileName}">
        <div class="file-size">${sizeKB} KB (${extension.toUpperCase()})</div>
        <a href="${url}" download="${outputFileName}">保存</a>
      `;
      outputDiv.appendChild(card);

    } catch (error) {
      console.error(`エラー (${file.name}):`, error);
    }
  }

  statusDiv.textContent = `すべての処理が完了しました！（計 ${processedBlobs.length} 件）`;
  if (processedBlobs.length > 0) {
    downloadAllBtn.style.display = 'block';
  }
}

/**
 * Canvasを使用して画像のリサイズ、フォーマット変換、品質圧縮を行う関数
 */
function processImageCanvas(blob, maxWidth, mimeType, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // リサイズ計算（アスペクト比固定）
      if (maxWidth && width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');

      // JPEGの場合は背景を白で塗りつぶす（透過維持できないため）
      if (mimeType === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Canvasから指定フォーマット・品質のBlobを生成
      canvas.toBlob((resultBlob) => {
        if (resultBlob) {
          resolve(resultBlob);
        } else {
          reject(new Error('Canvas to Blob conversion failed.'));
        }
      }, mimeType, quality);
    };

    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// 一括ZIPダウンロード
downloadAllBtn.addEventListener('click', async () => {
  if (processedBlobs.length === 0) return;

  downloadAllBtn.disabled = true;
  downloadAllBtn.textContent = 'ZIPファイル作成中...';

  const zip = new JSZip();
  processedBlobs.forEach(item => {
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
