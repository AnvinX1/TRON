/**
 * TRON — Main Application Controller
 * Wires up UI, document processing, pattern analysis, and predictions.
 */
import './style.css';
import { processDocument, detectFileType } from './src/documentProcessor.js';
import {
  extractQuestions, extractTopics, classifyQuestion,
  estimateDifficulty, analyzePatterns, generatePredictions,
} from './src/patternEngine.js';
import {
  renderTopicFrequencyChart, renderQuestionTypesChart,
  renderDifficultyChart, renderTimelineChart, renderCorrelationMatrix,
} from './src/chartRenderer.js';

// ─── State ────────────────────────────────────────────────────
const state = {
  documents: [],   // { fileName, fileType, fileSize, extractedText, pages, pageCount, questions, topics, processedAt }
  patterns: null,
  predictions: [],
};

// ─── DOM References ───────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const navButtons = $$('.nav-btn');
const views = $$('.view');
const uploadZone = $('#upload-zone');
const fileInput = $('#file-input');
const processingQueue = $('#processing-queue');
const queueList = $('#queue-list');
const docCountEl = $('#doc-count');
const documentsGrid = $('#documents-grid');
const docsEmpty = $('#docs-empty');
const docSearchInput = $('#doc-search');
const patternsEmpty = $('#patterns-empty');
const patternGrid = $('#pattern-grid');
const predictionsEmpty = $('#predictions-empty');
const predictionsList = $('#predictions-list');
const btnGenerate = $('#btn-generate-predictions');
const btnExport = $('#btn-export-predictions');
const docModal = $('#doc-modal');
const modalClose = $('#modal-close');
const toastContainer = $('#toast-container');

// ─── Navigation ───────────────────────────────────────────────
navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const viewId = btn.dataset.view;
    navButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    views.forEach(v => v.classList.remove('active'));
    $(`#view-${viewId}`).classList.add('active');
  });
});

// ─── Upload Zone ──────────────────────────────────────────────
uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = '';
});

// ─── File Processing ──────────────────────────────────────────
async function handleFiles(files) {
  if (!files.length) return;

  processingQueue.style.display = 'block';

  for (const file of files) {
    const fileType = detectFileType(file.name);
    if (fileType === 'unknown') {
      showToast(`Unsupported file: ${file.name}`, 'error');
      continue;
    }

    // Add to queue UI
    const queueItem = createQueueItem(file.name, fileType);
    queueList.appendChild(queueItem);

    try {
      // Process document
      const result = await processDocument(file, (status) => {
        updateQueueItem(queueItem, status);
      });

      // Extract questions and topics
      updateQueueItem(queueItem, 'Extracting questions...');
      const questions = extractQuestions(result.extractedText, result.fileName);
      const topics = extractTopics(result.extractedText);

      // Add to state
      const doc = {
        ...result,
        questions,
        topics,
      };
      state.documents.push(doc);

      // Mark done
      completeQueueItem(queueItem, questions.length);
      showToast(`Processed "${file.name}" — ${questions.length} questions found`, 'success');

    } catch (error) {
      failQueueItem(queueItem, error.message);
      showToast(`Failed: ${file.name} — ${error.message}`, 'error');
      console.error('Processing error:', error);
    }
  }

  // Update UI
  updateDocCount();
  renderDocumentsGrid();

  // Re-analyze patterns if we have enough docs
  if (state.documents.length >= 1) {
    state.patterns = analyzePatterns(state.documents);
    renderPatternsDashboard();
  }
}

// ─── Queue Item UI ────────────────────────────────────────────
function createQueueItem(name, type) {
  const div = document.createElement('div');
  div.className = 'queue-item';
  div.innerHTML = `
    <div class="queue-item-icon ${type}">${type.toUpperCase()}</div>
    <div class="queue-item-info">
      <div class="queue-item-name">${name}</div>
      <div class="queue-item-status">Initialising...</div>
    </div>
    <div class="queue-item-progress">
      <div class="queue-item-progress-bar" style="width: 10%"></div>
    </div>
  `;
  return div;
}

function updateQueueItem(el, status) {
  el.querySelector('.queue-item-status').textContent = status;
  const bar = el.querySelector('.queue-item-progress-bar');
  const current = parseInt(bar.style.width) || 10;
  bar.style.width = Math.min(current + 15, 85) + '%';
}

function completeQueueItem(el, questionCount) {
  el.classList.add('done');
  el.querySelector('.queue-item-status').textContent = `Done — ${questionCount} questions extracted`;
  el.querySelector('.queue-item-progress-bar').style.width = '100%';
}

function failQueueItem(el, message) {
  el.querySelector('.queue-item-status').textContent = `Error: ${message}`;
  el.querySelector('.queue-item-progress-bar').style.width = '100%';
  el.querySelector('.queue-item-progress-bar').style.background = 'var(--accent-red)';
}

// ─── Document Count ───────────────────────────────────────────
function updateDocCount() {
  docCountEl.textContent = state.documents.length;
}

// ─── Documents Grid ───────────────────────────────────────────
function renderDocumentsGrid() {
  if (state.documents.length === 0) {
    docsEmpty.style.display = 'flex';
    return;
  }
  docsEmpty.style.display = 'none';

  // Remove old cards
  documentsGrid.querySelectorAll('.doc-card').forEach(c => c.remove());

  const filtered = getFilteredDocs();

  for (const doc of filtered) {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.innerHTML = `
      <div class="doc-card-header">
        <div class="doc-card-type ${doc.fileType}">${doc.fileType.toUpperCase()}</div>
        <div class="doc-card-title">${doc.fileName}</div>
      </div>
      <div class="doc-card-excerpt">${doc.extractedText.substring(0, 150)}...</div>
      <div class="doc-card-stats">
        <div class="doc-stat">
          <span class="doc-stat-val">${doc.questions.length}</span> questions
        </div>
        <div class="doc-stat">
          <span class="doc-stat-val">${doc.topics.length}</span> topics
        </div>
        <div class="doc-stat">
          <span class="doc-stat-val">${doc.pageCount}</span> pages
        </div>
        <div class="doc-stat">
          <span class="doc-stat-val">${formatSize(doc.fileSize)}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => openDocModal(doc));
    documentsGrid.appendChild(card);
  }
}

function getFilteredDocs() {
  const query = docSearchInput?.value?.toLowerCase() || '';
  if (!query) return state.documents;
  return state.documents.filter(d =>
    d.fileName.toLowerCase().includes(query) ||
    d.extractedText.toLowerCase().includes(query)
  );
}

docSearchInput?.addEventListener('input', () => renderDocumentsGrid());

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

// ─── Document Modal ───────────────────────────────────────────
function openDocModal(doc) {
  docModal.style.display = '';

  $('#modal-doc-title').textContent = doc.fileName;
  $('#modal-doc-meta').innerHTML = `
    <span>${doc.fileType.toUpperCase()}</span>
    <span>${doc.pageCount} pages</span>
    <span>${formatSize(doc.fileSize)}</span>
    <span>${doc.questions.length} questions</span>
    <span>${new Date(doc.processedAt).toLocaleDateString()}</span>
  `;

  // Extracted text
  $('#tab-extracted-text').innerHTML = `<div class="extracted-text-block">${escapeHtml(doc.extractedText)}</div>`;

  // Questions
  let qHtml = '';
  if (doc.questions.length === 0) {
    qHtml = '<p style="color:var(--text-muted);padding:20px;">No questions detected in this document.</p>';
  } else {
    for (const q of doc.questions) {
      const type = classifyQuestion(q.text);
      const diff = estimateDifficulty(q);
      qHtml += `
        <div class="question-item">
          <div class="q-text">${q.number}. ${escapeHtml(q.text)}</div>
          <div class="q-meta">
            ${q.marks ? `<strong>${q.marks} marks</strong> · ` : ''}
            ${q.part ? q.part + ' · ' : ''}
            ${q.module ? q.module + ' · ' : ''}
            Type: ${type} · Difficulty: ${diff} ·
            <em>Line ${q.lineRef}</em>
          </div>
        </div>
      `;
    }
  }
  $('#tab-questions').innerHTML = qHtml;

  // Topics
  let tHtml = '';
  if (doc.topics.length === 0) {
    tHtml = '<p style="color:var(--text-muted);padding:20px;">No topics identified.</p>';
  } else {
    tHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 0;">';
    for (const t of doc.topics) {
      tHtml += `<div class="topic-chip">${t.topic}<span class="chip-count">${t.count}</span></div>`;
    }
    tHtml += '</div>';
  }
  $('#tab-topics').innerHTML = tHtml;

  // Tab switching
  const modalTabs = docModal.querySelectorAll('.modal-tab');
  const modalContents = docModal.querySelectorAll('.modal-tab-content');
  modalTabs.forEach(tab => {
    tab.onclick = () => {
      modalTabs.forEach(t => t.classList.remove('active'));
      modalContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      $(`#tab-${tab.dataset.tab}`).classList.add('active');
    };
  });

  // Reset to first tab
  modalTabs.forEach(t => t.classList.remove('active'));
  modalContents.forEach(c => c.classList.remove('active'));
  modalTabs[0].classList.add('active');
  modalContents[0].classList.add('active');
}

modalClose?.addEventListener('click', () => { docModal.style.display = 'none'; });
docModal?.addEventListener('click', (e) => {
  if (e.target === docModal) docModal.style.display = 'none';
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Patterns Dashboard ──────────────────────────────────────
function renderPatternsDashboard() {
  if (!state.patterns || state.documents.length === 0) {
    patternsEmpty.style.display = 'flex';
    patternGrid.style.display = 'none';
    return;
  }

  patternsEmpty.style.display = 'none';
  patternGrid.style.display = 'grid';

  const p = state.patterns;

  renderTopicFrequencyChart('chart-topic-freq', p.topicFrequency);
  renderQuestionTypesChart('chart-q-types', p.questionTypes);
  renderDifficultyChart('chart-difficulty', p.difficultyDistribution);
  renderTimelineChart('chart-timeline', state.documents, p.topicFrequency);
  renderCorrelationMatrix('correlation-matrix', p.topicCooccurrence, p.topicFrequency);
}

// ─── Predictions ──────────────────────────────────────────────
btnGenerate?.addEventListener('click', () => {
  if (state.documents.length === 0) {
    showToast('Upload documents first to generate predictions.', 'info');
    return;
  }

  if (!state.patterns) {
    state.patterns = analyzePatterns(state.documents);
  }

  state.predictions = generatePredictions(state.patterns, state.documents);
  renderPredictions();
  showToast(`Generated ${state.predictions.length} predicted questions.`, 'success');
});

function renderPredictions() {
  if (state.predictions.length === 0) {
    predictionsEmpty.style.display = 'flex';
    predictionsList.style.display = 'none';
    return;
  }

  predictionsEmpty.style.display = 'none';
  predictionsList.style.display = 'flex';
  predictionsList.innerHTML = '';

  for (const pred of state.predictions) {
    const card = document.createElement('div');
    card.className = 'prediction-card';
    card.innerHTML = `
      <div class="prediction-header">
        <div class="prediction-rank ${pred.priorityLevel}">#${pred.rank}</div>
        <div class="prediction-question">${escapeHtml(pred.question)}</div>
      </div>
      <div class="prediction-meta">
        <span class="prediction-tag topic">${pred.topic}</span>
        <span class="prediction-tag probability">${pred.probability}% likely</span>
        <span class="prediction-tag type">${pred.type}</span>
      </div>
      <div class="prediction-citations">
        <div class="citation-label">Source Citations</div>
        ${pred.citations.map(c => `
          <div class="citation-item">
            <span class="cite-doc">${c.document}</span>
            <span class="cite-page">Q${c.questionNum}${c.part ? ' · ' + c.part : ''}</span>
          </div>
        `).join('')}
        <div style="margin-top:6px;font-size:0.72rem;color:var(--text-muted);font-style:italic;">
          ${pred.reasoning}
        </div>
      </div>
    `;
    predictionsList.appendChild(card);
  }
}

// ─── Export ───────────────────────────────────────────────────
btnExport?.addEventListener('click', () => {
  if (state.predictions.length === 0) {
    showToast('Generate predictions first.', 'info');
    return;
  }

  let report = '═══════════════════════════════════════════\n';
  report += '  TRON — Predicted Questions Report\n';
  report += `  Generated: ${new Date().toLocaleString()}\n`;
  report += `  Documents Analysed: ${state.documents.length}\n`;
  report += `  Total Questions Found: ${state.patterns?.totalQuestions || 0}\n`;
  report += '═══════════════════════════════════════════\n\n';

  for (const pred of state.predictions) {
    report += `#${pred.rank} [${pred.probability}% likely] — ${pred.topic}\n`;
    report += `   ${pred.question}\n`;
    report += `   Type: ${pred.type} | Difficulty: ${pred.difficulty}\n`;
    report += '   Sources:\n';
    for (const c of pred.citations) {
      report += `     - ${c.document} (Q${c.questionNum}${c.part ? ', ' + c.part : ''})\n`;
    }
    report += `   Reasoning: ${pred.reasoning}\n\n`;
  }

  const blob = new Blob([report], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TRON_Predictions_${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Report downloaded!', 'success');
});

// ─── Toasts ───────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = {
    success: '✓', error: '✕', info: 'ℹ',
  };
  toast.innerHTML = `<span style="font-weight:700;font-size:1.1rem;">${icons[type] || 'ℹ'}</span> ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Init ─────────────────────────────────────────────────────
updateDocCount();
console.log('%c🔷 TRON Pattern Intelligence — Ready', 'color:#00f0ff;font-size:14px;font-weight:bold;');
