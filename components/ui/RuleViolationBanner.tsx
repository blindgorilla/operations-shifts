import type { RuleViolation } from '@/types'

interface RuleViolationBannerProps {
  violations: RuleViolation[]
}

export default function RuleViolationBanner({ violations }: RuleViolationBannerProps) {
  if (violations.length === 0) return null

  const errors = violations.filter((v) => v.severity === 'error')
  const warnings = violations.filter((v) => v.severity === 'warning')

  return (
    <div className="space-y-2">
      {errors.map((v, i) => (
        <div key={i} className="flex gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-800">
          <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span>{v.message}</span>
        </div>
      ))}
      {warnings.map((v, i) => (
        <div key={i} className="flex gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm text-amber-800">
          <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{v.message}</span>
        </div>
      ))}
    </div>
  )
}
