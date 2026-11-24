import {
  B8G_GHOST_CAS_INDEX_URL,
  buildUbtCommand,
  fetchCasIndex,
  resolveUnrealGhostToolchain,
  type UbtBuildConfiguration,
  type UnrealGhostToolchain,
} from './toolchain.mts';

export const COMMAND_IDS = {
  hydrateToolchain: 'unrealGhost.hydrateToolchain',
  buildProject: 'unrealGhost.buildProject',
  generateCompileCommands: 'unrealGhost.generateCompileCommands',
  openViewport: 'unrealGhost.openViewport',
} as const;

export const B8G_ABI_MAGIC_V3_HEX = '0x33564742';

export interface DisposableLike {
  dispose(): void;
}

export interface ExtensionContextLike {
  subscriptions: DisposableLike[];
}

export interface WebviewLike {
  html: string;
}

export interface WebviewPanelLike extends DisposableLike {
  readonly webview: WebviewLike;
}

export interface TerminalLike {
  show(): void;
  sendText(text: string): void;
}

export interface WorkspaceConfigLike {
  get<T>(section: string, defaultValue?: T): T;
}

export interface VscodeApiLike {
  readonly commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): DisposableLike;
  };
  readonly window: {
    showInformationMessage(message: string): unknown;
    showErrorMessage(message: string): unknown;
    createWebviewPanel(
      viewType: string,
      title: string,
      showOptions: number,
      options?: { enableScripts?: boolean; retainContextWhenHidden?: boolean },
    ): WebviewPanelLike;
    createTerminal(options: { name: string; env?: Record<string, string> }): TerminalLike;
  };
  readonly workspace: {
    getConfiguration(section?: string): WorkspaceConfigLike;
    workspaceFolders?: readonly { readonly uri: { readonly fsPath: string } }[];
  };
}

export interface ViewportPanelOptions {
  readonly pipePath: string;
  readonly sectiumDisplayArtifact?: string;
  readonly projectName?: string;
}

let cachedToolchain: UnrealGhostToolchain | null = null;

/**
 * Generates the Webview HTML panel that attaches a UE5 libunreal
 * (bShouldCompileAsDLL = true) RHI framebuffer ring over B8G_ARENA_V1
 * directly into Code - OSS / Eclipse Theia without UE5's CEF3 monolith.
 */
export function createViewportWebviewHtml(options: ViewportPanelOptions): string {
  const title = options.projectName
    ? `Unreal Ghost Viewport — ${options.projectName}`
    : 'Unreal Ghost Viewport (libunreal -> B8G_ARENA_V1)';
  const displayLib = options.sectiumDisplayArtifact ?? 'libsectium_display';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; background: #0b0e14; color: #e6edf3; display: grid; grid-template-rows: auto 1fr; height: 100vh; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #1f2937; font-size: 12px; }
    .badge { padding: 2px 8px; border-radius: 999px; background: #1e293b; color: #7dd3fc; font-family: ui-monospace, monospace; }
    main { position: relative; display: grid; place-items: center; overflow: hidden; }
    canvas { width: 100%; height: 100%; display: block; background: radial-gradient(circle at 50% 40%, #172033, #090c10); }
    .hud { position: absolute; bottom: 12px; left: 12px; padding: 8px 12px; background: rgba(11, 14, 20, 0.82); border: 1px solid #334155; border-radius: 8px; font-size: 12px; font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
  <header>
    <strong>${title}</strong>
    <div>
      <span class="badge">B8G_ABI_MAGIC_V3 ${B8G_ABI_MAGIC_V3_HEX}</span>
      <span class="badge">B8G_ARENA_V1 (64B aligned)</span>
      <span class="badge">${displayLib}</span>
    </div>
  </header>
  <main>
    <canvas id="b8g-unreal-viewport" width="1280" height="720" data-arena="B8G_ARENA_V1" data-magic="${B8G_ABI_MAGIC_V3_HEX}" data-pipe="${options.pipePath}"></canvas>
    <div class="hud">
      <div>Bridge: <code>libunreal</code> (<code>bShouldCompileAsDLL = true</code>) &rarr; <code>B8G_ARENA_V1</code></div>
      <div>Transport: <code>${options.pipePath}</code> (zero UE5 CEF3 monolith)</div>
    </div>
  </main>
  <script type="module">
    const canvas = document.getElementById('b8g-unreal-viewport');
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#38bdf8';
      ctx.font = '600 20px ui-monospace, monospace';
      ctx.fillText('B8G_ARENA_V1 :: libunreal RHI Ring Ready (0x33564742)', 48, 84);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px ui-monospace, monospace';
      ctx.fillText('Awaiting triple-buffered BGRA8_UNORM frames from native/b8g_unreal_bridge.h', 48, 118);
    }
  </script>
</body>
</html>`;
}

async function resolveVscodeApi(injected?: VscodeApiLike): Promise<VscodeApiLike> {
  if (injected) return injected;
  const mod = (await import('vscode' as string)) as VscodeApiLike;
  return mod;
}

function shellQuote(arg: string): string {
  return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

export async function activate(
  context: ExtensionContextLike,
  injectedVscode?: VscodeApiLike,
): Promise<void> {
  const vscode = await resolveVscodeApi(injectedVscode);

  const ensureToolchain = async (): Promise<UnrealGhostToolchain> => {
    if (cachedToolchain) return cachedToolchain;
    const cfg = vscode.workspace.getConfiguration('unrealGhost');
    const indexUrl = cfg.get<string>('casIndexUrl', B8G_GHOST_CAS_INDEX_URL);
    const index = await fetchCasIndex(indexUrl);
    cachedToolchain = resolveUnrealGhostToolchain(index, process.platform);
    return cachedToolchain;
  };

  const resolveProjectPath = (): string => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    const sep = process.platform === 'win32' ? '\\' : '/';
    return `${folder}${sep}Game.uproject`;
  };

  const runUbt = async (generateCompileCommands: boolean): Promise<void> => {
    try {
      const toolchain = await ensureToolchain();
      const cfg = vscode.workspace.getConfiguration('unrealGhost');
      const engineRoot = cfg.get<string>('engineRoot', '');
      const cacheDir = cfg.get<string>('cacheDir', '.b8g/unreal-ghost');
      const projectPath = resolveProjectPath();
      const config: UbtBuildConfiguration = 'Development';
      const spec = buildUbtCommand(projectPath, 'GameEditor', config, toolchain, {
        ...(engineRoot ? { engineRoot } : {}),
        cacheDir,
        generateCompileCommands,
      });

      const terminal = vscode.window.createTerminal({
        name: generateCompileCommands ? 'Unreal Ghost (clangd DB)' : 'Unreal Ghost (UBT)',
        env: { ...spec.env },
      });
      terminal.show();
      terminal.sendText([spec.command, ...spec.args].map(shellQuote).join(' '));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Unreal Ghost UBT error: ${message}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.hydrateToolchain, async () => {
      try {
        cachedToolchain = null;
        const toolchain = await ensureToolchain();
        const totalMiB = (toolchain.totalBytes / (1024 * 1024)).toFixed(1);
        vscode.window.showInformationMessage(
          `Unreal Ghost hydrated ${toolchain.casTag} (${toolchain.ubtPlatform}): .NET + ghost-llvm + ghost-winsdk + ninja + libsectium_display (${totalMiB} MiB CAS)`,
        );
        return toolchain;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Unreal Ghost hydrate failed: ${message}`);
        return null;
      }
    }),

    vscode.commands.registerCommand(COMMAND_IDS.buildProject, async () => {
      await runUbt(false);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.generateCompileCommands, async () => {
      await runUbt(true);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.openViewport, () => {
      const cfg = vscode.workspace.getConfiguration('unrealGhost');
      const pipePath = cfg.get<string>('viewportPipe', '\\\\.\\pipe\\sectium-dev');
      const panel = vscode.window.createWebviewPanel(
        'unrealGhost.viewport',
        'Unreal Ghost Viewport (B8G_ARENA_V1)',
        1,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      panel.webview.html = createViewportWebviewHtml({
        pipePath,
        ...(cachedToolchain
          ? { sectiumDisplayArtifact: cachedToolchain.sectiumDisplay.filename }
          : {}),
      });
      return panel;
    }),
  );
}

export function deactivate(): void {
  cachedToolchain = null;
}
