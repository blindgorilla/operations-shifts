'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import type { PublicHoliday } from '@/types'

interface Props { holidays: PublicHoliday[] }

export default function ManagerHolidaysClient({ holidays: initial }: Props) {
  const [holidays, setHolidays] = useState(initial)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  async function addHoliday(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('public_holidays')
      .insert({ date, name })
      .select()
      .single()

    setLoading(false)
    if (error) {
      showToast('error', error.code === '23505' ? 'That date is already a public holiday' : error.message)
      return
    }

    setHolidays((prev) => [...prev, data].sort((a, b) => a.date.localeCompare(b.date)))
    setDate('')
    setName('')
    showToast('success', 'Holiday added')
  }

  async function deleteHoliday(id: string) {
    const supabase = createClient()
    await supabase.from('public_holidays').delete().eq('id', id)
    setHolidays((prev) => prev.filter((h) => h.id !== id))
    showToast('success', 'Holiday removed')
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Add form */}
      <form onSubmit={addHoliday} className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Add Public Holiday</h2>
        <div className="flex gap-3">
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            required
            placeholder="Holiday name (e.g. National Day)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-[2] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>

      {/* List */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {holidays.length === 0 ? (
          <p className="text-center py-8 text-sm text-gray-400">No public holidays added yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Holiday</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {holidays.map((h) => (
                <tr key={h.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{format(parseISO(h.date), 'EEEE, d MMMM yyyy')}</td>
                  <td className="px-4 py-3 text-gray-700">{h.name}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteHoliday(h.id)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
