'use strict';

var RenderModel = (function () {
  var DEFAULT_POLL_COMMAND = 'aiqm poll --json';
  var DEFAULT_POLL_INTERVAL_SECONDS = 300;
  var DEFAULT_SETUP_COMMAND = 'aiqm-setup-terminal';
  var PROGRESS_TRACK_WIDTH_PX = 264;

  var knownStatuses = {
    fresh: true,
    stale: true,
    unavailable: true,
    auth_required: true,
    offline: true,
    provider_error: true,
    config_error: true
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function asString(value, fallback) {
    return typeof value === 'string' ? value : fallback;
  }

  function asNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function statusClass(status) {
    if (status === 'fresh') return 'aiqm-status-fresh';
    if (status === 'stale') return 'aiqm-status-stale';
    return 'aiqm-status-error';
  }

  function percentageClass(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'aiqm-quota-unknown';
    if (value >= 75) return 'aiqm-quota-critical';
    if (value >= 50) return 'aiqm-quota-warning';
    return 'aiqm-quota-ok';
  }

  function remainingPercentage(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, Math.round(100 - value)));
  }

  function progressFillClass(value) {
    var remaining = remainingPercentage(value);
    if (remaining === null) return 'aiqm-progress-fill-unknown';
    if (remaining <= 25) return 'aiqm-progress-fill-critical';
    if (remaining <= 50) return 'aiqm-progress-fill-warning';
    return 'aiqm-progress-fill-ok';
  }

  function progressFillWidth(value) {
    var remaining = remainingPercentage(value);
    return remaining === null ? 0 : remaining;
  }

  function progressFillPixels(value) {
    var remaining = remainingPercentage(value);
    if (remaining === null) return 1;
    return Math.max(1, Math.round((PROGRESS_TRACK_WIDTH_PX * remaining) / 100));
  }

  function progressFillColor(value) {
    var remaining = remainingPercentage(value);
    if (remaining === null) return '#9ca3af';
    if (remaining <= 25) return '#ef4444';
    if (remaining <= 50) return '#f7c948';
    return '#22c55e';
  }

  function remainingText(value) {
    var remaining = remainingPercentage(value);
    return remaining === null ? 'unknown remaining' : remaining + '% remaining';
  }

  function windowTitle(value) {
    var text = asString(value, 'Quota')
      .replace(/claude code/gi, '')
      .replace(/codex/gi, '')
      .replace(/limit/gi, 'usage limit');
    return text.replace(/\s+/g, ' ').trim() || 'Usage limit';
  }

  function resetText(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    return value.replace(/^resets /i, 'Resets ');
  }

  function normalizeResetAt(value) {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
    return value;
  }

  function progressText(value) {
    return remainingText(value);
  }

  function normalizeWindow(window) {
    if (!isObject(window)) return null;
    var usedPercentage = window.usedPercentage;
    if (typeof usedPercentage !== 'number' || !Number.isFinite(usedPercentage)) {
      usedPercentage = null;
    }

    var status = asString(window.status, 'unavailable');
    if (!knownStatuses[status]) status = 'unavailable';

    return {
      id: asString(window.id, 'unknown'),
      providerWindowName: asString(window.providerWindowName, asString(window.id, 'Quota')),
      usedPercentage: usedPercentage,
      resetAt: normalizeResetAt(window.resetAt),
      resetInText: resetText(window.resetInText),
      status: status,
      hint: typeof window.hint === 'string' ? window.hint : null,
      statusClass: statusClass(status),
      percentageClass: percentageClass(usedPercentage),
      progressFillClass: progressFillClass(usedPercentage),
      progressFillWidth: progressFillWidth(usedPercentage),
      progressFillPixels: progressFillPixels(usedPercentage),
      progressFillColor: progressFillColor(usedPercentage),
      remainingText: remainingText(usedPercentage),
      title: windowTitle(asString(window.providerWindowName, asString(window.id, 'Quota'))),
      progressText: progressText(usedPercentage)
    };
  }

  function normalizeAccount(account) {
    if (!isObject(account)) return null;
    var provider = asString(account.provider, 'unknown');
    var status = asString(account.status, 'unavailable');
    if (!knownStatuses[status]) status = 'unavailable';

    var windows = Array.isArray(account.windows)
      ? account.windows.map(normalizeWindow).filter(Boolean)
      : [];

    return {
      provider: provider,
      email: asString(account.email, 'unknown account'),
      displayOrder: asNumber(account.displayOrder, 999999),
      status: status,
      windows: windows,
      stale: account.stale === true,
      errorHint: typeof account.errorHint === 'string' ? account.errorHint : null,
      statusClass: statusClass(status),
      selectionRank: asNumber(account.selectionRank, null),
      selectionRankUncertain: account.stale === true && typeof account.selectionRank === 'number',
      pollIntervalText: formatPollTiming(
        account.nextPollEligibleAt,
        account.effectivePollIntervalSeconds
      )
    };
  }

  function findWindow(account, matcher) {
    for (var index = 0; index < account.windows.length; index += 1) {
      var window = account.windows[index];
      var id = String(window.id || '').toLowerCase();
      var name = String(window.providerWindowName || '').toLowerCase();
      if (matcher(id, name)) return window;
    }
    return null;
  }

  function weeklyWindow(account) {
    return findWindow(account, function (id, name) {
      return id.indexOf('weekly') !== -1 || name.indexOf('weekly') !== -1 || name.indexOf('week') !== -1;
    });
  }

  function fiveHourWindow(account) {
    return findWindow(account, function (id, name) {
      return (
        id.indexOf('5h') !== -1 ||
        id.indexOf('5-hour') !== -1 ||
        id.indexOf('5_hour') !== -1 ||
        name.indexOf('5h') !== -1 ||
        name.indexOf('5-hour') !== -1 ||
        name.indexOf('5 hour') !== -1
      );
    });
  }

  function formatDuration(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
    var s = Math.max(1, Math.round(seconds));
    if (s < 60) return s + 's';
    var m = Math.ceil(s / 60);
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    var remainderMinutes = m % 60;
    if (h < 24) return remainderMinutes > 0 ? h + 'h ' + remainderMinutes + 'm' : h + 'h';
    var d = Math.floor(h / 24);
    var remainderHours = h % 24;
    return remainderHours > 0 ? d + 'd ' + remainderHours + 'h' : d + 'd';
  }

  function formatPollTiming(nextPollEligibleAt, intervalSeconds) {
    var intervalText = formatDuration(intervalSeconds);
    if (!intervalText) return null;
    if (typeof nextPollEligibleAt !== 'string') return null;
    var eligibleMillis = Date.parse(nextPollEligibleAt);
    if (Number.isNaN(eligibleMillis)) return null;
    var secondsLeft = Math.ceil((eligibleMillis - Date.now()) / 1000);
    var countdownText = secondsLeft <= 0 ? 'due' : formatDuration(secondsLeft) + ' left';
    return '↻ ' + countdownText + ' / ' + intervalText;
  }

  function buildProviderSummary(group) {
    function averageWindow(windowFn) {
      var values = [];
      var title = null;
      group.accounts.forEach(function (account) {
        if (account.windows.length === 0) return;
        var w = windowFn(account);
        if (!w || typeof w.usedPercentage !== 'number') return;
        // Exclude exhausted windows (100% used = 0% remaining) so the collapsed
        // provider summary reflects only accounts that are still usable.
        if (w.usedPercentage >= 100) return;
        if (title === null) title = w.title;
        values.push(w.usedPercentage);
      });
      if (values.length === 0) return null;
      var avg = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
      return {
        title: title,
        usedPercentage: avg,
        resetInText: null,
        percentageClass: percentageClass(avg),
        progressFillClass: progressFillClass(avg),
        progressFillPixels: progressFillPixels(avg),
        progressFillColor: progressFillColor(avg),
        remainingText: remainingText(avg)
      };
    }
    return {
      windows: [averageWindow(fiveHourWindow), averageWindow(weeklyWindow)].filter(Boolean)
    };
  }

  function normalizePollIntervalSeconds(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_SECONDS;
    var rounded = Math.round(value);
    return rounded > 0 ? rounded : DEFAULT_POLL_INTERVAL_SECONDS;
  }

  function commandOrDefault(value, fallback) {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
  }

  function buildDeskletConfig(input) {
    input = isObject(input) ? input : {};
    return {
      pollCommand: commandOrDefault(input.pollCommand, DEFAULT_POLL_COMMAND),
      pollIntervalSeconds: normalizePollIntervalSeconds(input.pollIntervalSeconds),
      setupCommand: commandOrDefault(input.setupCommand, DEFAULT_SETUP_COMMAND)
    };
  }

  function buildRenderModel(latestState) {
    if (!isObject(latestState) || latestState.schemaVersion !== '1' || !Array.isArray(latestState.accounts)) {
      return {
        state: 'malformed',
        message: 'Quota state unavailable. Run: aiqm diagnose',
        generatedAt: null,
        groups: []
      };
    }

    var accounts = latestState.accounts.map(normalizeAccount).filter(Boolean);
    if (accounts.length === 0) {
      return {
        state: 'empty',
        message: 'No accounts configured. Run: aiqm setup',
        generatedAt: asString(latestState.generatedAt, null),
        groups: []
      };
    }

    accounts.sort(function (left, right) {
      if (left.provider !== right.provider) return left.provider < right.provider ? -1 : 1;
      if (left.displayOrder !== right.displayOrder) return left.displayOrder - right.displayOrder;
      return left.email < right.email ? -1 : left.email > right.email ? 1 : 0;
    });

    var groups = [];
    accounts.forEach(function (account) {
      var group = groups.length > 0 ? groups[groups.length - 1] : null;
      if (!group || group.provider !== account.provider) {
        group = { provider: account.provider, accounts: [] };
        groups.push(group);
      }
      group.accounts.push(account);
    });

    groups.forEach(function (group) {
      group.summary = buildProviderSummary(group);
    });

    return {
      state: 'ready',
      message: null,
      generatedAt: asString(latestState.generatedAt, null),
      groups: groups
    };
  }

  function providerDisplayName(providerId) {
    if (providerId === 'claude-code') return 'Claude Code';
    if (providerId === 'codex') return 'Codex';
    var s = String(providerId || '');
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown';
  }

  return {
    DEFAULT_POLL_COMMAND: DEFAULT_POLL_COMMAND,
    DEFAULT_POLL_INTERVAL_SECONDS: DEFAULT_POLL_INTERVAL_SECONDS,
    DEFAULT_SETUP_COMMAND: DEFAULT_SETUP_COMMAND,
    PROGRESS_TRACK_WIDTH_PX: PROGRESS_TRACK_WIDTH_PX,
    buildDeskletConfig: buildDeskletConfig,
    buildRenderModel: buildRenderModel,
    percentageClass: percentageClass,
    progressText: progressText,
    providerDisplayName: providerDisplayName,
    statusClass: statusClass
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RenderModel;
}
