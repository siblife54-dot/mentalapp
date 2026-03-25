(() => {
  'use strict';

  const SYMPTOMS = [
    { key: 'anxiety', label: 'Тревога' },
    { key: 'lowInterest', label: 'Снижение интереса / пустота' },
    { key: 'innerTension', label: 'Внутреннее напряжение' },
    { key: 'rumination', label: 'Руминация' },
    { key: 'derealization', label: 'Дереализация' }
  ];

  const METRICS = {
    total: 'Общий индекс',
    anxiety: 'Тревога',
    lowInterest: 'Снижение интереса',
    innerTension: 'Внутреннее напряжение',
    rumination: 'Руминация',
    derealization: 'Дереализация'
  };

  const state = {
    records: [],
    todayDraft: null,
    chart: null,
    activeTab: 'today',
    period: '7',
    metric: 'total'
  };

  const tg = window.Telegram?.WebApp;

  const ui = {
    greeting: document.getElementById('greeting'),
    todayDate: document.getElementById('todayDate'),
    debugPanel: document.getElementById('debugPanel'),
    debugText: document.getElementById('debugText'),
    screens: {
      today: document.getElementById('screen-today'),
      history: document.getElementById('screen-history'),
      analytics: document.getElementById('screen-analytics')
    },
    tabs: [...document.querySelectorAll('.tab')],
    dialog: document.getElementById('entryDialog')
  };

  window.addEventListener('error', (event) => {
    showDebugError('Global error', event.error || event.message || 'Unknown global error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    showDebugError('Unhandled promise rejection', event.reason || 'Unknown rejection');
  });

  initApp();

  async function initApp() {
    try {
      initTelegram();
      paintGreeting();
      bindTabs();
      await loadData();
      ensureTodayDraft();
      renderApp();
      await trySyncPending();
    } catch (error) {
      console.error('[initApp] Fatal init error:', error);
      showDebugError('Ошибка инициализации', error);
      safeFallbackRender();
    }
  }

  function initTelegram() {
    try {
      if (!tg) return;
      tg.ready();
      tg.expand();
    } catch (error) {
      console.error('[initTelegram] Telegram init failed:', error);
      showDebugError('initTelegram()', error);
    }
  }

  function paintGreeting() {
    const firstName = tg?.initDataUnsafe?.user?.first_name;
    ui.greeting.textContent = firstName ? `Привет, ${firstName}` : 'Привет';
    ui.todayDate.textContent = formatDate(todayStr());
  }

  function bindTabs() {
    ui.tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.tab;
        ui.tabs.forEach((x) => x.classList.toggle('active', x === btn));

        Object.entries(ui.screens).forEach(([name, screen]) => {
          screen.classList.toggle('active', name === state.activeTab);
        });

        if (state.activeTab === 'analytics') renderAnalytics();
      });
    });
  }

  async function loadData() {
    try {
      const cloudRecords = await storage.getCloudRecords();
      const localRecords = storage.getLocalRecords();
      const merged = mergeRecords(cloudRecords, localRecords);
      state.records = merged.sort((a, b) => b.date.localeCompare(a.date));
      storage.saveLocalRecords(state.records);
    } catch (error) {
      console.error('[loadData] Data load failed:', error);
      showDebugError('loadData()', error);
      state.records = storage.getLocalRecords().sort((a, b) => b.date.localeCompare(a.date));
    }
  }

  async function trySyncPending() {
    try {
      const pendingDates = storage.getPendingDates();
      if (!pendingDates.length) return;
      const toSync = state.records.filter((r) => pendingDates.includes(r.date));
      if (!toSync.length) return;
      const ok = await storage.writeCloudBatch(toSync);
      if (ok) storage.clearPendingDates(pendingDates);
    } catch (error) {
      console.error('[trySyncPending] Pending sync failed:', error);
      showDebugError('trySyncPending()', error);
    }
  }

  function ensureTodayDraft() {
    const existing = state.records.find((record) => record.date === todayStr());
    state.todayDraft = existing ? { ...existing } : makeEmptyEntry(todayStr());
  }

  function renderApp() {
    try {
      renderToday();
      renderHistory();
      renderAnalytics();
    } catch (error) {
      console.error('[renderApp] Render failed:', error);
      showDebugError('renderApp()', error);
      safeFallbackRender();
    }
  }

  function safeFallbackRender() {
    if (!state.todayDraft) state.todayDraft = makeEmptyEntry(todayStr());
    if (!Array.isArray(state.records)) state.records = [];
    try {
      renderToday();
    } catch (error) {
      console.error('[safeFallbackRender] renderToday failed:', error);
    }
    try {
      renderHistory();
    } catch (error) {
      console.error('[safeFallbackRender] renderHistory failed:', error);
    }
    try {
      renderAnalytics();
    } catch (error) {
      console.error('[safeFallbackRender] renderAnalytics failed:', error);
    }
  }

  function renderToday() {
    try {
      const root = ui.screens.today;
      const draft = state.todayDraft || makeEmptyEntry(todayStr());

      const symptomCards = SYMPTOMS.map((symptom) => {
        const value = Number(draft[symptom.key] || 0);
        return `
          <article class="slider-card">
            <div class="slider-head">
              <h3>${symptom.label}</h3>
              <span class="slider-value" id="value-${symptom.key}">${value}</span>
            </div>
            <input type="range" min="0" max="10" value="${value}" data-symptom="${symptom.key}" />
            <p class="level" id="level-${symptom.key}">${levelText(value)}</p>
          </article>
        `;
      }).join('');

      root.innerHTML = `
        <section class="section-card">
          <h2>Сегодня</h2>
          <p class="muted" style="margin-top:4px">${formatDate(draft.date)}</p>
        </section>

        <section class="section-card" style="display:grid; gap:10px">${symptomCards}</section>

        <section class="section-card index-box">
          <div>
            <p class="muted">Индекс дня</p>
            <div class="big-number" id="totalValue">${draft.total}</div>
          </div>
          <span class="zone-pill ${draft.zone}" id="zonePill">${zoneLabel(draft.zone)}</span>
        </section>

        <section class="section-card" style="display:grid; gap:10px">
          <label for="noteInput"><h3>Заметка</h3></label>
          <textarea id="noteInput" placeholder="Что было важно сегодня?">${escapeHtml(draft.note || '')}</textarea>
          <button class="primary" id="saveBtn">Сохранить</button>
          <p class="status" id="saveStatus">Готово к сохранению</p>
        </section>
      `;

      root.querySelectorAll('input[type="range"]').forEach((range) => {
        range.addEventListener('input', (event) => {
          const key = event.target.dataset.symptom;
          state.todayDraft[key] = Number(event.target.value);
          const total = computeTotal(state.todayDraft);
          state.todayDraft.total = total;
          state.todayDraft.zone = getZone(total);

          root.querySelector(`#value-${key}`).textContent = String(state.todayDraft[key]);
          root.querySelector(`#level-${key}`).textContent = levelText(state.todayDraft[key]);
          root.querySelector('#totalValue').textContent = String(total);

          const pill = root.querySelector('#zonePill');
          pill.textContent = zoneLabel(state.todayDraft.zone);
          pill.className = `zone-pill ${state.todayDraft.zone}`;
        });
      });

      root.querySelector('#noteInput').addEventListener('input', (event) => {
        state.todayDraft.note = event.target.value.trim();
      });

      root.querySelector('#saveBtn').addEventListener('click', saveTodayEntry);
    } catch (error) {
      console.error('[renderToday] Render today failed:', error);
      showDebugError('renderToday()', error);
      ui.screens.today.innerHTML = '<section class="section-card empty">Не удалось отрисовать экран «Сегодня».</section>';
    }
  }

  async function saveTodayEntry() {
    const statusEl = ui.screens.today.querySelector('#saveStatus');

    try {
      const draft = normalizeEntry(state.todayDraft);
      const idx = state.records.findIndex((x) => x.date === draft.date);
      if (idx >= 0) state.records[idx] = draft;
      else state.records.push(draft);

      state.records.sort((a, b) => b.date.localeCompare(a.date));
      storage.saveLocalRecords(state.records);

      const cloudOk = await storage.writeCloudBatch([draft]);
      if (cloudOk) {
        storage.clearPendingDates([draft.date]);
        statusEl.textContent = 'Сохранено в Telegram CloudStorage';
      } else {
        storage.markPendingDate(draft.date);
        statusEl.textContent = 'Сохранено локально (ожидает синхронизации)';
      }

      ensureTodayDraft();
      renderHistory();
      renderAnalytics();
    } catch (error) {
      console.error('[saveTodayEntry] Save failed:', error);
      showDebugError('saveTodayEntry()', error);
      if (statusEl) statusEl.textContent = 'Ошибка сохранения';
    }
  }

  function renderHistory() {
    try {
      const root = ui.screens.history;
      if (!state.records.length) {
        root.innerHTML = '<section class="section-card empty">Пока нет записей. Начните с вкладки «Сегодня».</section>';
        return;
      }

      root.innerHTML = state.records.map((entry) => `
        <article class="section-card history-item" data-date="${entry.date}">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <h3>${formatDate(entry.date)}</h3>
            <span class="zone-pill ${entry.zone}">${entry.total} • ${zoneLabel(entry.zone)}</span>
          </div>
          ${entry.note ? `<p class="muted">${escapeHtml(entry.note)}</p>` : '<p class="muted">Без заметки</p>'}
        </article>
      `).join('');

      root.querySelectorAll('.history-item').forEach((item) => {
        item.addEventListener('click', () => openEntryDialog(item.dataset.date));
      });
    } catch (error) {
      console.error('[renderHistory] Render history failed:', error);
      showDebugError('renderHistory()', error);
      ui.screens.history.innerHTML = '<section class="section-card empty">Не удалось отрисовать историю.</section>';
    }
  }

  function openEntryDialog(date) {
    const entry = state.records.find((x) => x.date === date);
    if (!entry) return;

    ui.dialog.innerHTML = `
      <div class="entry-body">
        <h3>${formatDate(entry.date)}</h3>
        <p class="muted" style="margin-top:4px">Индекс ${entry.total} — ${zoneLabel(entry.zone)}</p>
        <div style="display:grid; gap:8px; margin-top:14px;">
          ${SYMPTOMS.map((s) => `<p>${s.label}: <strong>${entry[s.key]}</strong></p>`).join('')}
        </div>
        <p style="margin-top:12px; white-space:pre-wrap">${escapeHtml(entry.note || 'Без заметки')}</p>
        <button class="primary" id="closeDialog" style="margin-top:14px; width:100%">Закрыть</button>
      </div>
    `;

    ui.dialog.showModal();
    ui.dialog.querySelector('#closeDialog').addEventListener('click', () => ui.dialog.close());
  }

  function renderAnalytics() {
    try {
      const root = ui.screens.analytics;
      if (!state.records.length) {
        root.innerHTML = '<section class="section-card empty">Недостаточно данных для аналитики.</section>';
        return;
      }

      const today = state.records.find((x) => x.date === todayStr());
      const avg7 = averageForPeriod(7, 'total');
      const yesterday = state.records.find((x) => x.date === shiftDate(todayStr(), -1));
      const delta = today && yesterday ? today.total - yesterday.total : null;

      root.innerHTML = `
        <section class="section-card">
          <div class="metrics-grid">
            <article class="metric-card">
              <p class="metric-title">Сегодня</p>
              <p class="metric-value">${today ? today.total : '—'}</p>
            </article>
            <article class="metric-card">
              <p class="metric-title">Среднее 7 дней</p>
              <p class="metric-value">${Number.isFinite(avg7) ? avg7.toFixed(1) : '—'}</p>
            </article>
            <article class="metric-card">
              <p class="metric-title">Изменение к вчера</p>
              <p class="metric-value">${delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}</p>
            </article>
          </div>
        </section>

        <section class="section-card" style="display:grid; gap:12px;">
          <div>
            <p class="muted">Период</p>
            <div class="controls">
              ${['7', '30', 'all'].map((p) => `<button class="chip ${state.period === p ? 'active' : ''}" data-period="${p}">${p === 'all' ? 'Всё' : p + ' дней'}</button>`).join('')}
            </div>
          </div>
          <div>
            <p class="muted">Метрика</p>
            <div class="controls">
              ${Object.entries(METRICS).map(([key, label]) => `<button class="chip ${state.metric === key ? 'active' : ''}" data-metric="${key}">${label}</button>`).join('')}
            </div>
          </div>
          <canvas id="analyticsChart" height="130"></canvas>
        </section>
      `;

      root.querySelectorAll('[data-period]').forEach((el) => {
        el.addEventListener('click', () => {
          state.period = el.dataset.period;
          renderAnalytics();
        });
      });

      root.querySelectorAll('[data-metric]').forEach((el) => {
        el.addEventListener('click', () => {
          state.metric = el.dataset.metric;
          renderAnalytics();
        });
      });

      drawChart(root.querySelector('#analyticsChart'));
    } catch (error) {
      console.error('[renderAnalytics] Render analytics failed:', error);
      showDebugError('renderAnalytics()', error);
      ui.screens.analytics.innerHTML = '<section class="section-card empty">Не удалось отрисовать аналитику.</section>';
    }
  }

  function drawChart(canvas) {
    if (!canvas || typeof window.Chart === 'undefined') return;

    const points = getRecordsForPeriod(state.period).sort((a, b) => a.date.localeCompare(b.date));
    const labels = points.map((x) => x.date.slice(5));
    const values = points.map((x) => x[state.metric]);

    if (state.chart) state.chart.destroy();

    state.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: METRICS[state.metric],
          data: values,
          borderColor: '#0a84ff',
          pointRadius: 3,
          borderWidth: 2.5,
          tension: 0.35,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(148, 163, 184, 0.15)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  const storage = {
    async getCloudRecords() {
      if (!tg?.CloudStorage) return [];
      try {
        const indexRaw = await cloudGet('tracker_index');
        const months = safeParse(indexRaw, []);
        const keys = months.length ? months : [monthKey(todayStr())];

        const payloads = [];
        for (const key of keys) {
          const raw = await cloudGet(key);
          payloads.push(raw);
        }

        return payloads.flatMap((raw) => safeParse(raw, []));
      } catch (error) {
        console.error('[storage.getCloudRecords] Cloud read failed:', error);
        return [];
      }
    },

    async writeCloudBatch(entries) {
      if (!tg?.CloudStorage) return false;
      try {
        const grouped = groupBy(entries, (x) => monthKey(x.date));
        const currentCloud = await this.getCloudRecords();
        const byMonthCloud = groupBy(currentCloud, (x) => monthKey(x.date));

        for (const [key, list] of Object.entries(grouped)) {
          const merged = mergeRecords(byMonthCloud[key] || [], list);
          await cloudSet(key, JSON.stringify(merged));
        }

        const existingMonths = safeParse(await cloudGet('tracker_index'), []);
        const monthSet = new Set([...existingMonths, ...Object.keys(grouped)]);
        await cloudSet('tracker_index', JSON.stringify([...monthSet].sort()));
        return true;
      } catch (error) {
        console.error('[storage.writeCloudBatch] Cloud write failed:', error);
        return false;
      }
    },

    getLocalRecords() {
      try {
        return safeParse(localStorage.getItem('tracker_records_v1'), []);
      } catch (error) {
        console.error('[storage.getLocalRecords] localStorage read failed:', error);
        return [];
      }
    },

    saveLocalRecords(records) {
      try {
        localStorage.setItem('tracker_records_v1', JSON.stringify(records));
      } catch (error) {
        console.error('[storage.saveLocalRecords] localStorage write failed:', error);
      }
    },

    getPendingDates() {
      try {
        return safeParse(localStorage.getItem('tracker_pending_sync_v1'), []);
      } catch (error) {
        console.error('[storage.getPendingDates] localStorage read failed:', error);
        return [];
      }
    },

    markPendingDate(date) {
      try {
        const set = new Set(this.getPendingDates());
        set.add(date);
        localStorage.setItem('tracker_pending_sync_v1', JSON.stringify([...set]));
      } catch (error) {
        console.error('[storage.markPendingDate] localStorage write failed:', error);
      }
    },

    clearPendingDates(dates) {
      try {
        const set = new Set(this.getPendingDates());
        dates.forEach((d) => set.delete(d));
        localStorage.setItem('tracker_pending_sync_v1', JSON.stringify([...set]));
      } catch (error) {
        console.error('[storage.clearPendingDates] localStorage write failed:', error);
      }
    }
  };

  function cloudGet(key) {
    return new Promise((resolve) => {
      try {
        tg.CloudStorage.getItem(key, (error, value) => {
          if (error) {
            console.error('[cloudGet] CloudStorage getItem error:', error);
            resolve('');
            return;
          }
          resolve(value || '');
        });
      } catch (error) {
        console.error('[cloudGet] CloudStorage getItem throw:', error);
        resolve('');
      }
    });
  }

  function cloudSet(key, value) {
    return new Promise((resolve, reject) => {
      try {
        tg.CloudStorage.setItem(key, value, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(true);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function makeEmptyEntry(date) {
    return normalizeEntry({ date, note: '' });
  }

  function normalizeEntry(entry) {
    const clean = { ...entry };
    SYMPTOMS.forEach((s) => {
      clean[s.key] = clamp(Number(clean[s.key] || 0), 0, 10);
    });
    clean.note = (clean.note || '').trim();
    clean.total = computeTotal(clean);
    clean.zone = getZone(clean.total);
    clean.updatedAt = new Date().toISOString();
    return clean;
  }

  function computeTotal(entry) {
    return SYMPTOMS.reduce((sum, s) => sum + Number(entry[s.key] || 0), 0);
  }

  function getZone(total) {
    if (total <= 15) return 'good';
    if (total <= 30) return 'medium';
    return 'bad';
  }

  function zoneLabel(zone) {
    return zone === 'good' ? 'Хорошо' : zone === 'medium' ? 'Средне' : 'Тяжело';
  }

  function levelText(value) {
    if (value <= 2) return 'Слабо';
    if (value <= 4) return 'Умеренно';
    if (value <= 6) return 'Заметно';
    if (value <= 8) return 'Сильно';
    return 'Очень сильно';
  }

  function averageForPeriod(days, metric) {
    const set = getRecordsForPeriod(String(days));
    if (!set.length) return NaN;
    return set.reduce((sum, x) => sum + Number(x[metric] || 0), 0) / set.length;
  }

  function getRecordsForPeriod(period) {
    if (period === 'all') return [...state.records];
    const days = Number(period);
    const cutoff = shiftDate(todayStr(), -(days - 1));
    return state.records.filter((x) => x.date >= cutoff && x.date <= todayStr());
  }

  function mergeRecords(primary, secondary) {
    const byDate = new Map();
    [...primary, ...secondary].forEach((entry) => {
      if (!entry?.date) return;
      const old = byDate.get(entry.date);
      if (!old || (entry.updatedAt || '') > (old.updatedAt || '')) {
        byDate.set(entry.date, normalizeEntry(entry));
      }
    });
    return [...byDate.values()];
  }

  function groupBy(items, keyFn) {
    return items.reduce((acc, item) => {
      const key = keyFn(item);
      (acc[key] ||= []).push(item);
      return acc;
    }, {});
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function shiftDate(dateStr, deltaDays) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
  }

  function monthKey(dateStr) {
    const [y, m] = dateStr.split('-');
    return `tracker_${y}_${m}`;
  }

  function formatDate(iso) {
    const date = new Date(`${iso}T00:00:00`);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : parsed;
    } catch {
      return fallback;
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function showDebugError(label, error) {
    if (!ui.debugPanel || !ui.debugText) return;
    const text = `${label}: ${error?.message || String(error)}`;
    ui.debugText.textContent = text;
    ui.debugPanel.hidden = false;
  }
})();
