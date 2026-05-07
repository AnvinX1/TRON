/**
 * TRON — Chart Renderer
 * Renders all pattern analysis charts using Chart.js
 */
import Chart from 'chart.js/auto';

const CHART_COLORS = {
  cyan: 'rgba(0, 240, 255, 0.8)',
  cyanFaded: 'rgba(0, 240, 255, 0.15)',
  violet: 'rgba(139, 92, 246, 0.8)',
  violetFaded: 'rgba(139, 92, 246, 0.15)',
  pink: 'rgba(236, 72, 153, 0.8)',
  pinkFaded: 'rgba(236, 72, 153, 0.15)',
  emerald: 'rgba(16, 185, 129, 0.8)',
  emeraldFaded: 'rgba(16, 185, 129, 0.15)',
  amber: 'rgba(245, 158, 11, 0.8)',
  amberFaded: 'rgba(245, 158, 11, 0.15)',
  red: 'rgba(239, 68, 68, 0.8)',
  redFaded: 'rgba(239, 68, 68, 0.15)',
  blue: 'rgba(59, 130, 246, 0.8)',
  blueFaded: 'rgba(59, 130, 246, 0.15)',
};

const PALETTE = [
  CHART_COLORS.cyan, CHART_COLORS.violet, CHART_COLORS.pink,
  CHART_COLORS.emerald, CHART_COLORS.amber, CHART_COLORS.red,
  CHART_COLORS.blue,
];
const PALETTE_FADED = [
  CHART_COLORS.cyanFaded, CHART_COLORS.violetFaded, CHART_COLORS.pinkFaded,
  CHART_COLORS.emeraldFaded, CHART_COLORS.amberFaded, CHART_COLORS.redFaded,
  CHART_COLORS.blueFaded,
];

const chartDefaults = {
  color: '#8893a7',
  borderColor: 'rgba(56, 189, 248, 0.08)',
  font: { family: "'Inter', sans-serif" },
};

Chart.defaults.color = chartDefaults.color;
Chart.defaults.borderColor = chartDefaults.borderColor;
Chart.defaults.font.family = chartDefaults.font.family;

let charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

export function renderTopicFrequencyChart(canvasId, topicFrequency) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const labels = topicFrequency.slice(0, 15).map(t => t.topic);
  const data = topicFrequency.slice(0, 15).map(t => t.totalCount);
  const docCounts = topicFrequency.slice(0, 15).map(t => t.documentCount);

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Mentions',
          data,
          backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 1, borderRadius: 6, barPercentage: 0.7,
        },
        {
          label: 'Documents',
          data: docCounts,
          backgroundColor: labels.map((_, i) => PALETTE_FADED[i % PALETTE_FADED.length]),
          borderColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 1, borderRadius: 6, barPercentage: 0.7,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { padding: 16, usePointStyle: true } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
      },
    },
  });
}

export function renderQuestionTypesChart(canvasId, questionTypes) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: questionTypes.map(qt => qt.type),
      datasets: [{
        data: questionTypes.map(qt => qt.count),
        backgroundColor: questionTypes.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: '#0c1018', borderWidth: 3, hoverOffset: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: {
        legend: { position: 'right', labels: { padding: 12, usePointStyle: true, font: { size: 12 } } },
      },
    },
  });
}

export function renderDifficultyChart(canvasId, distribution) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const labels = ['Easy', 'Medium', 'Hard'];
  const data = labels.map(l => distribution[l] || 0);
  const colors = [CHART_COLORS.emerald, CHART_COLORS.amber, CHART_COLORS.red];
  const bgColors = [CHART_COLORS.emeraldFaded, CHART_COLORS.amberFaded, CHART_COLORS.redFaded];

  charts[canvasId] = new Chart(ctx, {
    type: 'polarArea',
    data: {
      labels,
      datasets: [{
        data, backgroundColor: bgColors, borderColor: colors, borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { padding: 12, usePointStyle: true } } },
      scales: { r: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { display: false } } },
    },
  });
}

export function renderTimelineChart(canvasId, documents, topicFrequency) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const topTopics = topicFrequency.slice(0, 6);
  const docNames = documents.map(d => d.fileName.replace(/\.[^.]+$/, '').substring(0, 30));

  const datasets = topTopics.map((topic, i) => {
    const data = documents.map(doc => {
      const count = doc.questions.filter(q =>
        q.text.toLowerCase().includes(topic.topic.toLowerCase().split(' ')[0])
      ).length;
      return count;
    });
    return {
      label: topic.topic,
      data,
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: PALETTE_FADED[i % PALETTE_FADED.length],
      fill: true, tension: 0.4, pointRadius: 4, pointHoverRadius: 7,
    };
  });

  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels: docNames, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { padding: 14, usePointStyle: true } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 30 } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' }, title: { display: true, text: 'Question Count' } },
      },
    },
  });
}

export function renderCorrelationMatrix(containerId, cooccurrence, topicFrequency) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const topics = topicFrequency.slice(0, 8).map(t => t.topic);
  if (topics.length < 2) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Not enough topics for correlation analysis.</p>';
    return;
  }

  // Build matrix
  const matrix = {};
  for (const t of topics) {
    matrix[t] = {};
    for (const t2 of topics) { matrix[t][t2] = t === t2 ? 1 : 0; }
  }
  for (const co of cooccurrence) {
    if (matrix[co.topicA]?.[co.topicB] !== undefined) {
      matrix[co.topicA][co.topicB] = co.count;
      matrix[co.topicB][co.topicA] = co.count;
    }
  }

  // Find max for normalization
  let maxVal = 1;
  for (const co of cooccurrence) { if (co.count > maxVal) maxVal = co.count; }

  let html = '<table class="corr-table"><tr><th></th>';
  for (const t of topics) html += `<th title="${t}">${t.substring(0, 12)}</th>`;
  html += '</tr>';

  for (const row of topics) {
    html += `<tr><th title="${row}">${row.substring(0, 12)}</th>`;
    for (const col of topics) {
      const val = matrix[row][col];
      const norm = row === col ? 1 : val / maxVal;
      const r = Math.round(0 + norm * 0);
      const g = Math.round(240 * norm);
      const b = Math.round(255 * norm);
      const alpha = 0.1 + norm * 0.6;
      html += `<td class="corr-cell" style="background:rgba(${r},${g},${b},${alpha})">${val}</td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  container.innerHTML = html;
}
