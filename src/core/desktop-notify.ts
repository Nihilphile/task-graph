import { spawn, execFileSync } from 'node:child_process';
import { realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskGraphError } from './errors.js';

export const DESKTOP_VERSIONS = ['codex-cli 0.153.4', 'codex-cli 0.158.0-alpha.2.1'] as const;
export interface DesktopBinding { executable: string; version: string; home: string; }
export type DeliveryResult = { state: 'accepted' | 'not_started' | 'uncertain' | 'paused'; receipt?: string; error?: string };
export interface DesktopAdapter {
  inspect(): Promise<DesktopBinding>;
  submit(binding: DesktopBinding, thread: string, message: string): Promise<DeliveryResult>;
}

/** Bounded subprocess, argument array, no shell, hidden window. */
export function runDesktopProcess(executable: string, args: readonly string[], home: string, timeout = 15000): Promise<{ code: number | null; output: string; failedToSpawn: boolean; uncertain: boolean }> {
  return new Promise(resolve => {
    let output = '', failedToSpawn = false, uncertain = false, settled = false;
    const child = spawn(executable, [...args], { shell: false, windowsHide: true, env: { ...process.env, CODEX_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (code: number | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, output, failedToSpawn, uncertain }); };
    const timer = setTimeout(() => { uncertain = true; child.kill(); finish(null); }, timeout);
    const collect = (chunk: Buffer) => {
      if (settled) return;
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > 8192) { output = output.slice(0, 8192); uncertain = true; child.kill(); finish(null); }
    };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    child.on('error', () => { failedToSpawn = true; finish(null); });
    child.on('close', finish);
  });
}

export function parseDesktopReceipt(result: Awaited<ReturnType<typeof runDesktopProcess>>, thread: string): DeliveryResult {
  if (result.failedToSpawn) return { state: 'not_started', error: 'Desktop helper did not start' };
  const line = result.output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  const match = /^Queued message ([^\r\n]{1,256}) for thread ([0-9a-f-]{36})\.$/iu.exec(line);
  if (!result.uncertain && result.code === 0 && match?.[2]?.toLowerCase() === thread.toLowerCase()) return { state: 'accepted', receipt: match[1] };
  return { state: 'uncertain', error: 'No exact matching queue receipt; inspect the target before retrying' };
}

async function inspectExecutable(executable: string, home: string): Promise<string> {
  const version = await runDesktopProcess(executable, ['--version'], home, 5000);
  const value = version.output.trim();
  if (version.code !== 0 || version.uncertain || !DESKTOP_VERSIONS.some(v => v === value)) throw new TaskGraphError('E_DESKTOP_VERSION', 'Desktop version is not in the compatibility set', [value]);
  const help = await runDesktopProcess(executable, ['queue', '--help'], home, 5000);
  if (help.code !== 0 || help.uncertain || !/--thread\b/.test(help.output) || !/--message\b/.test(help.output)) throw new TaskGraphError('E_DESKTOP_CAPABILITY', 'Desktop queue interface is unavailable');
  return value;
}

export const desktopAdapter: DesktopAdapter = {
  async inspect() {
    if (process.platform !== 'win32') throw new TaskGraphError('E_DESKTOP_PLATFORM', 'Desktop watch currently supports Windows');
    const script = "$ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='codex.exe'\" | Where-Object { (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue).ProcessName -in @('ChatGPT','Codex') } | Select-Object -ExpandProperty ExecutablePath -Unique) | ConvertTo-Json -Compress";
    let candidates: string[];
    try {
      const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 16384 }).trim();
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      candidates = typeof parsed === 'string' ? [parsed] : Array.isArray(parsed) && parsed.every(p => typeof p === 'string') ? parsed : [];
    } catch { throw new TaskGraphError('E_DESKTOP_DISCOVERY', 'Cannot identify the running Desktop bundled executable'); }
    if (candidates.length !== 1) throw new TaskGraphError('E_DESKTOP_DISCOVERY', 'Expected one running Desktop bundled executable; no npm CLI fallback is used');
    const executable = realpathSync(candidates[0]!);
    const home = realpathSync(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
    if (!existsSync(path.join(home, 'sessions')) || !existsSync(path.join(home, 'state_5.sqlite'))) throw new TaskGraphError('E_DESKTOP_PROFILE', 'Cannot verify the current Desktop storage profile');
    return { executable, home, version: await inspectExecutable(executable, home) };
  },
  async submit(binding, thread, message) {
    try {
      if (await inspectExecutable(binding.executable, binding.home) !== binding.version) return { state: 'paused', error: 'Desktop version changed; re-register after compatibility verification' };
    } catch (error) { return { state: 'paused', error: error instanceof Error ? error.message : String(error) }; }
    return parseDesktopReceipt(await runDesktopProcess(binding.executable, ['queue', '--thread', thread, '--message', message], binding.home), thread);
  },
};
