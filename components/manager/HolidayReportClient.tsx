'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { HolidayWorkRow } from '@/types'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i)

interface Props {
  initialYear: number
  initialMonth: number
  initialRows: HolidayWorkRow[]
}

export default function HolidayReportClient({ initialYear, initialMonth, initialRows }: Props) {
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [rows, setRows] = useState<HolidayWorkRow[]>(initialRows)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchReport(y: number, m: number) {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc('holiday_work_report', {
      p_year: y,
      p_month: m,
    })
    setLoading(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setRows((data as HolidayWorkRow[]) ?? [])
  }

  function handleYearChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const y = Number(e.target.value)
    setYear(y)
    fetchReport(y, month)
  }

  function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const m = Number(e.target.value)
    setMonth(m)
    fetchReport(year, m)
  }

  const totalHolidays = rows.reduce((s, r) => s + r.holidays_worked, 0)
  const totalHighHolidays = rows.reduce((s, r) => s + r.high_holidays_worked, 0)

  function downloadCsv() {
    const header = 'Employee,Holidays Worked,High Holidays Worked'
    const dataRows = rows.map(
      (r) => `"${r.employee_name}",${r.holidays_worked},${r.high_holidays_worked}`
    )
    const totalsRow = `"TOTAL",${totalHolidays},${totalHighHolidays}`
    const csv = [header, ...dataRows, totalsRow].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `holiday-report-${year}-${String(month).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasData = rows.some((r) => r.holidays_worked > 0 || r.high_holidays_worked > 0)

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={month}
          onChange={handleMonthChange}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {MONTHS.map((label, i) => (
            <option key={i + 1} value={i + 1}>{label}</option>
          ))}
        </select>
        <select
          value={year}
          onChange={handleYearChange}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          onClick={downloadCsv}
          disabled={loading || rows.length === 0}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download CSV
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-center py-10 text-sm text-gray-400">Loading…</p>
        ) : !hasData ? (
          <p className="text-center py-10 text-sm text-gray-400">
            No published schedule or no holiday shifts for {MONTHS[month - 1]} {year}.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Holidays worked</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">
                  <span className="inline-flex items-center gap-1">
                    High holidays worked
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">High</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.employee_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.employee_name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.holidays_worked > 0 ? (
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-50 text-blue-700 font-semibold text-xs">
                        {r.holidays_worked}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.high_holidays_worked > 0 ? (
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-50 text-purple-700 font-semibold text-xs">
                        {r.high_holidays_worked}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className="px-4 py-3 text-gray-700">Total</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-900">{totalHolidays}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-900">{totalHighHolidays}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
