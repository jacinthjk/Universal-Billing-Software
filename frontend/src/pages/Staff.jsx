import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, LogIn, LogOut, Pencil, CalendarDays, Users, CalendarCheck, CalendarClock, Sheet, Check, X, Clock, AlarmClock, UserCheck, UserX, Plane } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { errMsg, openFile } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Tabs, Textarea, Toggle, act, useFetch } from '../components/ui'
import { date as fmtDate, today } from '../lib/format'

export const hm = (min) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : '—')
const WEEKDAYS = [['SUN', 'Sunday'], ['MON', 'Monday'], ['TUE', 'Tuesday'], ['WED', 'Wednesday'], ['THU', 'Thursday'], ['FRI', 'Friday'], ['SAT', 'Saturday'], ['NONE', 'No weekly off']]
const STATUSES = [['PRESENT', 'Present'], ['HALF_DAY', 'Half day'], ['ABSENT', 'Absent'], ['LEAVE', 'On leave'], ['HOLIDAY', 'Holiday'], ['WEEK_OFF', 'Week off']]
const LEAVE_TYPES = [['CASUAL', 'Casual leave'], ['SICK', 'Sick leave'], ['PAID', 'Paid / earned leave'], ['UNPAID', 'Unpaid leave']]
const opts = (list) => list.map(([value, label]) => ({ value, label }))

// Time of day in the business's timezone, e.g. "9:05 am".
function useClock() {
  const { business } = useAuth()
  const fmt = new Intl.DateTimeFormat('en-IN', { timeZone: business.timezone, hour: 'numeric', minute: '2-digit' })
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: business.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return { time: (d) => (d ? fmt.format(new Date(d)) : '—'), hhmm: (d) => (d ? hhmm.format(new Date(d)) : '') }
}

// ─────────────── My attendance (for staff whose login is linked to an employee) ───────────────

export function MyAttendance({ compact }) {
  const { hasModule } = useAuth()
  const { data, reload } = useFetch(hasModule('staff') ? '/staff/me' : null)
  const { time } = useClock()
  const [busy, setBusy] = useState(false)
  const [leave, setLeave] = useState(false)
  if (!data?.employee) return null
  const rec = data.today
  const inNow = rec?.punchIn && !rec.punchOut
  const punch = async (kind) => {
    setBusy(true)
    try { await act(() => api.post(`/staff/me/punch-${kind}`), kind === 'in' ? 'Punched in' : 'Punched out'); reload() } catch { /* toast shown */ } finally { setBusy(false) }
  }
  return (
    <Card className={compact ? '' : 'mb-4'} bodyClass="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${inNow ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-soft text-brand'}`}><AlarmClock className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-slate-800">My attendance · {data.employee.name}</div>
          <div className="text-sm text-slate-600">
            {!rec?.punchIn ? `Shift ${data.employee.shiftStart}–${data.employee.shiftEnd} · not punched in yet`
              : inNow ? `In since ${time(rec.punchIn)}${rec.lateMinutes ? ` · ${rec.lateMinutes} min late` : ''}`
                : `Worked ${hm(rec.minutes)} today (${time(rec.punchIn)} – ${time(rec.punchOut)})`}
            {' · '}{data.balance.left} leave days left
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {inNow
            ? <Button variant="danger" loading={busy} onClick={() => punch('out')}><LogOut className="size-4" /> Punch out</Button>
            : <Button variant="success" loading={busy} onClick={() => punch('in')}><LogIn className="size-4" /> {rec?.punchOut ? 'Punch in again' : 'Punch in'}</Button>}
          {!compact && <Button variant="secondary" onClick={() => setLeave(true)}><Plane className="size-4" /> Ask for leave</Button>}
        </div>
      </div>
      {leave && <LeaveForm self onClose={() => setLeave(false)} onSaved={() => { setLeave(false); reload() }} />}
    </Card>
  )
}

// ─────────────── Today (attendance board) ───────────────

function MarkDay({ row, date, onClose, onSaved }) {
  const { hhmm } = useClock()
  const r = row.record
  const [f, setF] = useState({ status: r?.status || (row.status === 'NOT_MARKED' ? 'PRESENT' : row.status), punchIn: hhmm(r?.punchIn) || row.employee.shiftStart, punchOut: hhmm(r?.punchOut), note: r?.note || '' })
  const timed = ['PRESENT', 'HALF_DAY'].includes(f.status)
  const save = async () => {
    await act(() => api.put('/staff/attendance', { employeeId: row.employee.id, date, status: f.status, punchIn: timed && f.punchIn ? f.punchIn : null, punchOut: timed && f.punchOut ? f.punchOut : null, note: f.note || null }), 'Attendance saved')
    onSaved()
  }
  const clear = async () => { await act(() => api.delete(`/staff/attendance/${row.employee.id}/${date}`), 'Cleared'); onSaved() }
  return (
    <Modal open onClose={onClose} title={`${row.employee.name} · ${fmtDate(date)}`}
      footer={<>{r && <Button variant="ghost" onClick={clear}>Clear day</Button>}<Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" className="sm:col-span-2"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={opts(STATUSES)} /></Field>
        {timed && <>
          <Field label="Punch in"><Input type="time" value={f.punchIn} onChange={(e) => setF({ ...f, punchIn: e.target.value })} /></Field>
          <Field label="Punch out" hint="Leave empty if still working"><Input type="time" value={f.punchOut} onChange={(e) => setF({ ...f, punchOut: e.target.value })} /></Field>
        </>}
        <Field label="Note" className="sm:col-span-2"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Optional" /></Field>
      </div>
    </Modal>
  )
}

function Today() {
  const { can } = useAuth()
  const [day, setDay] = useState(today())
  const { data, loading, reload } = useFetch(`/staff/attendance?date=${day}`)
  const { time } = useClock()
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(null)
  const isToday = day === today()
  const manage = can('staff.manage')
  const punch = async (row, kind) => {
    setBusy(row.employee.id)
    try { await api.post(`/staff/attendance/${row.employee.id}/punch-${kind}`); toast.success(`${row.employee.name} punched ${kind}`); reload() } catch (e) { toast.error(errMsg(e)) } finally { setBusy(null) }
  }
  const tiles = data && [
    ['Employees', data.totals.employees, Users, 'bg-slate-100 text-slate-700'],
    ['Present', data.totals.present, UserCheck, 'bg-emerald-100 text-emerald-700'],
    ['Working now', data.totals.inNow, Clock, 'bg-blue-100 text-blue-700'],
    ['Came late', data.totals.late, AlarmClock, 'bg-amber-100 text-amber-800'],
    ['On leave', data.totals.leave, Plane, 'bg-violet-100 text-violet-700'],
    ['Not in', data.totals.absent + data.totals.notMarked, UserX, 'bg-red-100 text-red-700'],
  ]
  return (
    <div className="space-y-4">
      <MyAttendance compact />
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" className="w-44" value={day} max={today()} onChange={(e) => setDay(e.target.value || today())} />
        {!isToday && <Button size="sm" variant="secondary" onClick={() => setDay(today())}>Back to today</Button>}
      </div>
      {loading || !data ? <Spinner /> : <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map(([label, n, Icon, cls]) => (
            <div key={label} className="card flex items-center gap-2.5 p-3">
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${cls}`}><Icon className="size-4.5" /></span>
              <div className="min-w-0"><div className="text-xl font-bold leading-tight">{n}</div><div className="truncate text-xs text-slate-600">{label}</div></div>
            </div>
          ))}
        </div>
        <Card bodyClass="p-0 overflow-x-auto">
          {!data.list.length ? <Empty title="No employees yet">Add your team under Employee details.</Empty> : (
            <table className="table-base">
              <thead><tr><th>Employee</th><th>Status</th><th>Punch in</th><th>Punch out</th><th className="text-right">Hours</th><th className="text-right">Late</th>{manage && <th className="text-right">Actions</th>}</tr></thead>
              <tbody>{data.list.map((row) => (
                <tr key={row.employee.id}>
                  <td><div className="font-semibold">{row.employee.name}</div><div className="text-xs text-slate-500">{row.employee.designation || row.employee.code} · shift {row.employee.shiftStart}–{row.employee.shiftEnd}</div></td>
                  <td><StatusBadge status={row.status} />{row.inNow && <div className="mt-0.5 text-xs font-semibold text-emerald-700">● working now</div>}</td>
                  <td>{time(row.record?.punchIn)}</td>
                  <td>{time(row.record?.punchOut)}</td>
                  <td className="text-right font-medium">{hm(row.workingMinutes)}</td>
                  <td className={`text-right ${row.record?.lateMinutes ? 'font-semibold text-amber-800' : 'text-slate-400'}`}>{row.record?.lateMinutes ? `${row.record.lateMinutes} min` : '—'}</td>
                  {manage && (
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {isToday && !['LEAVE'].includes(row.status) && (row.inNow
                          ? <Button size="sm" variant="secondary" loading={busy === row.employee.id} onClick={() => punch(row, 'out')}><LogOut className="size-3.5" /> Out</Button>
                          : <Button size="sm" variant="success" loading={busy === row.employee.id} onClick={() => punch(row, 'in')}><LogIn className="size-3.5" /> In</Button>)}
                        <Button size="sm" variant="ghost" onClick={() => setEdit(row)} aria-label={`Edit ${row.employee.name}`}><Pencil className="size-3.5" /></Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </>}
      {edit && <MarkDay row={edit} date={day} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </div>
  )
}

// ─────────────── Employee details ───────────────

function EmployeeForm({ employee, users, onClose, onSaved }) {
  const e = employee
  const [f, setF] = useState({
    name: e?.name || '', phone: e?.phone || '', email: e?.email || '', designation: e?.designation || '', department: e?.department || '',
    joinDate: e?.joinDate ? e.joinDate.slice(0, 10) : '', salary: e?.salary ?? '', shiftStart: e?.shiftStart || '09:00', shiftEnd: e?.shiftEnd || '18:00',
    weekOff: e?.weekOff || 'SUN', leaveQuota: e?.leaveQuota ?? 12, userId: e?.userId || '', active: e ? e.active : true, notes: e?.notes || '',
  })
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value })
  const save = async () => {
    const body = { ...f, phone: f.phone || null, email: f.email || null, designation: f.designation || null, department: f.department || null, joinDate: f.joinDate || null, salary: f.salary === '' ? null : Number(f.salary), leaveQuota: Number(f.leaveQuota) || 0, userId: f.userId || null, notes: f.notes || null }
    await act(() => (e ? api.put(`/staff/employees/${e.id}`, body) : api.post('/staff/employees', body)), 'Employee saved')
    onSaved()
  }
  return (
    <Modal open size="lg" onClose={onClose} title={e ? `Edit ${e.name}` : 'New employee'} footer={<Button onClick={save} disabled={!f.name}>Save</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Mobile"><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Designation / role"><Input value={f.designation} onChange={set('designation')} placeholder="e.g. Cashier" /></Field>
        <Field label="Department"><Input value={f.department} onChange={set('department')} /></Field>
        <Field label="Joining date"><Input type="date" value={f.joinDate} onChange={set('joinDate')} /></Field>
        <Field label="Monthly salary" hint="Optional, for your records"><Input type="number" min="0" value={f.salary} onChange={set('salary')} /></Field>
        <Field label="Shift starts" hint="Punching in after this counts as late"><Input type="time" value={f.shiftStart} onChange={set('shiftStart')} /></Field>
        <Field label="Shift ends"><Input type="time" value={f.shiftEnd} onChange={set('shiftEnd')} /></Field>
        <Field label="Weekly off"><Select value={f.weekOff} onChange={set('weekOff')} options={opts(WEEKDAYS)} /></Field>
        <Field label="Paid leave per year (days)"><Input type="number" min="0" value={f.leaveQuota} onChange={set('leaveQuota')} /></Field>
        <Field label="Linked login" hint="Lets this person punch in / out from their own phone" className="sm:col-span-2">
          <Select value={f.userId} onChange={set('userId')} options={[{ value: '', label: 'Not linked' }, ...users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))]} />
        </Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
        {e && <div className="sm:col-span-2"><Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Currently working here" description="Turn off when someone leaves; their history is kept" /></div>}
      </div>
    </Modal>
  )
}

function Employees() {
  const { can } = useAuth()
  const [showAll, setShowAll] = useState(false)
  const { data, loading, reload } = useFetch(`/staff/employees${showAll ? '?active=all' : ''}`)
  const [form, setForm] = useState(null)
  const manage = can('staff.manage')
  const users = data?.users || []
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show people who have left</label>
        {manage && <Button onClick={() => setForm({})}><Plus className="size-4" /> Add employee</Button>}
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {loading || !data ? <Spinner /> : !data.employees.length ? <Empty title="No employees yet">Add the people who work for you to track attendance and leave.</Empty> : (
          <table className="table-base">
            <thead><tr><th>Employee</th><th>Contact</th><th>Shift</th><th>Weekly off</th><th className="text-right">Leave left</th><th>Login</th>{manage && <th />}</tr></thead>
            <tbody>{data.employees.map((e) => (
              <tr key={e.id} className={e.active ? '' : 'opacity-60'}>
                <td><div className="font-semibold">{e.name} <span className="text-xs font-normal text-slate-400">{e.code}</span></div><div className="text-xs text-slate-500">{[e.designation, e.department].filter(Boolean).join(' · ') || '—'}{e.joinDate ? ` · since ${fmtDate(e.joinDate)}` : ''}</div>{!e.active && <Badge>Left</Badge>}</td>
                <td className="text-slate-600">{e.phone || '—'}<div className="text-xs">{e.email}</div></td>
                <td>{e.shiftStart}–{e.shiftEnd}</td>
                <td>{WEEKDAYS.find(([k]) => k === e.weekOff)?.[1] || '—'}</td>
                <td className="text-right"><b>{e.leaveBalance.left}</b><span className="text-xs text-slate-500"> / {e.leaveBalance.quota}</span></td>
                <td>{e.userId ? <Badge color="green">{users.find((u) => u.id === e.userId)?.name || 'Linked'}</Badge> : <span className="text-slate-400">—</span>}</td>
                {manage && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setForm(e)}><Pencil className="size-3.5" /> Edit</Button></td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {form && <EmployeeForm employee={form.id ? form : null} users={users} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />}
    </div>
  )
}

// ─────────────── Leave ───────────────

function LeaveForm({ self, onClose, onSaved }) {
  const { data } = useFetch(self ? null : '/staff/employees')
  const [f, setF] = useState({ employeeId: '', type: 'CASUAL', fromDate: today(), toDate: today(), halfDay: false, reason: '', approve: !self })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    const body = { type: f.type, fromDate: f.fromDate, toDate: f.toDate < f.fromDate ? f.fromDate : f.toDate, halfDay: f.halfDay, reason: f.reason || undefined }
    await act(() => (self ? api.post('/staff/me/leave', body) : api.post('/staff/leaves', { ...body, employeeId: f.employeeId, approve: f.approve })), self ? 'Leave request sent' : 'Leave saved')
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title={self ? 'Ask for leave' : 'Record leave'} footer={<Button onClick={save} disabled={!self && !f.employeeId}>{self ? 'Send request' : 'Save'}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!self && <Field label="Employee" className="sm:col-span-2"><Select value={f.employeeId} onChange={set('employeeId')} options={[{ value: '', label: 'Choose…' }, ...(data?.employees || []).map((e) => ({ value: e.id, label: `${e.name} · ${e.leaveBalance.left} days left` }))]} /></Field>}
        <Field label="Type of leave" className="sm:col-span-2"><Select value={f.type} onChange={set('type')} options={opts(LEAVE_TYPES)} /></Field>
        <Field label="From"><Input type="date" value={f.fromDate} onChange={set('fromDate')} /></Field>
        <Field label="To"><Input type="date" value={f.toDate} min={f.fromDate} onChange={set('toDate')} /></Field>
        {f.fromDate === f.toDate && <div className="sm:col-span-2"><Toggle checked={f.halfDay} onChange={(v) => setF({ ...f, halfDay: v })} label="Half day only" /></div>}
        <Field label="Reason" className="sm:col-span-2"><Textarea value={f.reason} onChange={set('reason')} /></Field>
        {!self && <div className="sm:col-span-2"><Toggle checked={f.approve} onChange={(v) => setF({ ...f, approve: v })} label="Approve now" description="Marks these days as leave on the attendance sheet" /></div>}
      </div>
    </Modal>
  )
}

function Leave() {
  const { can } = useAuth()
  const [status, setStatus] = useState('')
  const { data, loading, reload } = useFetch(`/staff/leaves${status ? `?status=${status}` : ''}`)
  const [form, setForm] = useState(false)
  const manage = can('staff.manage')
  const decide = async (l, s) => { await act(() => api.put(`/staff/leaves/${l.id}`, { status: s }), s === 'APPROVED' ? 'Leave approved' : 'Leave rejected'); reload() }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All requests' }, { value: 'PENDING', label: 'Waiting for approval' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />
        {manage && <Button onClick={() => setForm(true)}><Plus className="size-4" /> Record leave</Button>}
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {loading || !data ? <Spinner /> : !data.leaves.length ? <Empty title="No leave requests" /> : (
          <table className="table-base">
            <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th className="text-right">Days</th><th>Reason</th><th>Status</th>{manage && <th />}</tr></thead>
            <tbody>{data.leaves.map((l) => (
              <tr key={l.id}>
                <td className="font-semibold">{l.employee.name}</td>
                <td>{LEAVE_TYPES.find(([k]) => k === l.type)?.[1] || l.type}</td>
                <td>{fmtDate(l.fromDate)}{l.toDate !== l.fromDate && <> – {fmtDate(l.toDate)}</>}</td>
                <td className="text-right">{Number(l.days)}</td>
                <td className="max-w-60 truncate text-slate-600" title={l.reason || ''}>{l.reason || '—'}</td>
                <td><StatusBadge status={l.status} /></td>
                {manage && (
                  <td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {l.status !== 'APPROVED' && <Button size="sm" variant="success" onClick={() => decide(l, 'APPROVED')}><Check className="size-3.5" /> Approve</Button>}
                      {l.status !== 'REJECTED' && <Button size="sm" variant="secondary" onClick={() => decide(l, 'REJECTED')}><X className="size-3.5" /> Reject</Button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {form && <LeaveForm onClose={() => setForm(false)} onSaved={() => { setForm(false); reload() }} />}
    </div>
  )
}

// ─────────────── Monthly summary ───────────────

function Monthly() {
  const [month, setMonth] = useState(today().slice(0, 7))
  const { data, loading } = useFetch(`/staff/summary?month=${month}`)
  const [busy, setBusy] = useState(false)
  const exportXlsx = async () => {
    setBusy(true)
    try { await openFile(`/staff/summary.xlsx?month=${month}`, { download: true, filename: `attendance-${month}.xlsx` }) } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="month" className="w-44" value={month} max={today().slice(0, 7)} onChange={(e) => setMonth(e.target.value || today().slice(0, 7))} />
        {data && <span className="text-sm text-slate-600">{data.days} days counted ({fmtDate(data.from)} – {fmtDate(data.to)})</span>}
        <Button className="ml-auto" size="sm" variant="secondary" loading={busy} onClick={exportXlsx}>{!busy && <Sheet className="size-3.5" />} Excel</Button>
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {loading || !data ? <Spinner /> : !data.employees.length ? <Empty title="No attendance this month" /> : (
          <table className="table-base">
            <thead><tr><th>Employee</th><th className="text-right">Days worked</th><th className="text-right">Present</th><th className="text-right">Half days</th><th className="text-right">Leave</th><th className="text-right">Absent</th><th className="text-right">Not marked</th><th className="text-right">Late</th><th className="text-right">Hours worked</th><th className="text-right">Avg / day</th></tr></thead>
            <tbody>{data.employees.map((r) => (
              <tr key={r.employee.id}>
                <td><div className="font-semibold">{r.employee.name}</div><div className="text-xs text-slate-500">{r.employee.designation || r.employee.code}</div></td>
                <td className="text-right font-bold">{r.workedDays}</td>
                <td className="text-right">{r.present}</td>
                <td className="text-right">{r.halfDay}</td>
                <td className="text-right">{r.leave}</td>
                <td className={`text-right ${r.absent ? 'font-semibold text-red-700' : ''}`}>{r.absent}</td>
                <td className={`text-right ${r.notMarked ? 'text-amber-800' : 'text-slate-400'}`}>{r.notMarked}</td>
                <td className={`text-right ${r.late ? 'text-amber-800' : 'text-slate-400'}`}>{r.late}{r.late ? <span className="text-xs"> ({hm(r.lateMinutes)})</span> : ''}</td>
                <td className="text-right font-medium">{hm(r.minutes)}</td>
                <td className="text-right text-slate-600">{hm(r.avgMinutes)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <p className="text-sm text-slate-500">"Not marked" are working days with no punch or status. Weekly offs are not counted against anyone.</p>
    </div>
  )
}

export default function Staff() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'today'
  return (
    <div>
      <PageHeader title="Employees" subtitle="Attendance, punch in / out, working hours and leave" />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={[
        { value: 'today', label: 'Attendance', icon: CalendarCheck },
        { value: 'employees', label: 'Employee details', icon: Users },
        { value: 'leave', label: 'Leave', icon: CalendarClock },
        { value: 'monthly', label: 'Monthly report', icon: CalendarDays },
      ]} />
      {tab === 'today' && <Today />}
      {tab === 'employees' && <Employees />}
      {tab === 'leave' && <Leave />}
      {tab === 'monthly' && <Monthly />}
    </div>
  )
}
