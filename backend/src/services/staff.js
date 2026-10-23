// Employees, attendance (punch in / punch out) and leave. Dates are YYYY-MM-DD in the business timezone.
const ExcelJS = require('exceljs');
const { prisma } = require('../lib/prisma');
const { badRequest, notFound } = require('../lib/errors');
const { n, dayRange, todayIn, timeIn, addDays } = require('../lib/util');

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const PAID_LEAVE = ['CASUAL', 'SICK', 'PAID'];
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const weekday = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "HH:MM" on a business-local date → absolute time. */
function atLocalTime(business, date, hhmm) {
  return new Date(dayRange(date, business.timezone).start.getTime() + toMin(hhmm) * 60000);
}

// Late minutes against the shift start, and worked minutes between punches.
function computeTimes(business, emp, row) {
  const out = { lateMinutes: 0, minutes: 0 };
  if (row.punchIn) out.lateMinutes = Math.max(0, toMin(timeIn(business.timezone, row.punchIn)) - toMin(emp.shiftStart));
  if (row.punchIn && row.punchOut) out.minutes = Math.max(0, Math.round((row.punchOut - row.punchIn) / 60000));
  return out;
}

async function nextCode(businessId) {
  const count = await prisma.employee.count({ where: { businessId } });
  for (let i = count + 1; ; i += 1) {
    const code = `EMP-${String(i).padStart(3, '0')}`;
    if (!(await prisma.employee.findUnique({ where: { businessId_code: { businessId, code } } }))) return code;
  }
}

async function getEmployee(businessId, id) {
  const emp = await prisma.employee.findFirst({ where: { id, businessId } });
  if (!emp) throw notFound('Employee not found');
  return emp;
}

async function punch(business, emp, kind, { source = 'SELF', userId } = {}) {
  const date = todayIn(business.timezone);
  const now = new Date();
  const row = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date } } });
  if (kind === 'in') {
    if (row?.punchIn && !row.punchOut) throw badRequest(`${emp.name} is already punched in`);
    // Punching in again after punching out continues the same day: the first punch-in is kept.
    const data = { status: 'PRESENT', punchIn: row?.punchIn || now, punchOut: null, source, updatedById: userId || null };
    Object.assign(data, computeTimes(business, emp, data), { minutes: 0 });
    return prisma.attendance.upsert({ where: { employeeId_date: { employeeId: emp.id, date } }, create: { businessId: business.id, employeeId: emp.id, date, ...data }, update: data });
  }
  if (!row?.punchIn) throw badRequest(`${emp.name} has not punched in today`);
  if (row.punchOut) throw badRequest(`${emp.name} has already punched out`);
  const data = { punchOut: now, updatedById: userId || null };
  const times = computeTimes(business, emp, { punchIn: row.punchIn, punchOut: now });
  // Under half the shift length counts as a half day.
  const shift = Math.max(toMin(emp.shiftEnd) - toMin(emp.shiftStart), 60);
  return prisma.attendance.update({ where: { id: row.id }, data: { ...data, ...times, status: times.minutes < shift / 2 ? 'HALF_DAY' : 'PRESENT' } });
}

/** Set a day by hand (manager): status plus optional HH:MM punch times. */
async function markDay(business, emp, { date, status, punchIn, punchOut, note }, userId) {
  const data = {
    status, note: note || null, source: 'MANUAL', updatedById: userId,
    punchIn: punchIn ? atLocalTime(business, date, punchIn) : null,
    punchOut: punchOut ? atLocalTime(business, date, punchOut) : null,
  };
  if (data.punchIn && data.punchOut && data.punchOut < data.punchIn) data.punchOut = new Date(data.punchOut.getTime() + 86400000); // night shift
  Object.assign(data, ['PRESENT', 'HALF_DAY'].includes(status) ? computeTimes(business, emp, data) : { minutes: 0, lateMinutes: 0 });
  return prisma.attendance.upsert({ where: { employeeId_date: { employeeId: emp.id, date } }, create: { businessId: business.id, employeeId: emp.id, date, ...data }, update: data });
}

/** Attendance board for one day: every active employee with their record (or approved leave). */
async function dayBoard(business, date) {
  const [employees, rows, leaves] = await Promise.all([
    prisma.employee.findMany({ where: { businessId: business.id, active: true }, orderBy: { name: 'asc' } }),
    prisma.attendance.findMany({ where: { businessId: business.id, date } }),
    prisma.leaveRequest.findMany({ where: { businessId: business.id, status: 'APPROVED', fromDate: { lte: date }, toDate: { gte: date } } }),
  ]);
  const byEmp = Object.fromEntries(rows.map((r) => [r.employeeId, r]));
  const onLeave = Object.fromEntries(leaves.map((l) => [l.employeeId, l]));
  const now = new Date();
  const list = employees.map((e) => {
    const r = byEmp[e.id];
    // While still punched in, show hours worked so far.
    const inNow = !!(r?.punchIn && !r.punchOut && date === todayIn(business.timezone));
    const live = inNow ? Math.round((now - r.punchIn) / 60000) : null;
    const status = r?.status || (onLeave[e.id] ? 'LEAVE' : weekday(date) === e.weekOff ? 'WEEK_OFF' : 'NOT_MARKED');
    return { employee: e, record: r || null, status, workingMinutes: live ?? r?.minutes ?? 0, inNow, leave: onLeave[e.id] || null };
  });
  const count = (s) => list.filter((x) => x.status === s).length;
  return { date, list, totals: { employees: list.length, present: count('PRESENT') + count('HALF_DAY'), inNow: list.filter((x) => x.inNow).length, late: list.filter((x) => x.record?.lateMinutes > 0).length, leave: count('LEAVE'), absent: count('ABSENT'), notMarked: count('NOT_MARKED') } };
}

/** Month summary per employee. Days after today are not counted. */
async function monthSummary(business, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('Month must be YYYY-MM');
  const from = `${month}-01`;
  const last = addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);
  const today = todayIn(business.timezone);
  const to = last < today ? last : today;
  const [employees, rows] = await Promise.all([
    prisma.employee.findMany({ where: { businessId: business.id }, orderBy: { name: 'asc' } }),
    prisma.attendance.findMany({ where: { businessId: business.id, date: { gte: from, lte: last } } }),
  ]);
  const days = from <= to ? datesBetween(from, to) : [];
  const out = employees.map((e) => {
    const mine = Object.fromEntries(rows.filter((r) => r.employeeId === e.id).map((r) => [r.date, r]));
    const s = { present: 0, halfDay: 0, absent: 0, leave: 0, weekOff: 0, holiday: 0, notMarked: 0, late: 0, lateMinutes: 0, minutes: 0 };
    const joined = e.joinDate ? todayIn(business.timezone, e.joinDate) : todayIn(business.timezone, e.createdAt);
    for (const d of days) {
      if (d < joined) continue;
      const r = mine[d];
      if (!r) { if (weekday(d) === e.weekOff) s.weekOff += 1; else if (e.active) s.notMarked += 1; continue; }
      ({ PRESENT: () => { s.present += 1; }, HALF_DAY: () => { s.halfDay += 1; }, ABSENT: () => { s.absent += 1; }, LEAVE: () => { s.leave += 1; }, WEEK_OFF: () => { s.weekOff += 1; }, HOLIDAY: () => { s.holiday += 1; } }[r.status] || (() => {}))();
      if (r.lateMinutes > 0) { s.late += 1; s.lateMinutes += r.lateMinutes; }
      s.minutes += r.minutes;
    }
    const worked = s.present + s.halfDay;
    return { employee: { id: e.id, code: e.code, name: e.name, designation: e.designation, active: e.active }, ...s, workedDays: s.present + s.halfDay / 2, avgMinutes: worked ? Math.round(s.minutes / worked) : 0 };
  }).filter((x) => x.employee.active || x.minutes || x.present || x.leave);
  return { month, from, to, days: days.length, employees: out };
}

async function leaveBalance(businessId, emp, year) {
  const agg = await prisma.leaveRequest.aggregate({ where: { businessId, employeeId: emp.id, status: 'APPROVED', type: { in: PAID_LEAVE }, fromDate: { gte: `${year}-01-01`, lte: `${year}-12-31` } }, _sum: { days: true } });
  const used = n(agg._sum.days);
  return { quota: emp.leaveQuota, used, left: Math.max(emp.leaveQuota - used, 0) };
}

/** Approve or reject; approval marks each day of the leave on the attendance sheet. */
async function decideLeave(business, leave, status, userId) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.leaveRequest.update({ where: { id: leave.id }, data: { status, decidedById: userId, decidedAt: new Date() } });
    const dates = datesBetween(leave.fromDate, leave.toDate);
    if (status === 'APPROVED') {
      for (const date of dates) {
        const row = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: leave.employeeId, date } } });
        if (row?.punchIn) continue; // they came in after all
        const data = { status: 'LEAVE', note: `${leave.type.toLowerCase()} leave`, source: 'LEAVE', minutes: 0, lateMinutes: 0, updatedById: userId };
        await tx.attendance.upsert({ where: { employeeId_date: { employeeId: leave.employeeId, date } }, create: { businessId: business.id, employeeId: leave.employeeId, date, ...data }, update: data });
      }
    } else if (leave.status === 'APPROVED') {
      // Un-approving clears the leave days it had marked.
      await tx.attendance.deleteMany({ where: { employeeId: leave.employeeId, date: { in: dates }, source: 'LEAVE' } });
    }
    return updated;
  });
}

const hours = (min) => Math.round((min / 60) * 100) / 100;

async function summaryWorkbook(business, summary) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 4 }] });
  const brand = (business.theme.primary || '#2563eb').replace('#', '').toUpperCase();
  ws.getCell('A1').value = `${business.name} - Attendance ${summary.month}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: `FF${brand}` } };
  ws.getCell('A2').value = `${summary.from} to ${summary.to} · ${summary.days} days counted`;
  const cols = [['Code', 10], ['Employee', 26], ['Designation', 18], ['Present', 10], ['Half days', 10], ['Days worked', 12], ['Leave', 8], ['Absent', 8], ['Not marked', 12], ['Week off', 10], ['Late days', 10], ['Late (hrs)', 10], ['Hours worked', 13], ['Avg hrs/day', 12]];
  const header = ws.getRow(4);
  cols.forEach(([h, w], i) => { header.getCell(i + 1).value = h; ws.getColumn(i + 1).width = w; });
  header.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${brand}` } }; });
  for (const r of summary.employees) {
    ws.addRow([r.employee.code, r.employee.name, r.employee.designation || '', r.present, r.halfDay, r.workedDays, r.leave, r.absent, r.notMarked, r.weekOff, r.late, hours(r.lateMinutes), hours(r.minutes), hours(r.avgMinutes)]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { WEEKDAYS, nextCode, getEmployee, punch, markDay, dayBoard, monthSummary, leaveBalance, decideLeave, summaryWorkbook, datesBetween };
