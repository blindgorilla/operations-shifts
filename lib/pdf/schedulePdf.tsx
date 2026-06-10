import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

// ---------------------------------------------------------------------------
// Brand tokens
// ---------------------------------------------------------------------------
const NAVY  = '#1B3A5C'
const GOLD  = '#D97706'
const WHITE = '#FFFFFF'

// Three clearly distinct shift families:
//   M = amber/warm    E = teal/cool-green    N = violet/purple
const SHIFT_BG: Record<string, string> = {
  morning: '#FEF3C7', // amber-100
  evening: '#CCFBF1', // teal-100
  night:   '#EDE9FE', // violet-100
}
const SHIFT_FG: Record<string, string> = {
  morning: '#92400E', // amber-800
  evening: '#0F766E', // teal-700
  night:   '#5B21B6', // violet-800
}
const SHIFT_CODE: Record<string, string> = {
  morning: 'M',
  evening: 'E',
  night:   'N',
}

const WEEKEND_COL_BG = '#F1F5F9' // slate-100
const FRIDAY_COL_BG  = '#FFFBEB' // amber-50 — subtle warm tint
const GRID_BORDER    = '#CBD5E1'  // slate-300
const GRID_DIVIDER   = '#E2E8F0'  // slate-200

// ---------------------------------------------------------------------------
// Page geometry (A4 landscape = 841.89 × 595.28 pt)
// ---------------------------------------------------------------------------
// Fixed vertical costs (pt):
//   page padding: 32  header band: 44  accent line: 11
//   two 14pt header rows: 28  footer: 27  grid borders: 2
const AVAILABLE_ROW_HEIGHT = 595.28 - 32 - 44 - 11 - 28 - 27 - 2  // ≈ 451pt

function rowHeight(numEmployees: number): number {
  const h = Math.floor(AVAILABLE_ROW_HEIGHT / Math.max(1, numEmployees))
  return Math.min(38, Math.max(14, h))
}

const NAME_W   = 88
const TOTALS_W = 40

const DOW_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] // 0=Sun…6=Sat

function getDow(year: number, month: number, day: number) {
  return new Date(year, month - 1, day).getDay() // 0=Sun
}
function isWeekend(year: number, month: number, day: number): boolean {
  const d = getDow(year, month, day)
  return d === 0 || d === 6
}
function isFriday(year: number, month: number, day: number): boolean {
  return getDow(year, month, day) === 5
}
function colBg(year: number, month: number, day: number): string {
  if (isWeekend(year, month, day)) return WEEKEND_COL_BG
  if (isFriday(year, month, day))  return FRIDAY_COL_BG
  return WHITE
}

// ---------------------------------------------------------------------------
// Styles (computed below where row height is needed)
// ---------------------------------------------------------------------------
const BASE = StyleSheet.create({
  page: {
    backgroundColor: WHITE,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    fontFamily: 'Helvetica',
    fontSize: 8,
  },
  header: {
    backgroundColor: NAVY,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 4,
  },
  logoImg: {
    width: 110,
    height: 30,
    objectFit: 'contain',
  },
  logoFallback: {
    color: WHITE,
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    width: 110,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: WHITE,
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.3,
  },
  headerSub: {
    color: '#93C5FD',
    fontSize: 8,
    marginTop: 3,
  },
  headerRight: {
    width: 110,
    alignItems: 'flex-end',
  },
  headerRightText: {
    color: '#CBD5E1',
    fontSize: 7,
  },
  accentLine: {
    height: 3,
    backgroundColor: GOLD,
    marginBottom: 8,
    borderRadius: 1,
  },

  // Grid outer wrapper
  grid: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: GRID_BORDER,
    borderRadius: 3,
    overflow: 'hidden',
  },

  // Name cell — shared across all row types
  nameCellBase: {
    width: NAME_W,
    paddingHorizontal: 5,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: GRID_BORDER,
  },

  // Totals cell — shared across all row types
  totalsCellBase: {
    width: TOTALS_W,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: GRID_BORDER,
    paddingHorizontal: 3,
  },

  // Header rows
  hdrRowDow: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF', // blue-50 — distinct from day-number row
    borderBottomWidth: 0.5,
    borderBottomColor: GRID_DIVIDER,
    height: 14,
  },
  hdrRowNum: {
    flexDirection: 'row',
    backgroundColor: '#F0F4F8',
    borderBottomWidth: 1,
    borderBottomColor: GRID_BORDER,
    height: 14,
  },
  hdrNameText: {
    fontSize: 7,
    color: '#64748B',
    fontFamily: 'Helvetica-Bold',
  },
  hdrTotalsText: {
    fontSize: 6.5,
    color: '#64748B',
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },
  hdrDowText: {
    fontSize: 6.5,
    color: '#475569',
    fontFamily: 'Helvetica-Bold',
  },
  hdrDowWeekend: {
    fontSize: 6.5,
    color: '#94A3B8',
    fontFamily: 'Helvetica-Bold',
  },
  hdrNumText: {
    fontSize: 7,
    color: '#475569',
    fontFamily: 'Helvetica-Bold',
  },
  hdrNumWeekend: {
    fontSize: 7,
    color: '#94A3B8',
    fontFamily: 'Helvetica-Bold',
  },

  // Day header cell (shared, bg applied inline)
  hdrDayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 0.5,
    borderRightColor: GRID_DIVIDER,
  },

  // Data day cell (shared, bg applied inline)
  dataDayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 0.5,
    borderRightColor: GRID_DIVIDER,
  },

  // Shift pill
  shiftPill: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 14,
  },

  // Unfilled alert
  unfilledBox: {
    marginTop: 4,
    padding: 5,
    backgroundColor: '#FEF2F2',
    borderRadius: 3,
    borderWidth: 0.75,
    borderColor: '#FECACA',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
  },
  unfilledLabel: {
    fontSize: 7,
    color: '#DC2626',
    fontFamily: 'Helvetica-Bold',
  },
  unfilledItem: {
    fontSize: 6.5,
    color: '#EF4444',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 5,
    borderTopWidth: 0.75,
    borderTopColor: GRID_DIVIDER,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendPill: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 16,
  },
  legendPillText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
  },
  legendSep: {
    fontSize: 7,
    color: '#CBD5E1',
    marginHorizontal: 2,
  },
  legendDesc: {
    fontSize: 7,
    color: '#475569',
  },
  footerRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  footerMeta: {
    fontSize: 6.5,
    color: '#94A3B8',
    textAlign: 'right',
  },
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PDFEmployee  { id: string; name: string }
export interface PDFShift     { id: string; date: string; shift_type: string }
export interface PDFAssignment { employee_id: string; shift_id: string }
export interface UnfilledSlot { date: string; shift_type: string; day_type: string }

interface Props {
  monthLabel: string
  publishedAt: string
  lastEditedAt?: string | null
  generatedAt: string
  employees: PDFEmployee[]
  shifts: PDFShift[]
  assignments: PDFAssignment[]
  unfilledSlots: UnfilledSlot[]
  logoSrc: string | null
  daysInMonth: number
  year: number
  month: number
}

// ---------------------------------------------------------------------------
// Grid builder
// ---------------------------------------------------------------------------
function buildGrid(
  employees: PDFEmployee[],
  shifts: PDFShift[],
  assignments: PDFAssignment[],
): Record<string, Record<number, string>> {
  const shiftInfo: Record<string, { day: number; type: string }> = {}
  for (const s of shifts) {
    shiftInfo[s.id] = { day: parseInt(s.date.slice(8, 10), 10), type: s.shift_type }
  }
  const grid: Record<string, Record<number, string>> = {}
  for (const e of employees) grid[e.id] = {}
  for (const a of assignments) {
    const info = shiftInfo[a.shift_id]
    if (info && grid[a.employee_id]) grid[a.employee_id][info.day] = info.type
  }
  return grid
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SchedulePDF({
  monthLabel, publishedAt, lastEditedAt, generatedAt,
  employees, shifts, assignments, unfilledSlots,
  logoSrc, daysInMonth, year, month,
}: Props) {
  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name))
  const grid   = buildGrid(sorted, shifts, assignments)
  const days   = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const rh     = rowHeight(sorted.length)
  const shiftFontSize = Math.min(9, Math.max(7, Math.round(rh * 0.32)))
  const nameFontSize  = Math.min(9, Math.max(7, Math.round(rh * 0.30)))

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={BASE.page}>

        {/* ── Header ── */}
        <View style={BASE.header}>
          {logoSrc
            ? <Image src={logoSrc} style={BASE.logoImg} />
            : <Text style={BASE.logoFallback}>MS Security</Text>
          }
          <View style={BASE.headerCenter}>
            <Text style={BASE.headerTitle}>Monthly Shift Schedule — {monthLabel}</Text>
            <Text style={BASE.headerSub}>
              Published {publishedAt}{lastEditedAt ? `  ·  Last updated ${lastEditedAt}` : ''}
            </Text>
          </View>
          <View style={BASE.headerRight}>
            <Text style={BASE.headerRightText}>MS Security Group</Text>
          </View>
        </View>

        {/* Gold accent line */}
        <View style={BASE.accentLine} />

        {/* ── Rota grid ── */}
        <View style={BASE.grid}>

          {/* Row 1: weekday initials */}
          <View style={BASE.hdrRowDow}>
            <View style={BASE.nameCellBase}>
              {/* blank */}
            </View>
            {days.map(d => {
              const dow  = getDow(year, month, d)
              const wknd = dow === 0 || dow === 6
              const bg   = colBg(year, month, d)
              return (
                <View key={d} style={[BASE.hdrDayCell, { backgroundColor: bg }]}>
                  <Text style={wknd ? BASE.hdrDowWeekend : BASE.hdrDowText}>
                    {DOW_INITIAL[dow]}
                  </Text>
                </View>
              )
            })}
            <View style={[BASE.totalsCellBase, { backgroundColor: '#EFF6FF' }]} />
          </View>

          {/* Row 2: day numbers */}
          <View style={BASE.hdrRowNum}>
            <View style={BASE.nameCellBase}>
              <Text style={BASE.hdrNameText}>Guard</Text>
            </View>
            {days.map(d => {
              const wknd = isWeekend(year, month, d)
              const bg   = colBg(year, month, d)
              return (
                <View key={d} style={[BASE.hdrDayCell, { backgroundColor: bg }]}>
                  <Text style={wknd ? BASE.hdrNumWeekend : BASE.hdrNumText}>{d}</Text>
                </View>
              )
            })}
            <View style={[BASE.totalsCellBase, { backgroundColor: '#F0F4F8' }]}>
              <Text style={BASE.hdrTotalsText}>{'Ttl\nN'}</Text>
            </View>
          </View>

          {/* Employee rows — height computed to fill the page */}
          {sorted.map((emp, idx) => {
            const empRow     = grid[emp.id] ?? {}
            const totalShifts = Object.keys(empRow).length
            const nightShifts = Object.values(empRow).filter(t => t === 'night').length
            const rowBg = idx % 2 === 1 ? '#FAFBFC' : WHITE

            return (
              <View
                key={emp.id}
                style={{
                  flexDirection: 'row',
                  height: rh,
                  backgroundColor: rowBg,
                  borderBottomWidth: 0.5,
                  borderBottomColor: GRID_DIVIDER,
                }}
              >
                {/* Guard name */}
                <View style={BASE.nameCellBase}>
                  <Text style={{ fontSize: nameFontSize, color: '#1E293B', fontFamily: 'Helvetica-Bold' }}>
                    {emp.name}
                  </Text>
                </View>

                {/* Day cells */}
                {days.map(d => {
                  const shiftType = empRow[d]
                  const bg = colBg(year, month, d) === WHITE
                    ? (idx % 2 === 1 ? '#FAFBFC' : WHITE)
                    : colBg(year, month, d)

                  return (
                    <View key={d} style={[BASE.dataDayCell, { backgroundColor: bg }]}>
                      {shiftType && (
                        <View style={[BASE.shiftPill, { backgroundColor: SHIFT_BG[shiftType] ?? '#F3F4F6' }]}>
                          <Text style={{ fontSize: shiftFontSize, fontFamily: 'Helvetica-Bold', color: SHIFT_FG[shiftType] ?? '#374151' }}>
                            {SHIFT_CODE[shiftType] ?? '?'}
                          </Text>
                        </View>
                      )}
                    </View>
                  )
                })}

                {/* Totals */}
                <View style={[BASE.totalsCellBase, { backgroundColor: rowBg }]}>
                  <Text style={{ fontSize: nameFontSize, color: NAVY, fontFamily: 'Helvetica-Bold' }}>
                    {totalShifts}
                  </Text>
                  {nightShifts > 0 && (
                    <Text style={{ fontSize: Math.max(6, nameFontSize - 2), color: SHIFT_FG.night }}>
                      {nightShifts}N
                    </Text>
                  )}
                </View>
              </View>
            )
          })}
        </View>

        {/* ── Unfilled slots ── */}
        {unfilledSlots.length > 0 && (
          <View style={BASE.unfilledBox}>
            <Text style={BASE.unfilledLabel}>Unfilled slots ({unfilledSlots.length}):</Text>
            {unfilledSlots.slice(0, 24).map((slot, i) => (
              <Text key={i} style={BASE.unfilledItem}>
                {slot.date.slice(5)} {(SHIFT_CODE[slot.shift_type] ?? slot.shift_type).toUpperCase()}
                {i < Math.min(unfilledSlots.length, 24) - 1 ? ' ·' : ''}
              </Text>
            ))}
            {unfilledSlots.length > 24 && (
              <Text style={BASE.unfilledItem}> …+{unfilledSlots.length - 24} more</Text>
            )}
          </View>
        )}

        {/* ── Footer ── */}
        <View style={BASE.footer}>

          {/* Legend */}
          <View style={BASE.legend}>
            {(['morning', 'evening', 'night'] as const).map((type, i) => (
              <React.Fragment key={type}>
                {i > 0 && <Text style={BASE.legendSep}>·</Text>}
                <View style={BASE.legendItem}>
                  <View style={[BASE.legendPill, { backgroundColor: SHIFT_BG[type] }]}>
                    <Text style={[BASE.legendPillText, { color: SHIFT_FG[type] }]}>{SHIFT_CODE[type]}</Text>
                  </View>
                  <Text style={BASE.legendDesc}>
                    {type === 'morning' ? 'Morning 09:00–17:00'
                      : type === 'evening' ? 'Evening 17:00–01:00'
                      : 'Night 01:00–09:00'}
                  </Text>
                </View>
              </React.Fragment>
            ))}
            <Text style={BASE.legendSep}>·</Text>
            <View style={BASE.legendItem}>
              <View style={[BASE.legendPill, { backgroundColor: WEEKEND_COL_BG }]}>
                <Text style={[BASE.legendPillText, { color: '#94A3B8' }]}>S</Text>
              </View>
              <Text style={BASE.legendDesc}>Weekend</Text>
            </View>
            <Text style={BASE.legendSep}>·</Text>
            <View style={BASE.legendItem}>
              <View style={[BASE.legendPill, { backgroundColor: FRIDAY_COL_BG }]}>
                <Text style={[BASE.legendPillText, { color: '#D97706' }]}>F</Text>
              </View>
              <Text style={BASE.legendDesc}>Friday</Text>
            </View>
          </View>

          {/* Right: generated date + page number */}
          <View style={BASE.footerRight}>
            <Text style={BASE.footerMeta}>Generated {generatedAt}</Text>
            <Text
              style={BASE.footerMeta}
              render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
                `Page ${pageNumber} of ${totalPages}`
              }
            />
          </View>
        </View>

      </Page>
    </Document>
  )
}
