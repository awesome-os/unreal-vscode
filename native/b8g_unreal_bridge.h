/**
 * @file b8g_unreal_bridge.h
 * @brief 100% MIT C11/C++20 zero-copy B8G_ARENA_V1 RHI framebuffer bridge for
 *        Unreal Engine 5 projects compiled as libunreal (bShouldCompileAsDLL = true).
 *
 * Allows any Epic-licensed UE5 project to render directly into libsectium_display,
 * Awesome-OS Code - OSS, or Eclipse Theia over a 64-byte-aligned triple-buffered
 * shared memory ring without embedding UE5's legacy CEF3 web-browser monolith.
 *
 * SPDX-License-Identifier: MIT
 */

#ifndef B8G_UNREAL_BRIDGE_H
#define B8G_UNREAL_BRIDGE_H

#include <stddef.h>
#include <stdint.h>

#if defined(__cplusplus)
#include <atomic>
#define B8G_ALIGNAS(n) alignas(n)
#define B8G_STATIC_ASSERT(cond, msg) static_assert(cond, msg)
#define B8G_ATOMIC_U32 std::atomic<uint32_t>
#define B8G_ATOMIC_U64 std::atomic<uint64_t>
extern "C" {
#else
#include <stdalign.h>
#include <stdatomic.h>
#define B8G_ALIGNAS(n) _Alignas(n)
#define B8G_STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)
#define B8G_ATOMIC_U32 _Atomic uint32_t
#define B8G_ATOMIC_U64 _Atomic uint64_t
#endif

/** Canonical B8G UniversalABI v3 magic ("BGV3"). */
#define B8G_ABI_MAGIC_V3 0x33564742u

/** Cache-line alignment invariant for all B8G_ARENA_V1 headers and ring slots. */
#define B8G_ARENA_V1_ALIGNMENT 64u

/** Bridge wire protocol version. */
#define B8G_UNREAL_BRIDGE_VERSION 1u

/** Triple-buffered RHI swapchain ring depth. */
#define B8G_UNREAL_RING_SLOTS 3u

/** Pixel formats supported between UE5 RHI backbuffer and libsectium_display. */
typedef enum B8gUnrealPixelFormat {
  B8G_PIXEL_FORMAT_UNKNOWN = 0,
  B8G_PIXEL_FORMAT_BGRA8_UNORM = 1,
  B8G_PIXEL_FORMAT_RGBA8_UNORM = 2,
  B8G_PIXEL_FORMAT_RGBA16_FLOAT = 3
} B8gUnrealPixelFormat;

/** Input event kinds forwarded from Code - OSS / Theia into libunreal. */
typedef enum B8gUnrealInputKind {
  B8G_INPUT_NONE = 0,
  B8G_INPUT_RESIZE = 1,
  B8G_INPUT_POINTER_MOVE = 2,
  B8G_INPUT_POINTER_BUTTON = 3,
  B8G_INPUT_KEY = 4,
  B8G_INPUT_WHEEL = 5
} B8gUnrealInputKind;

/** 64-byte-aligned metadata descriptor for a single RHI framebuffer slot. */
typedef struct B8gUnrealFrameSlot {
  B8G_ALIGNAS(64) uint64_t frame_index;
  uint64_t timestamp_ns;
  uint64_t pixel_offset_bytes;
  uint64_t pixel_size_bytes;
  uint32_t width;
  uint32_t height;
  uint32_t stride_bytes;
  uint32_t pixel_format;
  uint32_t flags;
  uint32_t reserved[3];
} B8gUnrealFrameSlot;

B8G_STATIC_ASSERT(sizeof(B8gUnrealFrameSlot) == 64u,
                  "B8gUnrealFrameSlot must be exactly one 64-byte cache line");

/** 64-byte-aligned B8G_ARENA_V1 control header placed at offset 0 of shared memory. */
typedef struct B8gUnrealArenaHeaderV1 {
  B8G_ALIGNAS(64) uint32_t magic;
  uint32_t version;
  uint32_t ring_slots;
  uint32_t header_bytes;
  uint64_t total_arena_bytes;
  B8G_ATOMIC_U32 write_slot;
  B8G_ATOMIC_U32 read_slot;
  B8G_ATOMIC_U64 published_frames;
  uint32_t viewport_width;
  uint32_t viewport_height;
  uint32_t target_pixel_format;
  uint32_t host_flags;
  uint32_t reserved[2];
} B8gUnrealArenaHeaderV1;

B8G_STATIC_ASSERT(sizeof(B8gUnrealArenaHeaderV1) == 64u,
                  "B8gUnrealArenaHeaderV1 must be exactly one 64-byte cache line");

/** Complete 256-byte-aligned B8G_ARENA_V1 viewport ring prefix (header + 3 slots). */
typedef struct B8gUnrealViewportRing {
  B8G_ALIGNAS(64) B8gUnrealArenaHeaderV1 header;
  B8gUnrealFrameSlot slots[B8G_UNREAL_RING_SLOTS];
} B8gUnrealViewportRing;

B8G_STATIC_ASSERT(sizeof(B8gUnrealViewportRing) == 256u,
                  "B8gUnrealViewportRing must be exactly 256 bytes (4 cache lines)");

/** Bidirectional input packet sent from the IDE viewport into libunreal. */
typedef struct B8gUnrealInputEvent {
  B8G_ALIGNAS(64) uint32_t kind;
  uint32_t modifiers;
  int32_t x;
  int32_t y;
  int32_t dx;
  int32_t dy;
  uint32_t key_or_button;
  uint32_t pressed;
  uint64_t timestamp_ns;
  uint32_t reserved[6];
} B8gUnrealInputEvent;

B8G_STATIC_ASSERT(sizeof(B8gUnrealInputEvent) == 64u,
                  "B8gUnrealInputEvent must be exactly one 64-byte cache line");

/** Initializes a B8G_ARENA_V1 viewport ring in zeroed shared memory. */
static inline int b8g_unreal_ring_init(
    B8gUnrealViewportRing* ring,
    uint64_t total_arena_bytes,
    uint32_t width,
    uint32_t height,
    uint32_t pixel_format) {
  if (!ring || total_arena_bytes < sizeof(B8gUnrealViewportRing)) {
    return -1;
  }
  ring->header.magic = B8G_ABI_MAGIC_V3;
  ring->header.version = B8G_UNREAL_BRIDGE_VERSION;
  ring->header.ring_slots = B8G_UNREAL_RING_SLOTS;
  ring->header.header_bytes = (uint32_t)sizeof(B8gUnrealViewportRing);
  ring->header.total_arena_bytes = total_arena_bytes;
  ring->header.viewport_width = width;
  ring->header.viewport_height = height;
  ring->header.target_pixel_format = pixel_format;
  ring->header.host_flags = 0u;
#if defined(__cplusplus)
  ring->header.write_slot.store(0u, std::memory_order_relaxed);
  ring->header.read_slot.store(0u, std::memory_order_relaxed);
  ring->header.published_frames.store(0u, std::memory_order_release);
#else
  atomic_store_explicit(&ring->header.write_slot, 0u, memory_order_relaxed);
  atomic_store_explicit(&ring->header.read_slot, 0u, memory_order_relaxed);
  atomic_store_explicit(&ring->header.published_frames, 0u, memory_order_release);
#endif
  return 0;
}

/** Validates B8G_ABI_MAGIC_V3 and ring geometry invariants. */
static inline int b8g_unreal_ring_validate(const B8gUnrealViewportRing* ring) {
  if (!ring) {
    return 0;
  }
  return ring->header.magic == B8G_ABI_MAGIC_V3 &&
         ring->header.version == B8G_UNREAL_BRIDGE_VERSION &&
         ring->header.ring_slots == B8G_UNREAL_RING_SLOTS &&
         ring->header.header_bytes == (uint32_t)sizeof(B8gUnrealViewportRing);
}

/** Returns the next writable slot index for the UE5 RHI render thread. */
static inline uint32_t b8g_unreal_ring_acquire_write_slot(
    const B8gUnrealViewportRing* ring) {
#if defined(__cplusplus)
  uint32_t current = ring->header.write_slot.load(std::memory_order_acquire);
#else
  uint32_t current = atomic_load_explicit(&ring->header.write_slot, memory_order_acquire);
#endif
  return (current + 1u) % B8G_UNREAL_RING_SLOTS;
}

/** Publishes a completed UE5 RHI frame slot to libsectium_display. */
static inline uint64_t b8g_unreal_ring_publish_frame(
    B8gUnrealViewportRing* ring,
    uint32_t slot_index) {
  uint32_t clamped = slot_index % B8G_UNREAL_RING_SLOTS;
#if defined(__cplusplus)
  ring->header.write_slot.store(clamped, std::memory_order_relaxed);
  ring->header.read_slot.store(clamped, std::memory_order_release);
  return ring->header.published_frames.fetch_add(1u, std::memory_order_acq_rel) + 1u;
#else
  atomic_store_explicit(&ring->header.write_slot, clamped, memory_order_relaxed);
  atomic_store_explicit(&ring->header.read_slot, clamped, memory_order_release);
  return atomic_fetch_add_explicit(&ring->header.published_frames, 1u, memory_order_acq_rel) + 1u;
#endif
}

/** Optional C ABI symbols exported by a UE5 target built with bShouldCompileAsDLL = true. */
typedef int (*b8g_libunreal_attach_fn)(B8gUnrealViewportRing* ring, const char* uproject_path);
typedef int (*b8g_libunreal_tick_fn)(double delta_seconds);
typedef int (*b8g_libunreal_push_input_fn)(const B8gUnrealInputEvent* event);
typedef void (*b8g_libunreal_detach_fn)(void);

#if defined(__cplusplus)
}
#endif

#endif /* B8G_UNREAL_BRIDGE_H */
