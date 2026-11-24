import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  activate,
  COMMAND_IDS,
  createViewportWebviewHtml,
  deactivate,
  type ExtensionContextLike,
  type VscodeApiLike,
} from '../src/extension.mts';
import {
  buildUbtCommand,
  fetchCasIndex,
  resolveUnrealGhostToolchain,
  type CasIndexManifest,
} from '../src/toolchain.mts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

let liveIndexPromise: Promise<CasIndexManifest> | null = null;
function getLiveCasIndex(): Promise<CasIndexManifest> {
  if (!liveIndexPromise) {
    liveIndexPromise = fetchCasIndex();
  }
  return liveIndexPromise;
}

function resolveZigCommand(): { bin: string; baseArgs: string[] } {
  const candidates = [
    process.env.ZIG_BIN,
    process.platform === 'win32' ? 'e:\\awesome-os\\bin\\zig.cmd' : undefined,
    'zig',
  ].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (existsSync(candidate)) {
        return { bin: candidate, baseArgs: [] };
      }
      continue;
    }
    try {
      execFileSync(candidate, ['version'], { stdio: 'pipe' });
      return { bin: candidate, baseArgs: [] };
    } catch {
      // try next candidate
    }
  }
  throw new Error('zig compiler not found in PATH or e:\\awesome-os\\bin\\zig.cmd');
}

test('live cas-v1 index resolves all Win64 UE5 zero-VS prerequisites', async () => {
  const index = await getLiveCasIndex();
  assert.ok(index.cas_base_url.includes('cas-v1'), 'cas_base_url targets cas-v1');

  const tc = resolveUnrealGhostToolchain(index, 'win32');
  assert.equal(tc.casTag, 'cas-v1');
  assert.equal(tc.platform, 'win32');
  assert.equal(tc.ubtPlatform, 'Win64');

  assert.equal(tc.dotnetSdk.key, 'dotnet-sdk-win64.tar.zst');
  assert.match(tc.llvm.key, /^ghost-llvm-23\.1\.6-full-win64/);
  assert.equal(tc.winsdk.key, 'ghost-winsdk-msvc-x64.tar.zst');
  assert.match(tc.ninja.key, /^ghost-ninja-.*-win64/);
  assert.equal(tc.sectiumDisplay.key, 'libsectium_display.dll');
  assert.equal(tc.ghostAbi.key, 'b8g-ghost-abi-win64.node');

  for (const artifact of [
    tc.dotnetSdk,
    tc.llvm,
    tc.winsdk,
    tc.ninja,
    tc.sectiumDisplay,
    tc.ghostAbi,
  ]) {
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/, `valid sha256 for ${artifact.key}`);
    assert.ok(artifact.bytes > 0, `positive byte size for ${artifact.key}`);
    assert.ok(
      artifact.downloadUrl.includes('/awesome-os/b8g-ghost/releases/download/cas-v1/'),
      `cas-v1 download URL for ${artifact.key}`,
    );
  }
});

test('live cas-v1 index resolves all Linux x64 UE5 zero-VS prerequisites', async () => {
  const index = await getLiveCasIndex();
  const tc = resolveUnrealGhostToolchain(index, 'linux');
  assert.equal(tc.platform, 'linux');
  assert.equal(tc.ubtPlatform, 'Linux');

  assert.equal(tc.dotnetSdk.key, 'dotnet-sdk-linux-x64.tar.zst');
  assert.match(tc.llvm.key, /^ghost-llvm-23\.1\.6-full-linux-x64/);
  assert.equal(tc.winsdk.key, 'ghost-winsdk-msvc-x64.tar.zst');
  assert.match(tc.ninja.key, /^ghost-ninja-.*-linux-x64/);
  assert.equal(tc.sectiumDisplay.key, 'libsectium_display-linux-x64.so');
  assert.equal(tc.ghostAbi.key, 'b8g-ghost-abi-linux-x64.node');
  assert.ok(tc.totalBytes > 100_000_000);
});

test('buildUbtCommand() emits zero-VS UBT command and clangd database mode', async () => {
  const index = await getLiveCasIndex();
  const winToolchain = resolveUnrealGhostToolchain(index, 'win32');

  const buildSpec = buildUbtCommand(
    'D:\\Projects\\Lyra\\Lyra.uproject',
    'LyraEditor',
    'Development',
    winToolchain,
    { engineRoot: 'D:\\UE_5.5', cacheDir: 'D:\\.b8g\\unreal-ghost' },
  );

  assert.equal(buildSpec.command, 'D:\\.b8g\\unreal-ghost\\dotnet-sdk\\dotnet.exe');
  assert.equal(
    buildSpec.args[0],
    'D:\\UE_5.5\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool.dll',
  );
  assert.ok(buildSpec.args.includes('LyraEditor'));
  assert.ok(buildSpec.args.includes('Win64'));
  assert.ok(buildSpec.args.includes('Development'));
  assert.ok(buildSpec.args.includes('-Project=D:\\Projects\\Lyra\\Lyra.uproject'));
  assert.ok(buildSpec.args.includes('-Compiler=Clang'));
  assert.equal(buildSpec.env.UE_ZERO_VISUAL_STUDIO, '1');
  assert.equal(buildSpec.env.B8G_LLVM_SHA256, winToolchain.llvm.sha256);
  assert.equal(buildSpec.env.B8G_WINSDK_SHA256, winToolchain.winsdk.sha256);
  assert.match(buildSpec.env.CC, /clang-cl\.exe$/);

  const clangDbSpec = buildUbtCommand(
    '/work/Lyra/Lyra.uproject',
    'LyraEditor',
    'DebugGame',
    resolveUnrealGhostToolchain(index, 'linux'),
    { engineRoot: '/opt/UE_5.5', generateCompileCommands: true },
  );
  assert.ok(clangDbSpec.args.includes('-Mode=GenerateClangDatabase'));
  assert.ok(clangDbSpec.args.includes('Linux'));
  assert.match(clangDbSpec.env.CXX, /clang\+\+$/);
});

test('package.json defines valid Open VSX / VS Code unreal-ghost contributions', () => {
  const pkgPath = resolve(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    name: string;
    publisher: string;
    type: string;
    engines: { vscode: string; node: string };
    contributes: {
      commands: Array<{ command: string; title: string }>;
      taskDefinitions: Array<{ type: string }>;
    };
  };

  assert.equal(pkg.name, 'unreal-ghost');
  assert.equal(pkg.publisher, 'awesome-os');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.vscode, '^1.85.0');
  assert.equal(pkg.engines.node, '>=22.18.0');

  const commandIds = pkg.contributes.commands.map((c) => c.command);
  assert.deepEqual(commandIds, [
    'unrealGhost.hydrateToolchain',
    'unrealGhost.buildProject',
    'unrealGhost.generateCompileCommands',
    'unrealGhost.openViewport',
  ]);

  assert.ok(pkg.contributes.taskDefinitions.some((t) => t.type === 'unreal-ghost'));
});

test('extension activate() registers all 4 commands and renders B8G_ARENA_V1 viewport HTML', async () => {
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  let renderedHtml = '';

  const mockVscode: VscodeApiLike = {
    commands: {
      registerCommand(id, cb) {
        registered.set(id, cb);
        return { dispose() {} };
      },
    },
    window: {
      showInformationMessage() {},
      showErrorMessage() {},
      createWebviewPanel(_viewType, _title, _column) {
        const panel = {
          webview: {
            get html() {
              return renderedHtml;
            },
            set html(value: string) {
              renderedHtml = value;
            },
          },
          dispose() {},
        };
        return panel;
      },
      createTerminal() {
        return { show() {}, sendText() {} };
      },
    },
    workspace: {
      getConfiguration() {
        return {
          get<T>(_section: string, defaultValue?: T): T {
            return defaultValue as T;
          },
        };
      },
    },
  };

  const context: ExtensionContextLike = { subscriptions: [] };
  await activate(context, mockVscode);

  assert.equal(registered.size, 4);
  for (const id of Object.values(COMMAND_IDS)) {
    assert.ok(registered.has(id), `registered command ${id}`);
  }

  const openViewport = registered.get(COMMAND_IDS.openViewport);
  assert.ok(openViewport);
  openViewport();

  assert.ok(renderedHtml.includes('B8G_ARENA_V1'));
  assert.ok(renderedHtml.includes('0x33564742'));
  assert.ok(renderedHtml.includes('libunreal'));
  assert.ok(renderedHtml.includes('libsectium_display'));

  const directHtml = createViewportWebviewHtml({
    pipePath: '/tmp/sectium-dev.sock',
    projectName: 'Lyra',
  });
  assert.ok(directHtml.includes('Lyra'));
  assert.ok(directHtml.includes('/tmp/sectium-dev.sock'));

  deactivate();
});

test('native/b8g_unreal_bridge.h compiles cleanly with zig cc (C11) and zig c++ (C++20)', () => {
  const headerPath = resolve(REPO_ROOT, 'native', 'b8g_unreal_bridge.h');
  assert.ok(existsSync(headerPath), 'native/b8g_unreal_bridge.h exists');

  const { bin, baseArgs } = resolveZigCommand();
  const isCmd = process.platform === 'win32' && bin.toLowerCase().endsWith('.cmd');

  const runZig = (args: string[]): void => {
    if (isCmd) {
      execFileSync('cmd.exe', ['/d', '/s', '/c', bin, ...baseArgs, ...args], {
        stdio: 'pipe',
      });
    } else {
      execFileSync(bin, [...baseArgs, ...args], { stdio: 'pipe' });
    }
  };

  const workDir = mkdtempSync(join(tmpdir(), 'unreal-ghost-zig-'));
  try {
    runZig([
      'cc',
      '-std=c11',
      '-x',
      'c',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-Wno-unused-function',
      '-c',
      '-o',
      join(workDir, 'bridge_c11.o'),
      headerPath,
    ]);
    runZig([
      'c++',
      '-std=c++20',
      '-x',
      'c++',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-Wno-unused-function',
      '-c',
      '-o',
      join(workDir, 'bridge_cpp20.o'),
      headerPath,
    ]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
