/**
 * 打印分页：按纸型把下单汇总表切成「每页固定行数」的打印页。
 *
 * 设计约束（对应业务要求）：
 * - 最小不可分单元是一个号型档（一行 OrderSheetItem = 号型 × 性别 × 类型 × 数量），
 *   分页只允许落在行与行之间，因此同一个号型绝不会被拆到两页；
 * - 切分直接消费导出/屏显共用的 orderSheet.items，不另造数据，
 *   所以页面预览、打印稿、Excel/CSV 的行数与逐行内容必然一致；
 * - 每页能放多少行完全由纸型（可用高度）推导，切换纸型后重新调用
 *   paginateForPaper 即得到全新分页结果；
 * - 首页要放标题 + 项目信息，续页只有窄续页头，末页还要留出合计行、
 *   制表/厂方确认/日期签栏与页脚，因此四种页面容量分别计算：
 *   single（仅一页时）/ first（首页）/ next（中间续页）/ last（末页）。
 *
 * 行高与各区块高度全部按毫米给定，与 @page 的尺寸同一单位，避免 px/mm
 * 混用导致的半行溢出。数值偏保守，保证浏览器 100% 比例打印时不溢页。
 */
import type { OrderSheetItem } from './exporter'

export type PaperSizeId = 'A4' | 'A3' | 'B5' | 'K16'
export type OrientationId = 'portrait' | 'landscape'
export type PrintPaperId = `${PaperSizeId}-${OrientationId}`

export interface PrintPaper {
  id: PrintPaperId
  label: string
  widthMm: number
  /** 纵向摆放时纸张短边 × 长边 */
  heightMm: number
}

interface PaperSizeDef {
  id: PaperSizeId
  label: string
  widthMm: number
  heightMm: number
}

const PAPER_SIZE_DEFS: PaperSizeDef[] = [
  { id: 'A4', label: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'A3', label: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'B5', label: 'B5（ISO）', widthMm: 176, heightMm: 250 },
  { id: 'K16', label: '16 开', widthMm: 184, heightMm: 260 }
]

const ORIENTATION_LABEL: Record<OrientationId, string> = {
  portrait: '纵向',
  landscape: '横向'
}

function buildPaper(def: PaperSizeDef, orientation: OrientationId): PrintPaper {
  const portrait = orientation === 'portrait'
  const widthMm = portrait ? def.widthMm : def.heightMm
  const heightMm = portrait ? def.heightMm : def.widthMm
  return {
    id: `${def.id}-${orientation}`,
    label: `${def.label} ${ORIENTATION_LABEL[orientation]}（${widthMm} × ${heightMm} mm）`,
    widthMm,
    heightMm
  }
}

/** 可选纸型：A4 / A3 / B5 / 16 开，各含纵向、横向；第一个即默认（A4 纵向）。 */
export const PRINT_PAPERS: PrintPaper[] = PAPER_SIZE_DEFS.flatMap((def) => [
  buildPaper(def, 'portrait'),
  buildPaper(def, 'landscape')
])

export const DEFAULT_PAPER_ID: PrintPaperId = 'A4-portrait'

export function getPrintPaper(id: string): PrintPaper {
  return PRINT_PAPERS.find((paper) => paper.id === id) ?? PRINT_PAPERS[0]
}

/* ------------------------------- 版面尺寸（mm） ------------------------------- */

export const PRINT_LAYOUT = {
  /** @page 四周边距（贴边距留量） */
  pageMarginMm: 12,
  /** 页脚：项目/规则识别 + 「第 X 页 / 共 N 页」 */
  footerMm: 6,
  /** 首页固定头部：大标题 + 副行 + 两行项目信息 */
  firstHeadMm: 42,
  /** 续页窄表头：「下单汇总表（续）+ 项目名」 */
  runHeadMm: 8,
  /** 每页重复的列标题行 */
  tableHeadMm: 8,
  /** 末页签栏（制表 / 厂方确认 / 日期）与其上方留白 */
  signMm: 20,
  /** 一个数据行的固定行高 */
  rowMm: 7
} as const

export interface PageCaps {
  /** 全部内容只占一页时可容纳的数据行数（同时含首页头部与签栏） */
  single: number
  /** 多页时首页可容纳的数据行数 */
  first: number
  /** 中间续页可容纳的数据行数 */
  next: number
  /** 末页可容纳的数据行数（另有合计行 + 签栏） */
  last: number
}

function rowsIn(usableMm: number): number {
  return Math.max(1, Math.floor(usableMm / PRINT_LAYOUT.rowMm))
}

export function pageCapsFor(paper: PrintPaper): PageCaps {
  const L = PRINT_LAYOUT
  const usable = paper.heightMm - 2 * L.pageMarginMm - L.footerMm
  return {
    single: rowsIn(usable - L.firstHeadMm - L.tableHeadMm - L.signMm - L.rowMm),
    first: rowsIn(usable - L.firstHeadMm - L.tableHeadMm),
    next: rowsIn(usable - L.runHeadMm - L.tableHeadMm),
    last: rowsIn(usable - L.runHeadMm - L.tableHeadMm - L.signMm - L.rowMm)
  }
}

/* --------------------------------- 分页切分 --------------------------------- */

export interface PrintPage<T> {
  /** 0 基页序 */
  index: number
  rows: T[]
  isFirst: boolean
  isLast: boolean
}

export interface PrintPagination<T> {
  paper: PrintPaper
  caps: PageCaps
  pages: PrintPage<T>[]
  pageCount: number
  /** @page 内容区宽/高（mm），屏显与打印共用，保证逐页恰好一纸 */
  contentWidthMm: number
  contentHeightMm: number
}

/**
 * 按纸型把行序列切成多页。
 * 贪心策略：能一页装下（含签栏）就只出一页；否则先按首页容量、再按续页
 * 容量逐页取行，当剩余行数能装进末页（含合计行与签栏）时收尾。
 * 每次取行都保证至少给末页留 1 行，因此不会出现空末页，也不会死循环。
 */
export function paginateForPaper<T>(rows: readonly T[], paper: PrintPaper): PrintPagination<T> {
  const caps = pageCapsFor(paper)
  const total = rows.length
  const slices: [number, number][] = []

  if (total <= caps.single) {
    slices.push([0, total])
  } else {
    let pos = 0
    while (pos < total) {
      const remaining = total - pos
      const isFirst = pos === 0
      if (remaining <= (isFirst ? caps.single : caps.last)) {
        slices.push([pos, total])
        break
      }
      const cap = isFirst ? caps.first : caps.next
      // remaining - 1：始终至少留 1 行给末页（末页带合计与签栏）
      const take = Math.min(cap, remaining - 1)
      slices.push([pos, pos + take])
      pos += take
    }
  }

  const pages: PrintPage<T>[] = slices.map(([start, end], index) => ({
    index,
    rows: rows.slice(start, end),
    isFirst: index === 0,
    isLast: index === slices.length - 1
  }))

  return {
    paper,
    caps,
    pages,
    pageCount: pages.length,
    contentWidthMm: paper.widthMm - 2 * PRINT_LAYOUT.pageMarginMm,
    contentHeightMm: paper.heightMm - 2 * PRINT_LAYOUT.pageMarginMm
  }
}

/** 下单汇总表数据行的分页（保留具名类型，供视图层直接使用）。 */
export function paginateOrderSheet(
  items: readonly OrderSheetItem[],
  paper: PrintPaper
): PrintPagination<OrderSheetItem> {
  return paginateForPaper(items, paper)
}
