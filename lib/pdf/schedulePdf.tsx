import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

// ---------------------------------------------------------------------------
// Brand tokens
// ---------------------------------------------------------------------------
const NAVY  = '#1B3A5C'
const GOLD  = '#D97706'
const WHITE = '#FFFFFF'

const SHIFT_BG: Record<string, string> = {
  morning: '#FEF3C7',
  evening: '#DBEAFE',
  night:   '#E0E7FF',
}
const SHIFT_FG: Record<string, string> = {
  morning: '#92400E',
  evening: '#1E40AF',
  night:   '#3730A3',
}
const SHIFT_CODE: Record<string, string> = {
  morning: 'M',
  evening: 'E',
  night:   'N',
}

const WEEKEND_COL_BG = '#F1F5F9'
const GRID_BORDER    = '#CBD5E1'
const GRID_DIVIDER   = '#E2E8F0'

// ---------------------------------------------------------------------------
// Dimensions (A4 landscape = 841.89 × 595.28 pt)
// ---------------------------------------------------------------------------
const NAME_W    = 88  // guard name column
const TOTALS_W  = 38  // totals column
const ROW_H     = 20  // data row height
const HDR_ROW_H = 18  // day-number header row

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const s = StyleSheet.create({
  page: {
    backgroundColor: WHITE,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    fontFamily: 'Helvetica',
    fontSize: 8,
  },

  // Header band
  header: {
    backgroundColor: NAVY,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    marginBottom: 0,
  },
  logoImg: {
    width: 100,
    height: 32,
    objectFit: 'contain',
  },
  logoFallbackText: {
    color: WHITE,
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    width: 100,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: WHITE,
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.3,
  },
  headerSub: {
    color: '#93C5FD',
    fontSize: 7.5,
    marginTop: 2,
  },
  headerRight: {
    width: 100,
    alignItems: 'flex-end',
  },
  headerRightText: {
    color: '#CBD5E1',
    fontSize: 7,
  },

  // Gold accent line beneath header
  accentLine: {
    height: 3,
    backgroundColor: GOLD,
    marginBottom: 8,
    borderRadius: 1,
  },

  // Grid
  grid: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: GRID_BORDER,
    borderRadius: 3,
    overflow: 'hidden',
  },
  gridHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F0F4F8',
    borderBottomWidth: 1,
    borderBottomColor: GRID_BORDER,
    height: HDR_ROW_H,
  },
  gridRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: GRID_DIVIDER,
    height: ROW_H,
  },
  gridRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: GRID_DIVIDER,
    backgroundColor: '#FAFBFC',
    height: ROW_H,
  },

  // Name cell
  nameCell: {
    width: NAME_W,
    paddingHorizontal: 5,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: GRID_BORDER,
  },
  nameText: {
    fontSize: 7,
    color: '#1E293B',
    fontFamily: 'Helvetica-Bold',
  },
  nameHeaderText: {
    fontSize: 6.5,
    color: '#64748B',
    fontFamily: 'Helvetica-Bold',
  },

  // Day cells (flex: 1 so they share remaining width equally)
  dayHeaderCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 0.5,
    borderRightColor: GRID_DIVIDER,
  },
  dayHeaderCellWeekend: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 0.5,
    borderRightColor: GRID_DIVIDER,
    backgroundColor: WEEKEND_COL_BG,
  },
  dayHeaderNum: {
    fontSize: 6,
    color: '#475569',
    fontFamily: 'Helvetica-Bold',
  },
  dayHeaderNumWeekend: {
    fontSize: 6,
    color: '#94A3B8',
    fontFamily: 'Helvetica-Bold',
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 0.5,
    borderRightColor: GRID_DIVIDER,
  },
  dayCellWeekend: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 0.5,
    borderRightColor: GRID_DIVIDER,
    backgroundColor: WEEKEND_COL_BG,
  },
  shiftPill: {
    paddingHorizontal: 3,
    paddingVertical: 1.5,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 12,
  },
  shiftPillText: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
  },

  // Totals cell
  totalsHeaderCell: {
    width: TOTALS_W,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: GRID_BORDER,
    backgroundColor: '#F0F4F8',
  },
  totalsHeaderText: {
    fontSize: 6,
    color: '#64748B',
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },
  totalsCell: {
    width: TOTALS_W,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: GRID_BORDER,
    paddingHorizontal: 3,
  },
  totalsPrimary: {
    fontSize: 7,
    color: NAVY,
    fontFamily: 'Helvetica-Bold',
  },
  totalsSecondary: {
    fontSize: 5.5,
    color: '#94A3B8',
  },

  // Unfilled alert
  unfilledBox: {
    marginTop: 5,
    padding: 5,
    backgroundColor: '#FEF2F2',
    borderRadius: 3,
    borderWidth: 0.75,
    borderColor: '#FECACA',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  unfilledLabel: {
    fontSize: 6.5,
    color: '#DC2626',
    fontFamily: 'Helvetica-Bold',
    marginRight: 6,
  },
  unfilledItem: {
    fontSize: 6,
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
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendPill: {
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 2,
  },
  legendPillText: {
    fontSize: 6,
    fontFamily: 'Helvetica-Bold',
  },
  legendDesc: {
    fontSize: 6,
    color: '#64748B',
  },
  footerMeta: {
    fontSize: 6,
    color: '#94A3B8',
    textAlign: 'right',
  },
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PDFEmployee {
  id: string
  name: string
}

export interface PDFShift {
  id: string
  date: string       // yyyy-MM-dd
  shift_type: string // morning | evening | night
}

export interface PDFAssignment {
  employee_id: string
  shift_id: string
}

export interface UnfilledSlot {
  date: string
  shift_type: string
  day_type: string
}

interface Props {
  monthLabel: string   // e.g. "July 2026"
  publishedAt: string  // formatted string
  generatedAt: string  // formatted string
  employees: PDFEmployee[]
  shifts: PDFShift[]
  assignments: PDFAssignment[]
  unfilledSlots: UnfilledSlot[]
  logoSrc: string | null
  daysInMonth: number
  year: number
  month: number  // 1-based
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isWeekend(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month - 1, day).getDay()
  return dow === 0 || dow === 6
}

function buildGrid(
  employees: PDFEmployee[],
  shifts: PDFShift[],
  assignments: PDFAssignment[],
): Record<string, Record<number, string>> {
  // shift_id → { dayNum, shift_type }
  const shiftInfo: Record<string, { day: number; type: string }> = {}
  for (const s of shifts) {
    const day = parseInt(s.date.slice(8, 10), 10)
    shiftInfo[s.id] = { day, type: s.shift_type }
  }

  // employee_id → day_num → shift_type
  const grid: Record<string, Record<number, string>> = {}
  for (const e of employees) grid[e.id] = {}
  for (const a of assignments) {
    const info = shiftInfo[a.shift_id]
    if (info && grid[a.employee_id]) {
      grid[a.employee_id][info.day] = info.type
    }
  }
  return grid
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SchedulePDF({
  monthLabel, publishedAt, generatedAt,
  employees, shifts, assignments, unfilledSlots,
  logoSrc, daysInMonth, year, month,
}: Props) {
  const sortedEmployees = [...employees].sort((a, b) => a.name.localeCompare(b.name))
  const grid = buildGrid(sortedEmployees, shifts, assignments)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>

        {/* ── Header ── */}
        <View style={s.header}>
          {/* Logo / fallback */}
          {logoSrc
            ? <Image src={logoSrc} style={s.logoImg} />
            : <Text style={s.logoFallbackText}>MS Security</Text>
          }

          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>Monthly Shift Schedule — {monthLabel}</Text>
            <Text style={s.headerSub}>Published {publishedAt}</Text>
          </View>

          <View style={s.headerRight}>
            <Text style={s.headerRightText}>MS Security Group</Text>
          </View>
        </View>

        {/* Gold accent line */}
        <View style={s.accentLine} />

        {/* ── Rota grid ── */}
        <View style={s.grid}>

          {/* Day-number header row */}
          <View style={s.gridHeaderRow}>
            <View style={s.nameCell}>
              <Text style={s.nameHeaderText}>Guard</Text>
            </View>
            {days.map(d => {
              const wknd = isWeekend(year, month, d)
              return (
                <View key={d} style={wknd ? s.dayHeaderCellWeekend : s.dayHeaderCell}>
                  <Text style={wknd ? s.dayHeaderNumWeekend : s.dayHeaderNum}>{d}</Text>
                </View>
              )
            })}
            <View style={s.totalsHeaderCell}>
              <Text style={s.totalsHeaderText}>{'Ttl\nN'}</Text>
            </View>
          </View>

          {/* Employee rows */}
          {sortedEmployees.map((emp, idx) => {
            const empRow = grid[emp.id] ?? {}
            const totalShifts = Object.keys(empRow).length
            const nightShifts = Object.values(empRow).filter(t => t === 'night').length
            const rowStyle = idx % 2 === 0 ? s.gridRow : s.gridRowAlt

            return (
              <View key={emp.id} style={rowStyle}>
                <View style={s.nameCell}>
                  <Text style={s.nameText}>{emp.name}</Text>
                </View>

                {days.map(d => {
                  const shiftType = empRow[d]
                  const wknd = isWeekend(year, month, d)
                  return (
                    <View key={d} style={wknd ? s.dayCellWeekend : s.dayCell}>
                      {shiftType && (
                        <View style={[s.shiftPill, { backgroundColor: SHIFT_BG[shiftType] ?? '#F3F4F6' }]}>
                          <Text style={[s.shiftPillText, { color: SHIFT_FG[shiftType] ?? '#374151' }]}>
                            {SHIFT_CODE[shiftType] ?? '?'}
                          </Text>
                        </View>
                      )}
                    </View>
                  )
                })}

                <View style={s.totalsCell}>
                  <Text style={s.totalsPrimary}>{totalShifts}</Text>
                  {nightShifts > 0 && (
                    <Text style={s.totalsSecondary}>{nightShifts}N</Text>
                  )}
                </View>
              </View>
            )
          })}
        </View>

        {/* ── Unfilled slots (if any) ── */}
        {unfilledSlots.length > 0 && (
          <View style={s.unfilledBox}>
            <Text style={s.unfilledLabel}>Unfilled slots ({unfilledSlots.length}):</Text>
            {unfilledSlots.slice(0, 20).map((slot, i) => (
              <Text key={i} style={s.unfilledItem}>
                {slot.date.slice(5)} {(SHIFT_CODE[slot.shift_type] ?? slot.shift_type).toUpperCase()}
                {i < Math.min(unfilledSlots.length, 20) - 1 ? '  ·' : ''}
              </Text>
            ))}
            {unfilledSlots.length > 20 && (
              <Text style={s.unfilledItem}> …and {unfilledSlots.length - 20} more</Text>
            )}
          </View>
        )}

        {/* ── Footer ── */}
        <View style={s.footer}>
          <View style={s.legend}>
            {(['morning', 'evening', 'night'] as const).map(type => (
              <View key={type} style={s.legendItem}>
                <View style={[s.legendPill, { backgroundColor: SHIFT_BG[type] }]}>
                  <Text style={[s.legendPillText, { color: SHIFT_FG[type] }]}>{SHIFT_CODE[type]}</Text>
                </View>
                <Text style={s.legendDesc}>
                  {type === 'morning' ? 'Morning 09:00–17:00'
                    : type === 'evening' ? 'Evening 17:00–01:00'
                    : 'Night 01:00–09:00'}
                </Text>
              </View>
            ))}
            <View style={[s.legendItem, { marginLeft: 6 }]}>
              <View style={[s.legendPill, { backgroundColor: WEEKEND_COL_BG }]}>
                <Text style={[s.legendPillText, { color: '#94A3B8' }]}>—</Text>
              </View>
              <Text style={s.legendDesc}>Weekend column</Text>
            </View>
          </View>

          <Text style={s.footerMeta}>Generated {generatedAt}</Text>
        </View>

      </Page>
    </Document>
  )
}
