# `awesome-os/unreal-vscode` (`unreal-ghost`)

MIT Unreal Engine 5 extension for **Awesome-OS Code - OSS** & **Eclipse Theia** — zero-Visual-Studio `UnrealBuildTool` (UBT) builds powered by **`awesome-os/b8g-ghost @ cas-v1`** (`.NET 11` + `ghost-llvm` + `ghost-winsdk` + `ghost-ninja`) plus a 64-byte-aligned **`B8G_ARENA_V1`** `libunreal` viewport bridge.

## Zero-Visual-Studio UE5 Architecture

Instead of installing a 30+ GB Visual Studio IDE or embedding UE5's legacy CEF3 web-browser monolith, `unreal-ghost` resolves every build and display prerequisite directly from the content-addressed [`awesome-os/b8g-ghost`](https://github.com/awesome-os/b8g-ghost) `cas-v1` release:

| Prerequisite | Win64 (`cas-v1`) | Linux x64 (`cas-v1`) | Purpose |
| :--- | :--- | :--- | :--- |
| **.NET 11 SDK** | `dotnet-sdk-win64.tar.zst` | `dotnet-sdk-linux-x64.tar.zst` | Runs `UnrealBuildTool.dll` directly |
| **LLVM / Clang** | `ghost-llvm-23.1.6-full-win64.tar.zst` | `ghost-llvm-23.1.6-full-linux-x64.tar.zst` | `clang-cl` / `clang++` + `lld` + `clangd` |
| **WinSDK + MSVC Headers/Libs** | `ghost-winsdk-msvc-x64.tar.zst` | `ghost-winsdk-msvc-x64.tar.zst` | Zero-VS Windows SDK & CRT import libs |
| **Ninja** | `ghost-ninja-1.12.1-win64.zip` | `ghost-ninja-1.12.1-linux-x64.zip` | Fast incremental build graph execution |
| **Sectium Display** | `libsectium_display.dll` | `libsectium_display-linux-x64.so` | Pure-art display sink for IDE viewport |
| **Ghost ABI Bridge** | `b8g-ghost-abi-win64.node` | `b8g-ghost-abi-linux-x64.node` | Native N-API bridge for `B8G_ARENA_V1` |

## Commands & Tasks

- `unrealGhost.hydrateToolchain` — Resolves and verifies all `cas-v1` SHA-256 artifacts for the host OS.
- `unrealGhost.buildProject` — Launches `UnrealBuildTool.dll` with `-Compiler=Clang` and zero Visual Studio dependencies.
- `unrealGhost.generateCompileCommands` — Runs UBT `-Mode=GenerateClangDatabase` for instant `clangd` IntelliSense in Code - OSS / Theia.
- `unrealGhost.openViewport` — Opens the `B8G_ARENA_V1` (`B8G_ABI_MAGIC_V3 = 0x33564742`) Webview panel attached to `libunreal`.
- Task Definition type: `unreal-ghost`.

## `libunreal` -> `B8G_ARENA_V1` Native Bridge (`native/b8g_unreal_bridge.h`)

Any Epic-licensed UE5 project compiled with `bShouldCompileAsDLL = true` (`libunreal`) can include the single-header MIT C11/C++20 header [`native/b8g_unreal_bridge.h`](native/b8g_unreal_bridge.h) to publish triple-buffered RHI frames directly into a 64-byte-aligned `B8G_ARENA_V1` shared-memory ring (`B8G_ABI_MAGIC_V3 = 0x33564742`) consumed by `libsectium_display`, Awesome-OS Code - OSS, or Eclipse Theia — with zero UE5 CEF3 monolith.

## Verification

```bash
node --test test/unreal-vscode.test.mts
```

## License & Epic Games EULA Compliance

- This repository is **100% MIT-licensed** (`LICENSE`).
- It ships **only** MIT-licensed TypeScript extension tooling, `b8g-ghost` CAS manifest resolution, and the MIT C/C++ `native/b8g_unreal_bridge.h` ABI header.
- **Zero proprietary Unreal Engine 5 binaries, libraries, headers, or source files are included or redistributed.** Users supply their own Epic-licensed Unreal Engine 5 installation via `unrealGhost.engineRoot`.
