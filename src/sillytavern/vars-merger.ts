import type { VarsPatch } from './types';
import { parseStrictDecimal, resolveRelativeResourceValue } from '@/composables/game-bridge';

/** 宗门经营白名单：与 game-bridge RESOURCE_VAR_MAP 键一致 */
const RESOURCE_KEYS = new Set(['灵石', '灵谷', '丹材', '矿铁', '声望', '气运']);

export function parseVarsBlock(raw: string): VarsPatch {
  const trimmed = raw.trim();
  if (!trimmed) return { merge: {} };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { merge: parsed as Record<string, any> };
    }
    return { merge: {} };
  } catch {
    // 宽松：尝试单引号
    try {
      const repaired = trimmed
        .replace(/'/g, '"')
        .replace(/([{,]\s*)([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*)(\s*:)/g, '$1"$2"$3');
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { merge: parsed as Record<string, any> };
      }
    } catch {
      /* ignore */
    }
    return { merge: {} };
  }
}

/**
 * &lt;vars&gt; JSON 资源键：一律相对叠加（与次 API settle / resolveRelativeResourceValue 一致）。
 * 拒绝 1e2/0x10/对象 等误解析。
 */
export function applyResourceScalar(
  current: unknown,
  incoming: unknown,
): number {
  const cur =
    typeof current === 'number' && Number.isFinite(current)
      ? current
      : Number(current);
  const base = Number.isFinite(cur) ? cur : 0;
  if (typeof incoming === 'number' && Number.isFinite(incoming)) {
    return resolveRelativeResourceValue(base, incoming);
  }
  // 对象/数组/布尔：不改
  if (incoming !== null && typeof incoming === 'object') return base;
  if (typeof incoming === 'boolean') return base;
  const n = parseStrictDecimal(incoming);
  if (n === null) return base;
  return resolveRelativeResourceValue(base, n);
}

export function applyVarsPatch(
  existing: Record<string, any>,
  patch: VarsPatch,
): Record<string, any> {
  const merge = patch?.merge && typeof patch.merge === 'object' ? patch.merge : {};
  // 先处理白名单资源（标量语义）
  const pre: Record<string, any> = { ...existing };
  const rest: Record<string, any> = {};
  for (const [k, v] of Object.entries(merge)) {
    if (RESOURCE_KEYS.has(k)) {
      pre[k] = applyResourceScalar(existing[k], v);
    } else {
      rest[k] = v;
    }
  }
  return deepMerge(pre, rest);
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = out[key];
    if (Array.isArray(sv)) {
      out[key] = [...sv];
    } else if (sv && typeof sv === 'object' && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      out[key] = deepMerge(tv, sv);
    } else {
      out[key] = sv;
    }
  }
  return out;
}
