/**
 * 打印分页：把下单汇总表的行按纸型切成一页一页。
 * 纯函数、不依赖 DOM；页面预览与浏览器打印共用同一份分页结果，
 * 保证「页面上看到的」与「打印出来的」逐行一致。
 */

/** 纸型参数：分页参数按纸型定，改纸型即重新分页 */
export type PaperProfile = {
  id: string
  label: string
  /** 写入 @page size 的值，让浏览器打印对话框默认使用同一纸型 */
  pageSizeCss: string
  widthMm: number
  heightMm: number
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
}

export const PAPER_PROFILES: PaperProfile[] = [
  {
    id: 'a4',
    label: 'A4 纵向（210×297mm）',
    pageSizeCss: 'A4 portrait',
    widthMm: 210,
    heightMm: 297,
    marginTopMm: 14,
    marginRightMm: 12,
    marginBottomMm: 16,
    marginLeftMm: 12
  },
  {
    id: 'a5',
    label: 'A5 纵向（148×210mm）',
    pageSizeCss: 'A5 portrait',
    widthMm: 148,
    heightMm: 210,
    marginTopMm: 12,
    marginRightMm: 10,
    marginBottomMm: 14,
    marginLeftMm: 10
  },
  {
    id: 'letter',
    label: 'Letter 纵向（216×279mm）',
    pageSizeCss: 'letter portrait',
    widthMm: 215.9,
    heightMm: 279.4,
    marginTopMm: 14,
    marginRightMm: 12,
    marginBottomMm: 16,
    marginLeftMm: 12
  }
]

export const DEFAULT_PAPER_ID = 'a4'

export function paperProfileById(id: string): PaperProfile {
  return PAPER_PROFILES.find((profile) => profile.id === id) ?? PAPER_PROFILES[0]
}

/**
 * 版式常量（mm）：与 styles.css 中 .print-* 样式的实际尺寸对应，改动需同步。
 * 数据行按 12.5px 字号 × 1.4 行高 + 上下 4px 内边距 + 1px 边框 ≈ 7.0mm 实测，再留余量。
 */
const PRINT_METRICS = {
  rowMm: 7.3, // 数据行
  headerRowMm: 7.6, // 每页重复的表头行
  totalRowMm: 7.6, // 末页合计行
  firstHeadMm: 36, // 首页：大标题 + 副标题 + 元信息块
  contHeadMm: 8.5, // 续页：「（续）」标题行
  signMm: 10, // 末页：制表 / 厂方确认 / 日期签名栏（含与表格的间距）
  footMm: 7.5, // 每页页脚：页码行
  safetyMm: 2 // 字体渲染与取整误差余量
}

export type PageLayout = {
  contentWidthMm: number
  contentHeightMm: number
  /** 首页容量（有标题与元信息，不放签名栏） */
  firstPageRows: number
  /** 中间续页容量 */
  middlePageRows: number
  /** 末页容量（要预留合计行与签名栏的位置） */
  lastPageRows: number
  /** 整表只有一页时的容量（首页版头 + 签名栏同时存在） */
  singlePageRows: number
}

/** 由纸面内容区高度推出每页固定行数：纸型一变，行数跟着变 */
export function pageLayout(profile: PaperProfile): PageLayout {
  const contentWidthMm = profile.widthMm - profile.marginLeftMm - profile.marginRightMm
  const contentHeightMm = profile.heightMm - profile.marginTopMm - profile.marginBottomMm
  // 每页都要扣掉的固定部分：页脚页码行 + 重复表头 + 渲染余量
  const usable = contentHeightMm - PRINT_METRICS.footMm - PRINT_METRICS.headerRowMm - PRINT_METRICS.safetyMm
  const rows = (budgetMm: number): number => Math.max(1, Math.floor(budgetMm / PRINT_METRICS.rowMm))
  return {
    contentWidthMm,
    contentHeightMm,
    firstPageRows: rows(usable - PRINT_METRICS.firstHeadMm),
    middlePageRows: rows(usable - PRINT_METRICS.contHeadMm),
    lastPageRows: rows(usable - PRINT_METRICS.contHeadMm - PRINT_METRICS.signMm - PRINT_METRICS.totalRowMm),
    singlePageRows: rows(usable - PRINT_METRICS.firstHeadMm - PRINT_METRICS.signMm - PRINT_METRICS.totalRowMm)
  }
}

export type PrintPage<T> = {
  pageNo: number
  pageCount: number
  isFirst: boolean
  isLast: boolean
  rows: T[]
}

/**
 * 按行切页：行是原子单位，一个号型（一行）绝不会被拆到两页。
 * 首页容量小（有标题与元信息）；末页要预留合计行与签名栏的位置；
 * 每刀都至少给后面留一行，保证不会切出空页。
 */
export function paginateRows<T>(rows: T[], layout: PageLayout): PrintPage<T>[] {
  const slices: T[][] = []
  const total = rows.length
  if (total <= layout.singlePageRows) {
    slices.push(rows.slice())
  } else {
    let offset = 0
    // 本页取行数：不超过容量，且至少给后面的页留一行
    const take = (capacity: number): number => Math.max(1, Math.min(capacity, total - offset - 1))
    const firstTake = take(layout.firstPageRows)
    slices.push(rows.slice(offset, offset + firstTake))
    offset += firstTake
    // 剩余行数放不进「末页容量」时，按中间页容量继续往下续
    while (total - offset > layout.lastPageRows) {
      const count = take(layout.middlePageRows)
      slices.push(rows.slice(offset, offset + count))
      offset += count
    }
    slices.push(rows.slice(offset))
  }
  const pageCount = slices.length
  return slices.map((slice, index) => ({
    pageNo: index + 1,
    pageCount,
    isFirst: index === 0,
    isLast: index === pageCount - 1,
    rows: slice
  }))
}

/** 校验分页结果与原始行集逐行一致：行数相同、顺序相同、内容相同（引用同一批行对象） */
export function verifyPagination<T>(rows: T[], pages: PrintPage<T>[]): boolean {
  if (pages.reduce((sum, page) => sum + page.rows.length, 0) !== rows.length) return false
  let index = 0
  for (const page of pages) {
    for (const row of page.rows) {
      if (row !== rows[index]) return false
      index += 1
    }
  }
  return true
}
