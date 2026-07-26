/**
 * 记忆标签检测（轻量，从原 table-memory 提取）。
 * 仅保留「是否存在记忆标签」的检测能力，供天机推演判断；
 * 不再写入任何填表系统（填表记忆已移除）。
 * 角色近事的实际摄入由 memory-graph.ingestMemoryTag 处理。
 */
const MEMORY_TAG_PATTERN =
  /<(Memory|GaigaiMemory|memory|tableEdit|gaigaimemory|tableedit)>([\s\S]*?)<\/\1>/gi

export function hasMemoryTag(text: string): boolean {
  MEMORY_TAG_PATTERN.lastIndex = 0
  return MEMORY_TAG_PATTERN.test(String(text || ''))
}
