import { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type {
  AccountEditActionResult,
  AccountLogoutActionResult,
  ClaudeAuthActionResult,
  ClaudeReloginActionResult,
  ClaudeSetupActionResult,
  CodexAuthActionResult,
  CodexReloginActionResult,
  CodexSetupActionResult,
  FakeSetupActionProgress,
  FakeSetupActionResult,
  FakeSetupInput,
  FakeSetupScenario
} from './setup-actions.js';
import { FAKE_SETUP_SCENARIOS } from './setup-actions.js';
import type { CodexLoginStatus } from '../providers/index.js';
import type {
  ClaudeLoginStatus,
  CodexAuthMode,
  CodexEvidenceExportResult,
  CodexPostLoginDiscoveryResult
} from '../services/index.js';
import type { SetupScreenModel } from './setup-screen-model.js';

export type SetupAppProps = {
  model: SetupScreenModel;
  onSubmit?: (
    input: FakeSetupInput,
    onProgress?: FakeSetupActionProgress
  ) => Promise<FakeSetupActionResult>;
  onCodexStart?: (
    expectedEmail: string,
    authMode?: CodexAuthMode
  ) => Promise<CodexAuthActionResult>;
  onCodexPoll?: (codexHome: string) => Promise<CodexLoginStatus>;
  onCodexDiscover?: (codexHome: string) => Promise<CodexPostLoginDiscoveryResult>;
  onCodexExport?: (discovery: CodexPostLoginDiscoveryResult) => Promise<CodexEvidenceExportResult>;
  onCodexCancel?: (process: CodexAuthActionResult['process']) => Promise<void>;
  onCodexSubmit?: (input: {
    email: string;
    displayName?: string;
    codexHome: string;
    pollAfterAdd: boolean;
  }) => Promise<CodexSetupActionResult>;
  onClaudeStart?: (expectedEmail: string) => Promise<ClaudeAuthActionResult>;
  onClaudePoll?: (claudeConfigDir: string, expectedEmail?: string) => Promise<ClaudeLoginStatus>;
  onClaudeCancel?: (process: ClaudeAuthActionResult['process']) => Promise<void>;
  onClaudeSubmit?: (input: {
    email: string;
    displayName?: string;
    claudeConfigDir: string;
    pollAfterAdd: boolean;
  }) => Promise<ClaudeSetupActionResult>;
  onAccountLogout?: (input: {
    provider: string;
    email: string;
  }) => Promise<AccountLogoutActionResult>;
  onAccountSignOut?: (input: {
    provider: string;
    email: string;
  }) => Promise<AccountLogoutActionResult>;
  onCodexRelogin?: (input: {
    email: string;
    codexHome: string;
  }) => Promise<CodexReloginActionResult>;
  onClaudeRelogin?: (input: {
    email: string;
    claudeConfigDir: string;
  }) => Promise<ClaudeReloginActionResult>;
  onAccountEdit?: (input: {
    provider: string;
    email: string;
    displayName?: string;
    displayOrder?: number;
  }) => Promise<AccountEditActionResult>;
};

type Screen =
  | 'home'
  | 'provider'
  | 'email'
  | 'auth'
  | 'codex_mode'
  | 'codex_email'
  | 'codex_display_name'
  | 'codex_waiting'
  | 'claude_email'
  | 'claude_display_name'
  | 'claude_waiting'
  | 'scenario'
  | 'poll'
  | 'submitting'
  | 'confirm_logout'
  | 'confirm_signout'
  | 'logging_out'
  | 'signing_out'
  | 'relogin_waiting'
  | 'edit_menu'
  | 'edit_name'
  | 'edit_order'
  | 'saving_edit'
  | 'result'
  | 'error';

function scenarioAt(index: number): FakeSetupScenario {
  return FAKE_SETUP_SCENARIOS[index % FAKE_SETUP_SCENARIOS.length];
}

export function SetupApp({
  model,
  onSubmit,
  onCodexStart,
  onCodexPoll,
  onCodexDiscover,
  onCodexExport,
  onCodexCancel,
  onCodexSubmit,
  onClaudeStart,
  onClaudePoll,
  onClaudeCancel,
  onClaudeSubmit,
  onClaudeRelogin,
  onAccountLogout,
  onAccountSignOut,
  onCodexRelogin,
  onAccountEdit
}: SetupAppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('home');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [editValue, setEditValue] = useState('');
  const [accounts, setAccounts] = useState(model.accounts);
  const [reorderOriginalAccounts, setReorderOriginalAccounts] = useState(model.accounts);
  const [selectedAccountIndex, setSelectedAccountIndex] = useState(0);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [pollAfterAdd, setPollAfterAdd] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [codexAuthMode, setCodexAuthMode] = useState<CodexAuthMode>('browser');
  const [codexAuth, setCodexAuth] = useState<CodexAuthActionResult | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexLoginStatus | null>(null);
  const [codexDiscovery, setCodexDiscovery] = useState<CodexPostLoginDiscoveryResult | null>(null);
  const [codexEvidence, setCodexEvidence] = useState<CodexEvidenceExportResult | null>(null);
  const [claudeAuth, setClaudeAuth] = useState<ClaudeAuthActionResult | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeLoginStatus | null>(null);
  const [isRelogin, setIsRelogin] = useState(false);

  const selectedAccount = accounts[selectedAccountIndex] ?? null;

  const upsertAccount = (account: SetupScreenModel['accounts'][number]): void => {
    setAccounts((current) => {
      const next = current.filter(
        (item) => !(item.provider === account.provider && item.email === account.email)
      );
      next.push(account);
      next.sort((left, right) => {
        if (left.displayOrder !== right.displayOrder) return left.displayOrder - right.displayOrder;
        const leftKey = `${left.provider}:${left.email}`;
        const rightKey = `${right.provider}:${right.email}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
      setSelectedAccountIndex(
        Math.max(
          0,
          next.findIndex(
            (item) => item.provider === account.provider && item.email === account.email
          )
        )
      );
      return next;
    });
  };

  const removeAccountFromView = (provider: string, accountEmail: string): void => {
    setAccounts((current) => {
      const next = current.filter(
        (item) => !(item.provider === provider && item.email === accountEmail)
      );
      setSelectedAccountIndex((value) => Math.max(0, Math.min(value, next.length - 1)));
      return next;
    });
  };

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') exit();
      if (!onSubmit) return;

      const resetFlowState = (): void => {
        setCommandInput('');
        setEmail('');
        setDisplayName('');
        setCodexAuth(null);
        setCodexStatus(null);
        setCodexDiscovery(null);
        setCodexEvidence(null);
        setClaudeAuth(null);
        setClaudeStatus(null);
      };

      const startCodexFlow = (): void => {
        setMessage(null);
        resetFlowState();
        setCodexAuthMode('browser');
        setScreen('codex_email');
      };

      const startClaudeFlow = (): void => {
        setMessage(null);
        resetFlowState();
        setScreen('claude_email');
      };

      const cancelToHome = (): void => {
        if (screen === 'codex_waiting' && codexAuth && onCodexCancel) {
          onCodexCancel(codexAuth.process).catch(() => undefined);
        }
        resetFlowState();
        setMessage('Cancelled.');
        setScreen('home');
      };

      if (input === 'q' && screen === 'codex_waiting') {
        cancelToHome();
        return;
      }

      if (
        (screen === 'result' || screen === 'error') &&
        (key.return || key.escape || input === 'b')
      ) {
        setMessage(null);
        setScreen('home');
        return;
      }

      if (input === 'q' && screen !== 'home') {
        exit();
        return;
      }

      if (screen === 'home' && key.upArrow && accounts.length > 0) {
        setSelectedAccountIndex((value) => Math.max(0, value - 1));
        return;
      }

      if (screen === 'home' && key.downArrow && accounts.length > 0) {
        setSelectedAccountIndex((value) => Math.min(accounts.length - 1, value + 1));
        return;
      }

      if (screen === 'home' && (key.backspace || key.delete)) {
        setCommandInput((value) => value.slice(0, -1));
        return;
      }

      const runHomeCommand = (command: string): boolean => {
        if (command === 'o' || command === 'codex' || command === 'openai') {
          startCodexFlow();
          return true;
        }
        if (command === 'a' || command === 'claude' || command === 'anthropic') {
          startClaudeFlow();
          return true;
        }
        if (command === 'e' && accounts.length > 0) {
          setMessage(null);
          setEditValue('');
          setScreen('edit_menu');
          return true;
        }
        if (
          (command === 'd' || command === 'delete' || command === 'remove') &&
          accounts.length > 0
        ) {
          setMessage(null);
          setScreen('confirm_logout');
          return true;
        }
        if ((command === 'l' || command === 'logout') && accounts.length > 0) {
          setMessage(null);
          setScreen('confirm_signout');
          return true;
        }
        if (command === 'q' || command === 'quit') {
          exit();
          return true;
        }
        if (command === 'h' || command === 'help' || command === '?') {
          setMessage(
            'o Codex/OpenAI, a Claude/Anthropic, e edit, d delete, l logout only, q quit. Use ↑/↓ to select an account.'
          );
          return true;
        }
        return false;
      };

      if (screen === 'home' && key.return) {
        const command = commandInput.trim().toLowerCase();
        setCommandInput('');
        if (command.length === 0) return;
        if (!runHomeCommand(command)) setMessage(`Unknown command: ${command}`);
        return;
      }

      if (screen === 'home' && input && !key.ctrl && !key.meta) {
        const command = input.trim().toLowerCase();
        if (command.length === 1 && runHomeCommand(command)) {
          setCommandInput('');
          return;
        }
        setCommandInput((value) => value + input);
        return;
      }

      if (screen === 'confirm_logout') {
        if (input === 'n' || input === 'b' || key.escape) {
          setMessage(null);
          setScreen('home');
          return;
        }
        if ((input === 'y' || key.return) && accounts.length > 0 && onAccountLogout) {
          const account = accounts[selectedAccountIndex];
          setScreen('logging_out');
          setMessage(`Removing ${account.email}...`);
          onAccountLogout({ provider: account.provider, email: account.email })
            .then((result) => {
              removeAccountFromView(result.provider, result.email);
              setMessage(`Removed ${result.email}`);
              setScreen('result');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
          return;
        }
      }

      if (screen === 'confirm_signout') {
        if (input === 'n' || input === 'b' || key.escape) {
          setMessage(null);
          setScreen('home');
          return;
        }
        if ((input === 'y' || key.return) && accounts.length > 0 && onAccountSignOut) {
          const account = accounts[selectedAccountIndex];
          setScreen('signing_out');
          setMessage(`Logging out ${account.email}...`);
          onAccountSignOut({ provider: account.provider, email: account.email })
            .then((result) => {
              setMessage(`Logged out ${result.email}`);
              setScreen('home');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
          return;
        }
      }

      const updateAccountsFromResult = (result: AccountEditActionResult): void => {
        setAccounts(result.accounts);
        setSelectedAccountIndex(
          Math.max(
            0,
            result.accounts.findIndex(
              (account) => account.provider === result.provider && account.email === result.email
            )
          )
        );
      };

      const startRelogin = (): void => {
        const account = selectedAccount;
        if (account.provider === 'claude-code' && onClaudeStart) {
          setIsRelogin(true);
          setEmail(account.email);
          setScreen('claude_waiting');
          setMessage(
            'Starting Claude browser login. Complete login in the browser, then press s to save.'
          );
          onClaudeStart(account.email)
            .then((result) => {
              setClaudeAuth(result);
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
          return;
        }
        if (account.provider === 'codex' && onCodexStart && onCodexRelogin) {
          setScreen('relogin_waiting');
          setMessage(`Starting browser login for ${account.email}...`);
          onCodexStart(account.email, 'browser')
            .then((result) => onCodexRelogin({ email: account.email, codexHome: result.codexHome }))
            .then((result) => {
              updateAccountsFromResult(result);
              setMessage(`Re-logged in ${result.email}`);
              setScreen('home');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
          return;
        }
        setMessage('Re-login is not available for this account.');
      };

      if (screen === 'edit_menu') {
        if (input === 'b' || key.escape) {
          setScreen('home');
          return;
        }
        if (input === 'r') {
          startRelogin();
          return;
        }
        if (input === 'l') {
          setScreen('confirm_signout');
          return;
        }
        if (input === 'n') {
          setEditValue(selectedAccount.displayName ?? '');
          setScreen('edit_name');
          return;
        }
        if (input === 'o') {
          setReorderOriginalAccounts(accounts);
          setScreen('edit_order');
          return;
        }
      }

      if (screen === 'edit_name') {
        if (key.escape) {
          setScreen('edit_menu');
          return;
        }
        if (key.return && onAccountEdit) {
          const account = selectedAccount;
          setScreen('saving_edit');
          setMessage(`Saving ${account.email}...`);
          onAccountEdit({
            provider: account.provider,
            email: account.email,
            displayName: editValue
          })
            .then((result) => {
              setAccounts(result.accounts);
              setSelectedAccountIndex(
                Math.max(
                  0,
                  result.accounts.findIndex(
                    (account) =>
                      account.provider === result.provider && account.email === result.email
                  )
                )
              );
              setMessage(`Updated ${result.email}`);
              setEditValue('');
              setScreen('home');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
          return;
        }
        if (key.backspace || key.delete) {
          setEditValue((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) setEditValue((value) => value + input);
        return;
      }

      if (screen === 'edit_order') {
        if (input === 'b' || key.escape) {
          setAccounts(reorderOriginalAccounts);
          setSelectedAccountIndex(
            Math.max(
              0,
              reorderOriginalAccounts.findIndex(
                (account) =>
                  account.provider === selectedAccount.provider &&
                  account.email === selectedAccount.email
              )
            )
          );
          setScreen('edit_menu');
          return;
        }
        if (key.upArrow) {
          const sameProviderIndexes = accounts
            .map((account, index) => ({ account, index }))
            .filter((item) => item.account.provider === selectedAccount.provider)
            .map((item) => item.index);
          const currentProviderPosition = sameProviderIndexes.indexOf(selectedAccountIndex);
          if (currentProviderPosition > 0) {
            const previousIndex = sameProviderIndexes[currentProviderPosition - 1];
            setAccounts((current) => {
              const next = [...current];
              [next[previousIndex], next[selectedAccountIndex]] = [
                next[selectedAccountIndex],
                next[previousIndex]
              ];
              return next;
            });
            setSelectedAccountIndex(previousIndex);
          }
          return;
        }
        if (key.downArrow) {
          const sameProviderIndexes = accounts
            .map((account, index) => ({ account, index }))
            .filter((item) => item.account.provider === selectedAccount.provider)
            .map((item) => item.index);
          const currentProviderPosition = sameProviderIndexes.indexOf(selectedAccountIndex);
          if (
            currentProviderPosition >= 0 &&
            currentProviderPosition < sameProviderIndexes.length - 1
          ) {
            const nextIndex = sameProviderIndexes[currentProviderPosition + 1];
            setAccounts((current) => {
              const next = [...current];
              [next[selectedAccountIndex], next[nextIndex]] = [
                next[nextIndex],
                next[selectedAccountIndex]
              ];
              return next;
            });
            setSelectedAccountIndex(nextIndex);
          }
          return;
        }
        if (key.return && onAccountEdit) {
          const account = selectedAccount;
          setScreen('saving_edit');
          setMessage(`Saving ${account.email}...`);
          onAccountEdit({
            provider: account.provider,
            email: account.email,
            displayOrder: selectedAccountIndex
          })
            .then((result) => {
              setAccounts(result.accounts);
              setSelectedAccountIndex(
                Math.max(
                  0,
                  result.accounts.findIndex(
                    (accountItem) =>
                      accountItem.provider === result.provider && accountItem.email === result.email
                  )
                )
              );
              setMessage(`Updated ${result.email}`);
              setScreen('home');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setAccounts(reorderOriginalAccounts);
              setScreen('error');
            });
          return;
        }
        return;
      }

      if ((screen === 'result' || screen === 'error') && input === 'o' && onCodexStart) {
        startCodexFlow();
        return;
      }

      if ((screen === 'result' || screen === 'error') && input === 'a' && onClaudeStart) {
        startClaudeFlow();
        return;
      }

      if (
        key.escape ||
        (input === 'b' &&
          ['provider', 'auth', 'codex_mode', 'codex_waiting', 'scenario', 'poll'].includes(screen))
      ) {
        cancelToHome();
        return;
      }

      if (screen === 'provider') {
        if (key.return) setScreen('email');
        return;
      }

      if (screen === 'email') {
        if (key.return) {
          setScreen('auth');
          return;
        }
        if (key.backspace || key.delete) {
          setEmail((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) setEmail((value) => value + input);
        return;
      }

      if (screen === 'auth') {
        if (key.return) {
          setScreen('scenario');
          return;
        }
        if (key.backspace || key.delete) {
          setEmail((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) setEmail((value) => value + input);
        return;
      }

      if (screen === 'codex_mode') {
        if (input === 'b' || key.return) {
          setCodexAuthMode('browser');
          setScreen('codex_email');
        }
        return;
      }

      if (screen === 'codex_email') {
        if (key.return) {
          setScreen('codex_display_name');
          return;
        }
        if (key.backspace || key.delete) {
          setEmail((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) setEmail((value) => value + input);
        return;
      }

      if (screen === 'codex_display_name') {
        if (key.return) {
          setScreen('codex_waiting');
          setMessage(
            'Starting Codex browser login. Complete login in the browser, then return here...'
          );
          onCodexStart?.(email, codexAuthMode)
            .then((result) => {
              setCodexAuth(result);
              if (!onCodexSubmit) {
                setMessage(result.label);
                return undefined;
              }
              setMessage('AIQM Codex login complete; testing quota and saving account...');
              return onCodexSubmit({
                email,
                displayName: displayName.trim() || undefined,
                codexHome: result.codexHome,
                pollAfterAdd
              }).then((submitResult) => {
                upsertAccount({
                  provider: submitResult.add.account.provider,
                  email: submitResult.add.account.email,
                  displayOrder: submitResult.add.account.displayOrder
                });
                resetFlowState();
                setMessage(`Added ${submitResult.add.account.email}`);
                setScreen('home');
                return undefined;
              });
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
          return;
        }
        if (key.backspace || key.delete) {
          setDisplayName((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) setDisplayName((value) => value + input);
        return;
      }

      if (screen === 'claude_email') {
        if (key.return) {
          setScreen('claude_display_name');
          return;
        }
        if (key.backspace || key.delete) {
          setEmail((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) setEmail((value) => value + input);
        return;
      }

      if (screen === 'claude_display_name') {
        if (key.return) {
          setScreen('claude_waiting');
          setMessage(
            'Starting Claude browser login. Complete login in the browser, then return here...'
          );
          onClaudeStart?.(email)
            .then((result) => {
              setClaudeAuth(result);
              setMessage('Complete Claude login in the browser, then press s to save.');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
          return;
        }
        if (key.backspace || key.delete) {
          setDisplayName((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) setDisplayName((value) => value + input);
        return;
      }

      if (screen === 'claude_waiting') {
        if (input === 'p' && claudeAuth && onClaudePoll) {
          onClaudePoll(claudeAuth.claudeConfigDir, email)
            .then((status) => {
              setClaudeStatus(status);
              setMessage(`Claude login status: ${status.status}`);
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
            });
        }
        if (input === 's' && claudeAuth && isRelogin && onClaudeRelogin) {
          setMessage('Verifying Claude login and testing quota...');
          onClaudeRelogin({ email, claudeConfigDir: claudeAuth.claudeConfigDir })
            .then((result) => {
              updateAccountsFromResult(result);
              setIsRelogin(false);
              resetFlowState();
              setMessage(`Re-logged in ${result.email}`);
              setScreen('home');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
        }
        if (input === 's' && claudeAuth && !isRelogin && onClaudeSubmit) {
          setMessage('Verifying AIQM Claude login, testing quota, and saving account...');
          onClaudeSubmit({
            email,
            displayName: displayName.trim() || undefined,
            claudeConfigDir: claudeAuth.claudeConfigDir,
            pollAfterAdd
          })
            .then((result) => {
              upsertAccount({
                provider: result.add.account.provider,
                email: result.add.account.email,
                displayOrder: result.add.account.displayOrder
              });
              resetFlowState();
              setMessage(`Added ${result.add.account.email}`);
              setScreen('home');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
        }
        if (input === 'x' && claudeAuth && onClaudeCancel) {
          onClaudeCancel(claudeAuth.process)
            .then(() => {
              setIsRelogin(false);
              setMessage('Claude login cancelled; no account saved.');
              setScreen('result');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
            });
        }
        return;
      }

      if (screen === 'codex_waiting') {
        if (input === 'p' && codexAuth && onCodexPoll) {
          onCodexPoll(codexAuth.codexHome)
            .then((status) => {
              setCodexStatus(status);
              setMessage(`Codex login status: ${status.status}`);
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
            });
        }
        if (input === 'v' && codexAuth && onCodexDiscover) {
          onCodexDiscover(codexAuth.codexHome)
            .then((result) => {
              setCodexDiscovery(result);
              setMessage(
                `Codex passive discovery complete: ${result.loginStatus.status}, ${String(result.probes.length)} probe(s)`
              );
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
            });
        }
        if (input === 'e' && codexDiscovery && onCodexExport) {
          onCodexExport(codexDiscovery)
            .then((result) => {
              setCodexEvidence(result);
              setMessage(`Codex redacted evidence exported: ${result.path}`);
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
            });
        }
        if (input === 's' && codexAuth && onCodexSubmit) {
          setMessage('Verifying AIQM Codex login, testing quota, and saving account...');
          onCodexSubmit({
            email,
            displayName: displayName.trim() || undefined,
            codexHome: codexAuth.codexHome,
            pollAfterAdd
          })
            .then((result) => {
              upsertAccount({
                provider: result.add.account.provider,
                email: result.add.account.email,
                displayOrder: result.add.account.displayOrder
              });
              resetFlowState();
              setMessage(`Added ${result.add.account.email}`);
              setScreen('home');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
        }
        if (input === 'x' && codexAuth && onCodexCancel) {
          onCodexCancel(codexAuth.process)
            .then(() => {
              setMessage('Codex login cancelled; no account saved.');
              setScreen('result');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
            });
        }
        return;
      }

      if (screen === 'scenario') {
        if (key.leftArrow)
          setScenarioIndex(
            (value) => (value + FAKE_SETUP_SCENARIOS.length - 1) % FAKE_SETUP_SCENARIOS.length
          );
        if (key.rightArrow) setScenarioIndex((value) => (value + 1) % FAKE_SETUP_SCENARIOS.length);
        if (key.return) setScreen('poll');
        return;
      }

      if (screen === 'poll') {
        if (input === 'y') setPollAfterAdd(true);
        if (input === 'n') setPollAfterAdd(false);
        if (key.return) {
          setScreen('submitting');
          setMessage('Starting fake provider login session...');
          onSubmit({ email, scenario: scenarioAt(scenarioIndex), pollAfterAdd }, (event) => {
            setMessage(`${event.phase}: ${event.message}`);
          })
            .then((result) => {
              upsertAccount({
                provider: result.add.account.provider,
                email: result.add.account.email,
                displayOrder: result.add.account.displayOrder
              });
              resetFlowState();
              setMessage(`Added ${result.add.account.email}`);
              setScreen('home');
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : String(error));
              setScreen('error');
            });
        }
      }
    },
    { isActive: process.stdin.isTTY }
  );

  const isBusy =
    screen === 'codex_waiting' ||
    screen === 'claude_waiting' ||
    screen === 'submitting' ||
    screen === 'logging_out' ||
    screen === 'signing_out' ||
    screen === 'relogin_waiting' ||
    screen === 'saving_edit';
  const actionTitle = isBusy
    ? 'Working'
    : screen === 'result'
      ? 'Done'
      : screen === 'error'
        ? 'Error'
        : screen === 'confirm_logout'
          ? 'Delete account'
          : screen === 'confirm_signout'
            ? 'Log out account'
            : screen === 'edit_menu' || screen === 'edit_name' || screen === 'edit_order'
              ? 'Edit account'
              : 'Manage account';
  const providerGroups = accounts.reduce<
    {
      provider: string;
      label: string;
      accounts: { account: (typeof accounts)[number]; index: number }[];
    }[]
  >((groups, account, index) => {
    const label =
      account.provider === 'claude-code'
        ? 'Claude'
        : account.provider === 'codex'
          ? 'Codex'
          : account.provider;
    const existing = groups.find((group) => group.provider === account.provider);
    if (existing) {
      existing.accounts.push({ account, index });
      return groups;
    }
    groups.push({ provider: account.provider, label, accounts: [{ account, index }] });
    return groups;
  }, []);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text bold color="cyan">
          AI Quota Monitor
        </Text>
        <Text color="gray">Account setup and management</Text>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Text bold>Accounts</Text>
        {accounts.length === 0 ? (
          <Text color="gray">No accounts yet</Text>
        ) : (
          providerGroups.map((group) => (
            <Box key={group.provider} flexDirection="column">
              <Text color="gray">{group.label}</Text>
              {group.accounts.map(({ account, index }) => (
                <Text
                  key={`${account.provider}:${account.email}`}
                  color={index === selectedAccountIndex ? 'cyan' : undefined}
                >
                  {index === selectedAccountIndex ? '›' : ' '}{' '}
                  {account.displayName ?? account.email}
                </Text>
              ))}
            </Box>
          ))
        )}
      </Box>

      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={screen === 'error' ? 'red' : 'green'}
        paddingX={1}
        flexDirection="column"
      >
        <Text bold>{actionTitle}</Text>
        {screen === 'home' && (
          <Box flexDirection="column">
            <Text>Commands: C(o)dex | Cl(a)ude | (e)dit | (d)elete | (l)ogout | (q)uit</Text>
            <Text color="gray">Use ↑/↓ to select an account, then press one command key.</Text>
            <Text>&gt; {commandInput}</Text>
          </Box>
        )}
        {screen === 'provider' && (
          <Text color="gray">Development provider: fake Enter continue Esc/b back</Text>
        )}
        {screen === 'email' && (
          <Box flexDirection="column">
            <Text color="gray">Enter continue Esc back</Text>
            <Text>Email: {email}</Text>
          </Box>
        )}
        {screen === 'auth' && <Text color="gray">Fake login Enter continue Esc/b back</Text>}
        {screen === 'codex_mode' && (
          <Text color="gray">AIQM-owned browser login Enter continue Esc/b back</Text>
        )}
        {screen === 'codex_email' && (
          <Box flexDirection="column">
            <Text color="gray">Enter continue Esc back</Text>
            <Text>Email: {email}</Text>
          </Box>
        )}
        {screen === 'claude_email' && (
          <Box flexDirection="column">
            <Text color="gray">Enter continue Esc back</Text>
            <Text>Claude email: {email}</Text>
          </Box>
        )}
        {screen === 'codex_display_name' && (
          <Box flexDirection="column">
            <Text color="gray">Enter starts browser login Esc back</Text>
            <Text>Display name: {displayName}</Text>
          </Box>
        )}
        {screen === 'claude_display_name' && (
          <Box flexDirection="column">
            <Text color="gray">Enter starts Claude browser login Esc back</Text>
            <Text>Display name: {displayName}</Text>
          </Box>
        )}
        {screen === 'codex_waiting' && (
          <Box flexDirection="column">
            {codexAuth ? (
              codexAuth.authMode === 'browser' ? (
                <Text>Browser login complete. Saving...</Text>
              ) : (
                <>
                  <Text>Verification URL: {codexAuth.instructions?.verificationUrl}</Text>
                  <Text>User code: {codexAuth.instructions?.userCode}</Text>
                  <Text color="gray">p status s save x cancel Esc/b back</Text>
                </>
              )
            ) : (
              <Text>Waiting for browser login... Esc/b cancel</Text>
            )}
            {codexStatus && <Text>Status: {codexStatus.status}</Text>}
            {codexEvidence && <Text>Evidence: {codexEvidence.path}</Text>}
          </Box>
        )}
        {screen === 'claude_waiting' && (
          <Box flexDirection="column">
            <Text>
              {claudeAuth ? 'Claude login started.' : 'Waiting for Claude browser login...'}
            </Text>
            <Text color="gray">p status s save x cancel Esc/b back</Text>
            {claudeStatus && <Text>Status: {claudeStatus.status}</Text>}
          </Box>
        )}
        {screen === 'scenario' && (
          <Box flexDirection="column">
            <Text color="gray">←/→ change Enter continue Esc/b back</Text>
            <Text>Scenario: {scenarioAt(scenarioIndex)}</Text>
          </Box>
        )}
        {screen === 'poll' && (
          <Box flexDirection="column">
            <Text color="gray">y/n change Enter save Esc/b back</Text>
            <Text>Poll after add: {pollAfterAdd ? 'yes' : 'no'}</Text>
          </Box>
        )}
        {screen === 'submitting' && <Text>Saving...</Text>}
        {screen === 'confirm_logout' && accounts.length > 0 && (
          <Text>Delete {selectedAccount.email} from AIQM? y/N Esc/b back</Text>
        )}
        {screen === 'confirm_signout' && accounts.length > 0 && (
          <Text>Log out {selectedAccount.email} but keep it in the list? y/N Esc/b back</Text>
        )}
        {screen === 'logging_out' && <Text>Removing account...</Text>}
        {screen === 'signing_out' && <Text>Logging out account...</Text>}
        {screen === 'relogin_waiting' && <Text>Complete browser login. Saving new session...</Text>}
        {screen === 'edit_menu' && (
          <Box flexDirection="column">
            <Text>{selectedAccount.displayName ?? selectedAccount.email}</Text>
            <Text>(n)ame (o)rder (r)e-login (l)ogout (b)ack</Text>
          </Box>
        )}
        {screen === 'edit_name' && (
          <Box flexDirection="column">
            <Text color="gray">Enter save Esc back</Text>
            <Text>Display name: {editValue}</Text>
          </Box>
        )}
        {screen === 'edit_order' && (
          <Box flexDirection="column">
            <Text color="gray">↑/↓ move within provider Enter save Esc/b cancel</Text>
            <Text>Reordering: {selectedAccount.displayName ?? selectedAccount.email}</Text>
          </Box>
        )}
        {screen === 'saving_edit' && <Text>Saving account...</Text>}
        {message && <Text color={screen === 'error' ? 'red' : 'green'}>{message}</Text>}
        {(screen === 'result' || screen === 'error') && (
          <Text color="gray">Enter/Esc/b home · o Codex · a Claude · q quit</Text>
        )}
      </Box>
    </Box>
  );
}
