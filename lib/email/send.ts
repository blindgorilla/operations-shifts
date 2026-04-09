import { Resend } from 'resend'
import type { Shift, Employee } from '@/types'
import { format, parseISO } from 'date-fns'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = 'Operations Shifts <onboarding@resend.dev>'

function formatShiftDate(shift: Shift): string {
  return format(parseISO(shift.date), 'EEEE, d MMMM yyyy')
}

function shiftLabel(shift: Shift): string {
  return `${shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)} shift — ${shift.start_time.slice(0, 5)} to ${shift.end_time.slice(0, 5)}${shift.location ? ` @ ${shift.location}` : ''}`
}

export async function sendNewRequestEmail(managers: Employee[], employee: Employee, shift: Shift) {
  if (managers.length === 0) return

  const subject = `New Shift Request — ${employee.name} · ${formatShiftDate(shift)}`

  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #111;">
      <div style="background:#2563eb;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="color:#fff;margin:0;font-size:18px;">New Shift Request</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <p style="margin:0 0 16px;"><strong>${employee.name}</strong> has requested a shift and is awaiting your approval.</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:16px;margin-bottom:16px;">
          <p style="margin:0 0 4px;font-weight:600;">${formatShiftDate(shift)}</p>
          <p style="margin:0;color:#374151;">${shiftLabel(shift)}</p>
          ${shift.role_required ? `<p style="margin:4px 0 0;color:#6b7280;font-size:14px;">Role: ${shift.role_required}</p>` : ''}
        </div>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/manager/requests"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">
          Review Request
        </a>
        <p style="margin:16px 0 0;font-size:13px;color:#9ca3af;">Log in to Operations Shifts to approve or deny this request.</p>
      </div>
    </div>
  `

  await resend.emails.send({
    from: FROM,
    to: managers.map(m => m.email),
    subject,
    html,
  })
}

export async function sendApprovalEmail(employee: Employee, shift: Shift, managerNote?: string | null) {
  const subject = `Shift Request Approved — ${formatShiftDate(shift)}`

  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #111;">
      <div style="background:#16a34a;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="color:#fff;margin:0;font-size:18px;">Shift Request Approved</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <p style="margin:0 0 16px;">Hi <strong>${employee.name}</strong>,</p>
        <p style="margin:0 0 16px;">Your shift request has been <strong style="color:#16a34a;">approved</strong>.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin-bottom:16px;">
          <p style="margin:0 0 4px;font-weight:600;">${formatShiftDate(shift)}</p>
          <p style="margin:0;color:#374151;">${shiftLabel(shift)}</p>
          ${shift.role_required ? `<p style="margin:4px 0 0;color:#6b7280;font-size:14px;">Role: ${shift.role_required}</p>` : ''}
        </div>
        ${managerNote ? `<div style="background:#f9fafb;border-left:3px solid #d1d5db;padding:12px 16px;margin-bottom:16px;border-radius:0 4px 4px 0;"><p style="margin:0;font-size:14px;color:#374151;"><strong>Manager note:</strong> ${managerNote}</p></div>` : ''}
        <p style="margin:0;font-size:14px;color:#6b7280;">Please ensure you arrive on time. Contact your manager if you have any questions.</p>
      </div>
    </div>
  `

  await resend.emails.send({ from: FROM, to: employee.email, subject, html })
}

export async function sendDenialEmail(employee: Employee, shift: Shift, managerNote?: string | null) {
  const subject = `Shift Request Update — ${formatShiftDate(shift)}`

  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #111;">
      <div style="background:#dc2626;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="color:#fff;margin:0;font-size:18px;">Shift Request Not Approved</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <p style="margin:0 0 16px;">Hi <strong>${employee.name}</strong>,</p>
        <p style="margin:0 0 16px;">Unfortunately your shift request has been <strong style="color:#dc2626;">denied</strong>.</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px;margin-bottom:16px;">
          <p style="margin:0 0 4px;font-weight:600;">${formatShiftDate(shift)}</p>
          <p style="margin:0;color:#374151;">${shiftLabel(shift)}</p>
        </div>
        ${managerNote ? `<div style="background:#f9fafb;border-left:3px solid #d1d5db;padding:12px 16px;margin-bottom:16px;border-radius:0 4px 4px 0;"><p style="margin:0;font-size:14px;color:#374151;"><strong>Reason:</strong> ${managerNote}</p></div>` : ''}
        <p style="margin:0;font-size:14px;color:#6b7280;">Other shifts may still be available. Please check the calendar and speak to your manager if you have questions.</p>
      </div>
    </div>
  `

  await resend.emails.send({ from: FROM, to: employee.email, subject, html })
}
