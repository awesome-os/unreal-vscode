/**
 * Zero-Visual-Studio Unreal Engine 5 toolchain resolver backed by
 * awesome-os/b8g-ghost @ cas-v1.
 *
 * Resolves .NET 11 SDK (for UnrealBuildTool), ghost-llvm, ghost-winsdk,
 * ghost-ninja, libsectium_display, and b8g-ghost-abi directly from the
 * live content-addressed cas-v1 index.
 */

export const B8G_GHOST_CAS_INDEX_URL =
  'https://raw.githubusercontent.com/awesome-os/b8g-ghost/main/manifests/index.json';

export const B8G_GHOST_CAS_TAG = 'cas-v1';

export type UnrealGhostPlatform = 'win32' | 'linux' | 'darwin';

export type UbtBuildConfiguration =
  | 'Debug'
  | 'DebugGame'
  | 'Development'
  | 'Shipping'
  | 'Test';

export interface CasIndexEntry {
  readonly filename: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly download_url: string;
  readonly version?: string;
  readonly category?: string;
  readonly raw_bytes?: number;
}

export interface CasIndexManifest {
  readonly schema: string;
  readonly cas_base_url: string;
  readonly baseline_tag: string;
  readonly updated_at: string;
  readonly total_entries: number;
  readonly entries: Readonly<Record<string, CasIndexEntry>>;
}

export interface ResolvedCasArtifact {
  readonly key: string;
  readonly filename: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly downloadUrl: string;
  readonly version?: string;
  readonly category?: string;
}

export interface UnrealGhostToolchain {
  readonly platform: UnrealGhostPlatform;
  readonly ubtPlatform: 'Win64' | 'Linux' | 'Mac';
  readonly casTag: string;
  readonly dotnetSdk: ResolvedCasArtifact;
  readonly llvm: ResolvedCasArtifact;
  readonly winsdk: ResolvedCasArtifact;
  readonly ninja: ResolvedCasArtifact;
  readonly sectiumDisplay: ResolvedCasArtifact;
  readonly ghostAbi: ResolvedCasArtifact;
  readonly totalBytes: number;
}

export interface UbtCommandOptions {
  readonly engineRoot?: string;
  readonly cacheDir?: string;
  readonly generateCompileCommands?: boolean;
  readonly extraArgs?: readonly string[];
}

export interface UbtCommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly projectPath: string;
  readonly target: string;
  readonly configuration: UbtBuildConfiguration;
  readonly ubtPlatform: 'Win64' | 'Linux' | 'Mac';
  readonly engineRoot: string;
  readonly toolchain: UnrealGhostToolchain;
}

function normalizePlatform(platform?: string): UnrealGhostPlatform {
  if (platform === 'win32' || platform === 'linux' || platform === 'darwin') {
    return platform;
  }
  if (platform === 'Win64' || platform === 'windows') {
    return 'win32';
  }
  if (platform === 'Linux') {
    return 'linux';
  }
  if (platform === 'Mac' || platform === 'macos') {
    return 'darwin';
  }
  return process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin'
      ? 'darwin'
      : 'linux';
}

function toUbtPlatform(platform: UnrealGhostPlatform): 'Win64' | 'Linux' | 'Mac' {
  if (platform === 'win32') return 'Win64';
  if (platform === 'darwin') return 'Mac';
  return 'Linux';
}

function lookupArtifact(
  index: CasIndexManifest,
  preferredKeys: readonly string[],
  fallbackMatcher: (key: string) => boolean,
  label: string,
): ResolvedCasArtifact {
  const entries = index.entries;
  for (const key of preferredKeys) {
    const found = entries[key];
    if (found) {
      return {
        key,
        filename: found.filename,
        sha256: found.sha256,
        bytes: found.bytes,
        downloadUrl: found.download_url,
        ...(found.version !== undefined ? { version: found.version } : {}),
        ...(found.category !== undefined ? { category: found.category } : {}),
      };
    }
  }

  for (const [key, entry] of Object.entries(entries)) {
    if (fallbackMatcher(key)) {
      return {
        key,
        filename: entry.filename,
        sha256: entry.sha256,
        bytes: entry.bytes,
        downloadUrl: entry.download_url,
        ...(entry.version !== undefined ? { version: entry.version } : {}),
        ...(entry.category !== undefined ? { category: entry.category } : {}),
      };
    }
  }

  throw new Error(
    `Missing required b8g-ghost cas-v1 artifact "${label}" (tried: ${preferredKeys.join(', ')})`,
  );
}

/**
 * Fetches the live awesome-os/b8g-ghost cas-v1 manifest index.
 */
export async function fetchCasIndex(
  indexUrl: string = B8G_GHOST_CAS_INDEX_URL,
): Promise<CasIndexManifest> {
  const response = await fetch(indexUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch b8g-ghost cas-v1 index from ${indexUrl}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const manifest = (await response.json()) as CasIndexManifest;
  if (!manifest || typeof manifest.entries !== 'object') {
    throw new Error(`Invalid b8g-ghost cas-v1 manifest returned from ${indexUrl}`);
  }
  return manifest;
}

/**
 * Resolves all zero-Visual-Studio Unreal Engine 5 build & viewport prerequisites
 * from a b8g-ghost cas-v1 manifest index for the requested host platform.
 */
export function resolveUnrealGhostToolchain(
  index: CasIndexManifest,
  platform?: UnrealGhostPlatform | string,
): UnrealGhostToolchain {
  const hostPlatform = normalizePlatform(platform);

  const dotnetSdk = lookupArtifact(
    index,
    hostPlatform === 'win32'
      ? ['dotnet-sdk-win64.tar.zst']
      : ['dotnet-sdk-linux-x64.tar.zst'],
    (k) =>
      k.startsWith('dotnet-sdk-') &&
      (hostPlatform === 'win32' ? k.includes('win64') : k.includes('linux-x64')),
    'dotnet-sdk',
  );

  const llvm = lookupArtifact(
    index,
    hostPlatform === 'win32'
      ? ['ghost-llvm-23.1.6-full-win64.tar.zst']
      : ['ghost-llvm-23.1.6-full-linux-x64.tar.zst'],
    (k) =>
      k.startsWith('ghost-llvm-') &&
      k.includes('full') &&
      (hostPlatform === 'win32' ? k.includes('win64') : k.includes('linux-x64')),
    'ghost-llvm-23.1.6-full',
  );

  const winsdk = lookupArtifact(
    index,
    ['ghost-winsdk-msvc-x64.tar.zst'],
    (k) => k.startsWith('ghost-winsdk-msvc-x64'),
    'ghost-winsdk-msvc-x64',
  );

  const ninja = lookupArtifact(
    index,
    hostPlatform === 'win32'
      ? ['ghost-ninja-1.12.1-win64.zip']
      : hostPlatform === 'darwin'
        ? ['ghost-ninja-1.12.1-macos.zip']
        : ['ghost-ninja-1.12.1-linux-x64.zip'],
    (k) =>
      k.startsWith('ghost-ninja-') &&
      (hostPlatform === 'win32'
        ? k.includes('win64')
        : hostPlatform === 'darwin'
          ? k.includes('macos')
          : k.includes('linux-x64')),
    'ghost-ninja',
  );

  const sectiumDisplay = lookupArtifact(
    index,
    hostPlatform === 'win32'
      ? ['libsectium_display.dll']
      : hostPlatform === 'darwin'
        ? ['libsectium_display-macos-arm64.dylib']
        : ['libsectium_display-linux-x64.so'],
    (k) =>
      k.startsWith('libsectium_display') &&
      (hostPlatform === 'win32'
        ? k.endsWith('.dll')
        : hostPlatform === 'darwin'
          ? k.endsWith('.dylib')
          : k.includes('linux-x64') && k.endsWith('.so')),
    'libsectium_display',
  );

  const ghostAbi = lookupArtifact(
    index,
    hostPlatform === 'win32'
      ? ['b8g-ghost-abi-win64.node']
      : hostPlatform === 'darwin'
        ? ['b8g-ghost-abi-macos-arm64.node']
        : ['b8g-ghost-abi-linux-x64.node'],
    (k) =>
      k.startsWith('b8g-ghost-abi-') &&
      (hostPlatform === 'win32'
        ? k.includes('win64')
        : hostPlatform === 'darwin'
          ? k.includes('macos')
          : k.includes('linux-x64')),
    'b8g-ghost-abi',
  );

  const totalBytes =
    dotnetSdk.bytes +
    llvm.bytes +
    winsdk.bytes +
    ninja.bytes +
    sectiumDisplay.bytes +
    ghostAbi.bytes;

  return {
    platform: hostPlatform,
    ubtPlatform: toUbtPlatform(hostPlatform),
    casTag: B8G_GHOST_CAS_TAG,
    dotnetSdk,
    llvm,
    winsdk,
    ninja,
    sectiumDisplay,
    ghostAbi,
    totalBytes,
  };
}

function joinPath(isWin: boolean, ...segments: string[]): string {
  const sep = isWin ? '\\' : '/';
  return segments
    .map((s, i) => (i === 0 ? s.replace(/[\\/]+$/, '') : s.replace(/^[\\/]+|[\\/]+$/g, '')))
    .filter((s) => s.length > 0)
    .join(sep);
}

/**
 * Constructs a zero-Visual-Studio UnrealBuildTool invocation wired to the
 * hydrated b8g-ghost .NET 11 SDK, ghost-llvm (Clang), ghost-winsdk, and ghost-ninja.
 */
export function buildUbtCommand(
  projectPath: string,
  target: string,
  config: UbtBuildConfiguration,
  toolchain: UnrealGhostToolchain,
  options: UbtCommandOptions = {},
): UbtCommandSpec {
  const isWin = toolchain.platform === 'win32';
  const engineRoot =
    options.engineRoot ||
    (isWin ? 'C:\\Program Files\\Epic Games\\UE_5.5' : '/opt/UnrealEngine');
  const cacheDir =
    options.cacheDir ||
    (isWin ? '.b8g\\unreal-ghost' : '.b8g/unreal-ghost');

  const dotnetRoot = joinPath(isWin, cacheDir, 'dotnet-sdk');
  const llvmRoot = joinPath(isWin, cacheDir, 'ghost-llvm');
  const winsdkRoot = joinPath(isWin, cacheDir, 'ghost-winsdk');
  const ninjaRoot = joinPath(isWin, cacheDir, 'ghost-ninja');
  const sectiumDir = joinPath(isWin, cacheDir, 'sectium');

  const dotnetExe = joinPath(isWin, dotnetRoot, isWin ? 'dotnet.exe' : 'dotnet');
  const ninjaExe = joinPath(isWin, ninjaRoot, isWin ? 'ninja.exe' : 'ninja');
  const ubtDll = joinPath(
    isWin,
    engineRoot,
    'Engine',
    'Binaries',
    'DotNET',
    'UnrealBuildTool',
    'UnrealBuildTool.dll',
  );

  const args: string[] = [
    ubtDll,
    target,
    toolchain.ubtPlatform,
    config,
    `-Project=${projectPath}`,
    '-Compiler=Clang',
    '-Progress',
    '-NoHotReloadFromIDE',
  ];

  if (options.generateCompileCommands) {
    args.push('-Mode=GenerateClangDatabase');
  }

  if (options.extraArgs && options.extraArgs.length > 0) {
    args.push(...options.extraArgs);
  }

  const env: Record<string, string> = {
    DOTNET_ROOT: dotnetRoot,
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    LLVM_HOME: llvmRoot,
    B8G_GHOST_CAS_TAG: toolchain.casTag,
    B8G_LLVM_SHA256: toolchain.llvm.sha256,
    B8G_DOTNET_SHA256: toolchain.dotnetSdk.sha256,
    B8G_WINSDK_ROOT: winsdkRoot,
    B8G_WINSDK_SHA256: toolchain.winsdk.sha256,
    B8G_NINJA_EXE: ninjaExe,
    B8G_SECTIUM_DISPLAY_LIB: joinPath(isWin, sectiumDir, toolchain.sectiumDisplay.filename),
    B8G_GHOST_ABI_NODE: joinPath(isWin, sectiumDir, toolchain.ghostAbi.filename),
    UE_USE_GHOST_CLANG: '1',
    UE_ZERO_VISUAL_STUDIO: '1',
  };

  if (isWin) {
    env.WindowsSdkDir = joinPath(true, winsdkRoot, 'Windows Kits', '10');
    env.VCToolsInstallDir = joinPath(true, winsdkRoot, 'VC', 'Tools', 'MSVC');
    env.CC = joinPath(true, llvmRoot, 'bin', 'clang-cl.exe');
    env.CXX = joinPath(true, llvmRoot, 'bin', 'clang-cl.exe');
  } else {
    env.CC = joinPath(false, llvmRoot, 'bin', 'clang');
    env.CXX = joinPath(false, llvmRoot, 'bin', 'clang++');
  }

  return {
    command: dotnetExe,
    args,
    env,
    projectPath,
    target,
    configuration: config,
    ubtPlatform: toolchain.ubtPlatform,
    engineRoot,
    toolchain,
  };
}
