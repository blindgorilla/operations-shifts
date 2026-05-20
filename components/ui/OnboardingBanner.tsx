'use client'

import { useState } from 'react'

interface OnboardingBannerProps {
  role: 'employee' | 'manager'
}

const EMPLOYEE_STEPS = [
  { icon: '📅', title: 'Browse shifts', desc: 'Your manager publishes available shifts. Check the calendar or list view.' },
  { icon: '✋', title: 'Request shifts', desc: 'When the request window is open, click Request on any shift you want.' },
  { icon: '📬', title: 'Track your requests', desc: 'Go to My Requests to see the status of each request.' },
  { icon: '✅', title: 'Check your schedule', desc: 'The banner shows how many shifts you have this week. Aim for 5.' },
]

const MANAGER_STEPS = [
  { icon: '➕', title: 'Create & publish shifts', desc: 'Go to Shifts to create shifts with date, type, and headcount. Publish them when ready for employees to see.' },
  { icon: '📋', title: 'Open request window', desc: 'Control when employees can request shifts. Open the window in the Shifts page, and close it when you\'re ready to review.' },
  { icon: '✅', title: 'Review & approve', desc: 'Go to Requests to approve or deny. The system flags scheduling violations automatically. Check coverage on the calendar.' },
  { icon: '👥', title: 'Fill the gaps', desc: 'Use the calendar to directly assign employees to open shifts. Check Weekly Staff Coverage to ensure everyone has 5 shifts.' },
]

export default function OnboardingBanner({ role }: OnboardingBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(`onboarding_dismissed_${role}`) === 'true'
  })

  function dismiss() {
    localStorage.setItem(`onboarding_dismissed_${role}`, 'true')
    setDismissed(true)
  }

  if (dismissed) return null

  const steps = role === 'manager' ? MANAGER_STEPS : EMPLOYEE_STEPS
  const title = role === 'manager'
    ? 'Welcome, Manager — here\'s how the scheduling cycle works'
    : 'Welcome to Operations Shifts — here is how it works'

  const subtitle = role === 'manager'
    ? 'Publish shifts, open requests, review, and fill gaps. Dismiss this guide once you\'re familiar.'
    : 'You can browse available shifts and request the ones you want to work.'

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold text-blue-900 text-base">{title}</h2>
          <p className="text-sm text-blue-700 mt-0.5">{subtitle}</p>
        </div>
        <button
          onClick={dismiss}
          className="text-blue-400 hover:text-blue-600 shrink-0 text-xs font-medium"
        >
          Dismiss
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((step, i) => (
          <div key={i} className="bg-white rounded-lg p-3 border border-blue-100">
            <div className="text-xl mb-1">{step.icon}</div>
            <p className="text-sm font-semibold text-gray-800 mb-0.5">
              <span className="text-blue-400 mr-1">{i + 1}.</span>{step.title}
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
