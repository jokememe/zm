/**
 * Variable System Utilities
 */

import type { ChatSession, ParsedTags } from './types';
import type { ParserEvent } from './stream-parser';
import { parseVarsBlock, applyVarsPatch } from './vars-merger';
import { parseStrictDecimal, resolveNumericValue } from '@/composables/game-bridge';

/**
 * 解析 &lt;var name="…" value="…" /&gt;。
 * 保留 "+10"/"-5" 为字符串（相对变化）；裸严格十进制转 number；空/非法忽略。
 */
export function extractVariables(text: string): { cleanedText: string; updates: Record<string, string | number> } {
  const updates: Record<string, string | number> = {};
  const regex = /<var\s+name="([^"]+)"\s+value="([^"]*)"\s*\/?>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [, name, rawValue] = match;
    const s = String(rawValue).trim().replace(/^[−–—]/, '-');
    if (!name || s === '') continue;
    // 显式相对写法必须保留字符串
    if (/^[+-](?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) {
      updates[name] = s;
      continue;
    }
    const num = parseStrictDecimal(s);
    if (num !== null) {
      updates[name] = num;
      continue;
    }
    // 非白名单自定义键可保留原文；资源键 junk 由 merge 忽略
    updates[name] = rawValue;
  }
  const cleanedText = text.replace(regex, '').replace(/\n{2,}/g, '\n').trim();
  return { cleanedText, updates };
}

/**
 * 合并会话变量。对宗门白名单资源键走 resolveNumericValue（与气数簿一致）。
 * junk / 1e2 / 0x10 不改库存。非白名单键浅覆盖。
 */
export function mergeVariables(
  base: Record<string, string | number> = {},
  updates: Record<string, string | number> = {}
): Record<string, string | number> {
  const RESOURCE_KEYS = new Set(['灵石', '灵谷', '丹材', '矿铁', '声望', '气运']);
  const out: Record<string, string | number> = { ...base };
  for (const [k, v] of Object.entries(updates)) {
    if (!RESOURCE_KEYS.has(k)) {
      out[k] = v;
      continue;
    }
    const cur = Number(base[k]);
    const current = Number.isFinite(cur) ? cur : 0;
    out[k] = resolveNumericValue(current, v as string | number);
  }
  return out;
}

export function formatVariablesForPrompt(variables: Record<string, string | number>): string {
  const entries = Object.entries(variables);
  if (entries.length === 0) return '';
  const lines = entries.map(([k, v]) => `${k}: ${v}`);
  return `[当前状态]\n${lines.join('\n')}`;
}

export const USER_ROLE = 'user' as const;

/** Truncate chat at message index and restore variables from the last remaining message (or provided snapshot). */
export function truncateChatAt(
  chat: ChatSession,
  index: number,
  variables?: Record<string, string | number>
): ChatSession {
  const truncated = chat.messages.slice(0, index);
  const restoredVars = variables ?? truncated[truncated.length - 1]?.variables ?? {};
  return { ...chat, messages: truncated, variables: restoredVars, updatedAt: Date.now() };
}

/** Create a branched chat session from a message index (inclusive). */
export function branchChat(
  source: ChatSession,
  index: number,
  options: {
    name: string;
    presetId: string | null;
    lorebookIds: string[];
    variables?: Record<string, string | number>;
  }
): ChatSession {
  return {
    id: crypto.randomUUID(),
    name: options.name,
    messages: source.messages.slice(0, index + 1).map(m => ({ ...m })),
    characterName: source.characterName,
    userName: source.userName,
    presetId: options.presetId,
    lorebookIds: [...options.lorebookIds],
    variables: options.variables ?? source.messages[index].variables ?? {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ========== v3: stream parser event aggregation ==========

export function aggregateEvents(events: ParserEvent[]): ParsedTags {
  const parsed: ParsedTags = {
    thinking: '',
    maintext: '',
    options: [],
    sum: '',
    varsRaw: '',
    varsCommands: { merge: {} },
    unknown: {},
  };
  for (const ev of events) {
    if (ev.type === 'tag-close') {
      if (ev.tag === 'thinking' || ev.tag === 'think') parsed.thinking = ev.full;
      else if (ev.tag === 'maintext') parsed.maintext = ev.full;
      else if (ev.tag === 'sum') parsed.sum = ev.full;
      else if (ev.tag === 'vars') {
        parsed.varsRaw = ev.full;
        parsed.varsCommands = parseVarsBlock(ev.full);
      } else if (ev.tag === 'option') {
        // option-line events accumulate options below
      } else {
        parsed.unknown[ev.tag] = ev.full;
      }
    } else if (ev.type === 'option-line') {
      parsed.options.push(ev.line);
    }
  }
  return parsed;
}

export function applyParsedToChat(
  current: Record<string, any>,
  parsed: ParsedTags,
): { nextVariables: Record<string, any>; snapshot: Record<string, any> } {
  const next = applyVarsPatch(current, parsed.varsCommands);
  const snapshot = JSON.parse(JSON.stringify(next));
  return { nextVariables: next, snapshot };
}
