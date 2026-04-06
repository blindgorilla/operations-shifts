'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { ShiftType } from '@/types'

const SHIFT_DEFAULTS: Record<ShiftType, { start: string; end: string }> = {
  morning: { start: '06:00', end: '14:00' },
  evening: { start: '14:00', end: '22:00' },
  night: { start: '22:00', end: '06:00' },
}

export default function NewShiftForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    date: '',
    shift_type: 'morning' as ShiftType,
    start_time: '06:00',
    end_time: '14:00',
    location: '',
    role_required: '',
    headcount: 1,
    notes: '',
    is_published: false,
  })

  function handleShiftTypeChange(type: ShiftType) {
    setForm((f) => ({
      ...f,
      shift_type: type,
      start_time: SHIFT_DEFAULTS[type].start,
      end_time: SHIFT_DEFAULTS[type].end,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: insertError } = await supabase.from('shifts').insert({
      date: form.date,
      shift_type: form.shift_type,
      start_time: form.start_time,
      end_time: form.end_time,
      location: form.location || null,
      role_required: form.role_required || null,
      headcount: form.headcount,
      notes: form.notes || null,
      is_published: form.is_published,
    })

    setLoading(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    router.push('/manager/shifts')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">

      {/* Date */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Date <span className="text-red-500">*</span></label>
        <input
          type="date"
          required
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Shift Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Shift Type <span className="text-red-500">*</span></label>
        <div className="grid grid-cols-3 gap-2">
          {(['morning', 'evening', 'night'] as ShiftType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => handleShiftTypeChange(type)}
              className={`py-2 px-3 rounded-lg border text-sm font-medium capitalize transition-colors ${
                form.shift_type === type
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {type === 'morning' ? '🌅' : type === 'evening' ? '🌆' : '🌙'} {type}
            </button>
          ))}
        </div>
      </div>

      {/* Time */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
          <input
            type="time"
            required
            value={form.start_time}
            onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
          <input
            type="time"
            required
            value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Location */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Location / Site</label>
        <input
          type="text"
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
          placeholder="e.g. Main Office, Site B"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Role */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Role Required</label>
        <input
          type="text"
          value={form.role_required}
          onChange={(e) => setForm({ ...form, role_required: e.target.value })}
          placeholder="e.g. Supervisor, Operator, Security"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Headcount */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Headcount <span className="text-gray-400 font-normal">(max employees for this slot)</span>
        </label>
        <input
          type="number"
          min={1}
          max={50}
          required
          value={form.headcount}
          onChange={(e) => setForm({ ...form, headcount: parseInt(e.target.value) })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={3}
          placeholder="Any additional info for employees..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Publish */}
      <div className="flex items-center gap-2">
        <input
          id="is_published"
          type="checkbox"
          checked={form.is_published}
          onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="is_published" className="text-sm text-gray-700">
          Publish immediately <span className="text-gray-400">(employees can see and request it)</span>
        </label>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 rounded-lg text-sm transition-colors"
        >
          {loading ? 'Creating...' : 'Create Shift'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
