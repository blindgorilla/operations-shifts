import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function ManagerRequestsPage() {
  redirect('/manager/schedule')
}
