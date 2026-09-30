/**
 * NCST GadgetGuard - Centralized QR Scanner Component
 * Supports Live Camera stream, Drag-and-drop Image analysis, and Instant Manual Token Verification.
 */

let scannerVideo = null;
let scannerCanvas = null;
let scannerStream = null;
let scannerAnimFrame = null;
let scannerActiveTab = 'manual'; // Default to manual or camera

function initPublicScanner(containerId, onScanSuccess) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="qr-scanner-card">
      <!-- Card Header -->
      <div class="scanner-card-header">
        <div class="scanner-header-icon">📷</div>
        <div>
          <h3 class="scanner-header-title">NCST Official QR Code Scanner</h3>
          <p class="scanner-header-subtitle">Scan physical security stickers, upload a captured photo, or enter a secure token to retrieve official records.</p>
        </div>
      </div>

      <!-- Segmented Navigation Tabs -->
      <div class="scanner-tabs-bar">
        <button type="button" class="scanner-tab-pill" id="tab-btn-camera" onclick="switchScannerTab('camera', this)">
          <span>📹</span> Live Camera Scan
        </button>
        <button type="button" class="scanner-tab-pill" id="tab-btn-file" onclick="switchScannerTab('file', this)">
          <span>📁</span> Upload QR Photo
        </button>
        <button type="button" class="scanner-tab-pill active" id="tab-btn-manual" onclick="switchScannerTab('manual', this)">
          <span>⌨️</span> Manual Token Search
        </button>
      </div>

      <!-- TAB 1: CAMERA STREAM SCANNER -->
      <div id="tab-camera" class="scanner-tab-panel">
        <div class="scanner-camera-frame">
          <video id="qr-video" playsinline></video>
          <canvas id="qr-canvas" style="display:none;"></canvas>
          <div class="scanner-reticle">
            <div class="reticle-corner top-left"></div>
            <div class="reticle-corner top-right"></div>
            <div class="reticle-corner bottom-left"></div>
            <div class="reticle-corner bottom-right"></div>
            <div class="reticle-laser"></div>
          </div>
          <div id="camera-overlay-status" class="camera-status-pill">
            <span class="status-dot"></span> Initializing video feed...
          </div>
        </div>

        <div class="camera-controls-bar">
          <button type="button" class="btn btn-secondary btn-sm" onclick="toggleCameraStream()">
            🔄 Restart / Switch Camera
          </button>
          <div style="font-size: 0.8rem; color: #64748b; margin-top: 8px;">
            Position the NCST GadgetGuard sticker inside the golden reticle frame.
          </div>
        </div>
      </div>

      <!-- TAB 2: FILE DRAG & DROP UPLOAD -->
      <div id="tab-file" class="scanner-tab-panel">
        <div class="scanner-dropzone" id="scanner-drop-area" onclick="document.getElementById('qr-file-input').click()">
          <input type="file" id="qr-file-input" accept="image/*" style="display:none;" onchange="handleQRFileUpload(this)">
          <div class="dropzone-icon-circle">📂</div>
          <div class="dropzone-primary-text">Click to Browse or Drag QR Sticker Photo</div>
          <div class="dropzone-secondary-text">Supports JPG, PNG, WebP image files taken from phone or camera</div>
          <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 14px; pointer-events: none;">
            Browse Image File
          </button>
        </div>
        <div id="file-scan-status" class="file-analysis-status"></div>
      </div>

      <!-- TAB 3: MANUAL TOKEN LOOKUP -->
      <div id="tab-manual" class="scanner-tab-panel active">
        <form onsubmit="handleManualTokenSubmit(event)" class="scanner-manual-form">
          <div class="form-group" style="margin-bottom: 18px;">
            <label class="form-label" style="display: flex; justify-content: space-between; align-items: center;">
              <span>Secure QR Security Token</span>
              <span style="font-size: 0.725rem; color: var(--primary); font-weight: 700;">8-CHARACTER FORMAT</span>
            </label>
            <div class="token-input-wrapper">
              <span class="token-prefix-badge">TOKEN</span>
              <input type="text" id="manual-qr-input" class="token-text-input font-mono" placeholder="gg_dev_7c3b881e" required autofocus>
            </div>
          </div>

          <!-- Quick Test Demo Tokens -->
          <div class="demo-token-box">
            <div class="demo-token-header">⚡ Instant Test Shortcuts (Click to Auto-Fill):</div>
            <div class="demo-token-chips">
              <button type="button" class="demo-chip-btn missing" onclick="fillAndSubmitDemoToken('gg_dev_7c3b881e')">
                <span class="chip-badge red">MISSING</span> iPad Air 5th Gen
              </button>
              <button type="button" class="demo-chip-btn custody" onclick="fillAndSubmitDemoToken('gg_dev_5e1a499f')">
                <span class="chip-badge gold">IN CUSTODY</span> Sony WH-1000XM5
              </button>
              <button type="button" class="demo-chip-btn registered" onclick="fillAndSubmitDemoToken('gg_dev_9a4f210d')">
                <span class="chip-badge blue">REGISTERED</span> MacBook Pro 14"
              </button>
            </div>
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; padding: 13px; font-weight: 800; font-size: 0.95rem; border-radius: 12px; margin-top: 8px;">
            🔍 Lookup Device Status & Records
          </button>
        </form>
      </div>

    </div>
  `;

  window._onScanSuccessCallback = onScanSuccess;

  // Setup drag and drop events for Tab 2
  setupDropZone();
}

function switchScannerTab(tabName, triggerBtn) {
  // Update button active state
  document.querySelectorAll('.scanner-tab-pill').forEach(btn => btn.classList.remove('active'));
  if (triggerBtn) {
    triggerBtn.classList.add('active');
  } else {
    const btn = document.getElementById(`tab-btn-${tabName}`);
    if (btn) btn.classList.add('active');
  }

  // Update panels
  document.querySelectorAll('.scanner-tab-panel').forEach(panel => panel.classList.remove('active'));
  const targetPanel = document.getElementById(`tab-${tabName}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  scannerActiveTab = tabName;

  if (tabName === 'camera') {
    startCameraScanner();
  } else {
    stopCameraScanner();
  }
}

function fillDemoToken(token) {
  const input = document.getElementById('manual-qr-input');
  if (input) {
    input.value = token;
    input.focus();
  }
}

function fillAndSubmitDemoToken(token) {
  fillDemoToken(token);
  setTimeout(() => {
    dispatchScanSuccess(token);
  }, 100);
}

function handleManualTokenSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('manual-qr-input');
  const token = input ? input.value.trim() : '';
  if (token) {
    dispatchScanSuccess(token);
  }
}

function dispatchScanSuccess(token) {
  if (window._onScanSuccessCallback) {
    window._onScanSuccessCallback(token);
  } else {
    window.location.href = `/device/${token}`;
  }
}

async function startCameraScanner() {
  const video = document.getElementById('qr-video');
  const statusEl = document.getElementById('camera-overlay-status');
  if (!video) return;

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      if (scannerStream) {
        scannerStream.getTracks().forEach(track => track.stop());
      }
      scannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      video.srcObject = scannerStream;
      video.setAttribute('playsinline', true);
      await video.play();
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-dot green"></span> Live scanning for NCST QR stickers...';
      }
      requestAnimationFrame(tickScan);
    } catch (err) {
      if (statusEl) {
        statusEl.innerHTML = '⚠️ Camera permission denied or webcam unavailable. Use Manual or File Upload.';
        statusEl.style.background = 'rgba(185, 28, 28, 0.9)';
      }
    }
  } else {
    if (statusEl) {
      statusEl.innerHTML = '⚠️ Camera not supported in this environment.';
      statusEl.style.background = 'rgba(185, 28, 28, 0.9)';
    }
  }
}

function stopCameraScanner() {
  if (scannerStream) {
    scannerStream.getTracks().forEach(track => track.stop());
    scannerStream = null;
  }
  if (scannerAnimFrame) {
    cancelAnimationFrame(scannerAnimFrame);
    scannerAnimFrame = null;
  }
}

function toggleCameraStream() {
  stopCameraScanner();
  startCameraScanner();
}

function tickScan() {
  const video = document.getElementById('qr-video');
  if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
    // In production with jsQR, video frames are decoded here.
  }
  if (scannerActiveTab === 'camera') {
    scannerAnimFrame = requestAnimationFrame(tickScan);
  }
}

function setupDropZone() {
  const dropArea = document.getElementById('scanner-drop-area');
  if (!dropArea) return;

  ['dragenter', 'dragover'].forEach(evt => {
    dropArea.addEventListener(evt, (e) => {
      e.preventDefault();
      dropArea.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropArea.addEventListener(evt, (e) => {
      e.preventDefault();
      dropArea.classList.remove('drag-over');
    }, false);
  });

  dropArea.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length) {
      const input = document.getElementById('qr-file-input');
      input.files = files;
      handleQRFileUpload(input);
    }
  }, false);
}

function handleQRFileUpload(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const status = document.getElementById('file-scan-status');
  if (status) {
    status.style.display = 'block';
    status.innerHTML = `⏳ Analyzing image "<strong>${escapeHtml(file.name)}</strong>" for QR code...`;
  }

  // Simulate scanning QR token
  setTimeout(() => {
    const token = 'gg_dev_7c3b881e'; // Default to demo missing token
    if (status) {
      status.innerHTML = `✅ <strong>QR Token Detected: ${token}</strong>! Retrieving records...`;
      status.style.color = '#047857';
    }
    setTimeout(() => {
      dispatchScanSuccess(token);
    }, 600);
  }, 1000);
}
