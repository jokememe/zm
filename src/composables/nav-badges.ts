/**
 * 侧栏导航徽章：读 live 局面，不读 mock 写死数字。
 */
import type { Disciple, Faction, FieldPlot, UrgentEvent, ViewId } from '@/types/game'
import { navItems as baseNavItems } from '@/data/mock'
import type { NavItem } from '@/types/game'

export interface NavBadgeInput {
  openUrgents: UrgentEvent[]
  fieldPlots: FieldPlot[]
  disciples: Disciple[]
  factions: Faction[]
}

/** 各视图「需关注」数量；0 / 无则不显示徽章 */
export function resolveNavBadge(
  id: ViewId,
  input: NavBadgeInput,
): number | undefined {
  switch (id) {
    case 'hall': {
      const n = input.openUrgents.filter((e) => (e.status ?? 'open') === 'open').length
      return n > 0 ? n : undefined
    }
    case 'fields': {
      const n = input.fieldPlots.filter((f) => f.status === 'harvest').length
      return n > 0 ? n : undefined
    }
    case 'disciples': {
      // 低忠诚 / 叛离风险：需人事介入
      const n = input.disciples.filter(
        (d) =>
          d.status === '叛离风险' ||
          (typeof d.loyalty === 'number' && d.loyalty < 50),
      ).length
      return n > 0 ? n : undefined
    }
    case 'diplomacy': {
      const n = input.factions.filter(
        (f) =>
          f.stance === '敌对' ||
          f.stance === '觊觎' ||
          (typeof f.relation === 'number' && f.relation <= 15),
      ).length
      return n > 0 ? n : undefined
    }
    default:
      return undefined
  }
}

/** 基础 navItems + 动态 badge（去掉 mock 写死） */
export function buildNavItems(input: NavBadgeInput): NavItem[] {
  return baseNavItems.map((item) => {
    const badge = resolveNavBadge(item.id, input)
    const next: NavItem = {
      id: item.id,
      label: item.label,
      icon: item.icon,
      group: item.group,
    }
    if (badge !== undefined) next.badge = badge
    return next
  })
}
