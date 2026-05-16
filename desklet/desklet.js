const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const DeskletManager = imports.ui.deskletManager;

const UUID = 'ai-agent-quota-monitor@local';
const Me = DeskletManager.deskletMeta[UUID];
if (Me && Me.path && imports.searchPath.indexOf(Me.path) === -1) {
  imports.searchPath.unshift(Me.path);
}
const RenderModel = imports.renderModel.RenderModel;

function AiAgentQuotaMonitorDesklet(metadata, deskletId) {
  this._init(metadata, deskletId);
}

AiAgentQuotaMonitorDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function (metadata, deskletId) {
    Desklet.Desklet.prototype._init.call(this, metadata, deskletId);
    this._timeoutId = null;
    this._latestMonitor = null;
    this._postPollRenderTimeoutId = null;
    this._renderDebounceId = null;
    this._providerExpanded = {};
    this._providerSections = {};
    this.pollCommand = RenderModel.DEFAULT_POLL_COMMAND;
    this.pollIntervalSeconds = RenderModel.DEFAULT_POLL_INTERVAL_SECONDS;
    this.setupCommand = RenderModel.DEFAULT_SETUP_COMMAND;
    this.latestStateFile = GLib.build_filenamev([
      GLib.get_home_dir(),
      '.local',
      'share',
      'ai-agent-quota-monitor',
      'latest.json'
    ]);

    this.settings = new Settings.DeskletSettings(this, metadata.uuid, deskletId);
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      'latest-state-file',
      'latestStateFile',
      this._onSettingsChanged,
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      'poll-command',
      'pollCommand',
      this._onSettingsChanged,
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      'poll-interval-seconds',
      'pollIntervalSeconds',
      this._onSettingsChanged,
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      'setup-command',
      'setupCommand',
      this._onSettingsChanged,
      null
    );

    this._config = this._readConfig();
    this._root = new St.BoxLayout({ vertical: true, style_class: 'aiqm-desklet' });
    this.setContent(this._root);
    this.setHeader('AI Quota Monitor');
    this._render();
    this._watchLatestStateFile();
    this._runPollCommand();
    this._scheduleRefresh();
  },

  _readConfig: function () {
    const config = RenderModel.buildDeskletConfig({
      pollCommand: this.pollCommand,
      pollIntervalSeconds: this.pollIntervalSeconds,
      setupCommand: this.setupCommand
    });
    config.pollCommand = this._resolveAiqmCommand(config.pollCommand);
    config.setupCommand = this._resolveSetupCommand(config.setupCommand);
    return config;
  },

  _resolveAiqmCommand: function (command) {
    if (!command || command.indexOf('aiqm ') !== 0) return command;
    const localAiqm = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'aiqm']);
    if (!GLib.file_test(localAiqm, GLib.FileTest.EXISTS)) return command;
    return localAiqm + command.slice(4);
  },

  _resolveSetupCommand: function (command) {
    const localSetup = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'aiqm-setup-terminal']);
    if (GLib.file_test(localSetup, GLib.FileTest.EXISTS)) {
      if (!command || command === 'aiqm-setup-terminal' || command.indexOf('aiqm setup') !== -1) return localSetup;
    }
    return this._resolveAiqmCommand(command);
  },

  _onSettingsChanged: function () {
    this._config = this._readConfig();
    this._watchLatestStateFile();
    this._render();
    this._scheduleRefresh();
  },

  _scheduleRefresh: function () {
    if (this._timeoutId) Mainloop.source_remove(this._timeoutId);
    this._timeoutId = Mainloop.timeout_add_seconds(this._config.pollIntervalSeconds, () => {
      this._runPollCommand();
      this._schedulePostPollRender();
      return true;
    });
  },

  _runPollCommand: function () {
    try {
      Util.spawnCommandLineAsync(this._config.pollCommand);
    } catch (error) {
      global.logError(error, 'AIQM desklet poll command failed to launch');
    }
  },

  _schedulePostPollRender: function () {
    if (this._postPollRenderTimeoutId) Mainloop.source_remove(this._postPollRenderTimeoutId);
    this._postPollRenderTimeoutId = Mainloop.timeout_add_seconds(10, () => {
      this._postPollRenderTimeoutId = null;
      this._render();
      return false;
    });
  },

  _scheduleRender: function () {
    if (this._renderDebounceId) Mainloop.source_remove(this._renderDebounceId);
    this._renderDebounceId = Mainloop.timeout_add(150, () => {
      this._renderDebounceId = null;
      this._render();
      return false;
    });
  },

  _watchLatestStateFile: function () {
    if (this._latestMonitor) {
      this._latestMonitor.cancel();
      this._latestMonitor = null;
    }

    try {
      const path = this._expandHome(this.latestStateFile);
      const directoryPath = GLib.path_get_dirname(path);
      const basename = GLib.path_get_basename(path);
      const directory = Gio.File.new_for_path(directoryPath);
      this._latestMonitor = directory.monitor_directory(Gio.FileMonitorFlags.NONE, null);
      this._latestMonitor.connect('changed', (_monitor, file) => {
        if (!file || file.get_basename() !== basename) return;
        this._scheduleRender();
      });
    } catch (error) {
      global.logError(error, 'AIQM desklet latest-state monitor failed');
    }
  },

  _launchSetup: function () {
    try {
      Util.spawnCommandLineAsync(this._config.setupCommand);
    } catch (error) {
      global.logError(error, 'AIQM desklet setup command failed to launch');
    }
  },

  _readLatestState: function () {
    try {
      const path = this._expandHome(this.latestStateFile);
      const file = Gio.File.new_for_path(path);
      if (!file.query_exists(null)) return null;
      const bytes = file.load_contents(null)[1];
      const content = imports.byteArray.toString(bytes);
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  },

  _expandHome: function (path) {
    if (!path) return path;
    if (path === '~') return GLib.get_home_dir();
    if (path.indexOf('~/') === 0) return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
    return path;
  },

  _render: function () {
    this._root.destroy_all_children();
    this._providerSections = {};

    const model = RenderModel.buildRenderModel(this._readLatestState());
    if (model.state !== 'ready') {
      this._root.add(new St.Label({ text: model.message, style_class: 'aiqm-message' }));
      this._root.add(this._setupButton());
    } else {
      const headerCard = new St.BoxLayout({ vertical: true, style_class: 'aiqm-header-card' });
      const header = new St.BoxLayout({ style_class: 'aiqm-header' });
      const headerIconPath = Me && Me.path ? Me.path + '/icons/header.png' : null;
      if (headerIconPath && GLib.file_test(headerIconPath, GLib.FileTest.EXISTS)) {
        header.add(new St.Icon({ gicon: Gio.icon_new_for_string(headerIconPath), icon_size: 24, style_class: 'aiqm-header-icon' }));
      }
      header.add(new St.Label({ text: 'AI Quota Monitor', style_class: 'aiqm-title' }));
      header.add(new St.Bin({ x_expand: true }));
      header.add(this._setupButton());
      headerCard.add(header);
      if (model.generatedAt) headerCard.add(new St.Label({ text: 'Updated ' + this._formatUpdatedAt(model.generatedAt), style_class: 'aiqm-subtitle' }));
      const staleCount = model.groups.reduce(
        (count, group) => count + group.accounts.filter((account) => account.status === 'stale' && account.stale && account.windows.some((window) => window.status === 'stale')).length,
        0
      );
      if (staleCount > 0) {
        const label = staleCount === 1 ? '1 account' : String(staleCount) + ' accounts';
        headerCard.add(new St.Label({ text: 'Showing stale quota for ' + label + '.', style_class: 'aiqm-subtitle aiqm-status-stale' }));
      }
      this._root.add(headerCard);

      model.groups.forEach((group) => {
        this._renderProviderSection(group);
      });
    }
  },

  _formatUpdatedAt: function (value) {
    try {
      return new Date(value).toLocaleTimeString();
    } catch (error) {
      return value;
    }
  },

  _setupButton: function () {
    const button = new St.Button({ label: 'Setup', style_class: 'aiqm-setup-button' });
    button.connect('clicked', () => this._launchSetup());
    return button;
  },

  _providerIconPath: function (provider) {
    if (!Me || !Me.path) return null;
    const name = provider === 'claude-code' ? 'claude' : provider === 'codex' ? 'codex' : null;
    if (!name) return null;
    const path = Me.path + '/icons/' + name + '.png';
    return GLib.file_test(path, GLib.FileTest.EXISTS) ? path : null;
  },

  _renderProviderSection: function (group) {
    if (this._providerExpanded[group.provider] === undefined) this._providerExpanded[group.provider] = false;
    const expanded = this._providerExpanded[group.provider] === true;

    const section = new St.BoxLayout({ vertical: true, style_class: 'aiqm-provider-section' });

    const button = new St.Button({ style_class: 'aiqm-provider-toggle' });
    const outer = new St.BoxLayout({ vertical: true, style_class: 'aiqm-provider-toggle-content' });
    const topRow = new St.BoxLayout();
    const iconPath = this._providerIconPath(group.provider);
    if (iconPath) {
      topRow.add(new St.Icon({ gicon: Gio.icon_new_for_string(iconPath), icon_size: 16, style_class: 'aiqm-provider-icon' }));
    }
    topRow.add(new St.Label({ text: RenderModel.providerDisplayName(group.provider) + ' accounts', style_class: 'aiqm-provider-toggle-label' }));
    topRow.add(new St.Label({ text: String(group.accounts.length), style_class: 'aiqm-count-pill' }));
    topRow.add(new St.Bin({ x_expand: true }));
    const arrowLabel = new St.Label({ text: expanded ? '▾' : '▸', style_class: 'aiqm-provider-toggle-arrow' });
    topRow.add(arrowLabel);
    outer.add(topRow);

    const summaryMetrics = new St.BoxLayout({ vertical: true });
    const summary = group.summary;
    if (summary && summary.windows.length > 0) {
      summary.windows.forEach((window) => this._renderQuotaMetric(summaryMetrics, window, null));
    }
    if (expanded) summaryMetrics.hide();
    outer.add(summaryMetrics);

    button.set_child(outer);
    section.add(button);

    const accountsSection = new St.BoxLayout({ vertical: true, style_class: 'aiqm-provider-accounts' });
    group.accounts.forEach((account) => this._renderAccount(accountsSection, account));
    if (!expanded) accountsSection.hide();
    section.add(accountsSection);

    this._root.add(section);

    this._providerSections[group.provider] = { summaryMetrics, accountsSection, arrowLabel };

    button.connect('clicked', () => {
      const nowExpanded = this._providerExpanded[group.provider] === true;
      if (!nowExpanded) {
        Object.keys(this._providerExpanded).forEach((provider) => {
          if (provider !== group.provider && this._providerExpanded[provider] === true) {
            this._providerExpanded[provider] = false;
            const refs = this._providerSections[provider];
            if (refs) {
              refs.accountsSection.hide();
              refs.summaryMetrics.show();
              refs.arrowLabel.set_text('▸');
            }
          }
        });
      }
      this._providerExpanded[group.provider] = !nowExpanded;
      if (nowExpanded) {
        accountsSection.hide();
        summaryMetrics.show();
        arrowLabel.set_text('▸');
      } else {
        accountsSection.show();
        summaryMetrics.hide();
        arrowLabel.set_text('▾');
      }
    });
  },

  _renderAccount: function (parent, account) {
    const card = new St.BoxLayout({ vertical: true, style_class: 'aiqm-quota-card ' + account.statusClass });
    if (account.statusClass !== 'aiqm-status-fresh') card.set_style('border: 1px solid rgba(255, 138, 128, 0.45);');
    const accountHeader = new St.BoxLayout({ style_class: 'aiqm-account-header' });
    accountHeader.add(new St.Label({ text: account.email, style_class: 'aiqm-email' }));
    accountHeader.add(new St.Bin({ x_expand: true }));
    if (account.selectionRank != null) {
      const rankLabel = String(account.selectionRank) + (account.selectionRankUncertain ? '?' : '');
      accountHeader.add(new St.Label({ text: rankLabel, style_class: 'aiqm-selection-rank-pill' }));
    }
    card.add(accountHeader);

    if (account.windows.length === 0) {
      card.add(new St.Label({ text: account.errorHint || 'No quota windows available', style_class: 'aiqm-hint aiqm-status-error' }));
    }

    account.windows.forEach((window, index) => {
      var isLast = index === account.windows.length - 1;
      this._renderQuotaMetric(card, window, isLast ? account.pollIntervalText : null);
    });

    if (account.windows.length > 0 && this._shouldShowAccountWarning(account)) {
      card.add(new St.Label({ text: account.errorHint, style_class: 'aiqm-hint aiqm-status-error' }));
    }

    parent.add(card);
  },

  _shouldShowAccountWarning: function (account) {
    if (!account || typeof account.errorHint !== 'string' || account.errorHint.length === 0) return false;
    return account.status !== 'fresh';
  },

  _renderQuotaMetric: function (parent, window, pollIntervalText) {
    const metric = new St.BoxLayout({ vertical: true, style_class: 'aiqm-metric' });
    const header = new St.BoxLayout({ style_class: 'aiqm-metric-header' });
    const title = new St.Label({ text: window.title, style_class: 'aiqm-card-title' });
    header.add(title);
    header.add(new St.Bin({ x_expand: true }));
    const remaining = new St.Label({ text: window.remainingText, style_class: 'aiqm-remaining-inline ' + window.percentageClass });
    header.add(remaining);
    metric.add(header);

    const trackWidth = RenderModel.PROGRESS_TRACK_WIDTH_PX;
    const fillWidth = Math.min(trackWidth, Math.max(1, window.progressFillPixels));
    const hasRemainder = fillWidth < trackWidth;
    const track = new St.BoxLayout({ style_class: 'aiqm-progress-track' });
    if (typeof track.set_x_expand === 'function') track.set_x_expand(true);
    const fill = new St.Bin({ style_class: 'aiqm-progress-fill ' + window.progressFillClass });
    if (hasRemainder) {
      fill.set_style(
        'width: ' + String(fillWidth) + 'px; min-width: ' + String(fillWidth) + 'px; max-width: ' + String(fillWidth) + 'px; background-color: ' + window.progressFillColor + ';'
      );
      if (typeof fill.set_width === 'function') fill.set_width(fillWidth);
      if (typeof fill.set_x_expand === 'function') fill.set_x_expand(false);
    } else {
      fill.set_style('min-width: ' + String(fillWidth) + 'px; background-color: ' + window.progressFillColor + ';');
      if (typeof fill.set_x_expand === 'function') fill.set_x_expand(true);
    }
    track.add(fill);
    if (hasRemainder) {
      const remainder = new St.Bin({ style_class: 'aiqm-progress-remainder' });
      if (typeof remainder.set_x_expand === 'function') remainder.set_x_expand(true);
      track.add(remainder);
    }
    metric.add(track);

    if (window.resetInText || pollIntervalText) {
      var resetRow = new St.BoxLayout({ style_class: 'aiqm-reset-row' });
      if (window.resetInText) resetRow.add(new St.Label({ text: window.resetInText, style_class: 'aiqm-reset' }));
      if (pollIntervalText) {
        resetRow.add(new St.Bin({ x_expand: true }));
        resetRow.add(new St.Label({ text: pollIntervalText, style_class: 'aiqm-poll-interval' }));
      }
      metric.add(resetRow);
    }
    parent.add(metric);
  },

  on_desklet_removed: function () {
    if (this._timeoutId) Mainloop.source_remove(this._timeoutId);
    if (this._postPollRenderTimeoutId) Mainloop.source_remove(this._postPollRenderTimeoutId);
    if (this._renderDebounceId) Mainloop.source_remove(this._renderDebounceId);
    if (this._latestMonitor) this._latestMonitor.cancel();
    this._timeoutId = null;
    this._latestMonitor = null;
    this._postPollRenderTimeoutId = null;
    this._renderDebounceId = null;
    this._providerExpanded = {};
    this._providerSections = {};
  }
};

function main(metadata, deskletId) {
  return new AiAgentQuotaMonitorDesklet(metadata, deskletId);
}
