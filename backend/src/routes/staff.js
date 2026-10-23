const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, badRequest, forbidden, notFound } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { todayIn } = require('../lib/util');
const { audit, notify } = require('../lib/audit');
const staff = require('../services/staff');

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^\d{1,2}:\d{2}$/;
const STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEK_OFF'];
const LEAVE_TYPES = ['CASUAL', 'SICK', 'PAID', 'UNPAID'];

// ───── My attendance (any member linked to an employee record) ─────

async function myEmployee(req) {
  const emp = await prisma.employee.findFirst({ where: { businessId: req.businessId, userId: req.user.id, active: true } });
  if (!emp) throw notFound('Your login is not linked to an employee record');
  return emp;
}

router.get('/me', ah(async (req, res) => {
  const emp = await prisma.employee.findFirst({ where: { businessId: req.businessId, userId: req.user.id, active: true } });
  if (!emp) return res.json({ employee: null });
  const date = todayIn(req.business.timezone);
  const [today, leaves, balance] = await Promise.all([
    prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date } } }),
    prisma.leaveRequest.findMany({ where: { employeeId: emp.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    staff.leaveBalance(req.businessId, emp, date.slice(0, 4)),
  ]);
  res.json({ employee: emp, today, leaves, balance });
}));

router.post('/me/punch-in', ah(async (req, res) => {
  res.json({ record: await staff.punch(req.business, await myEmployee(req), 'in', { source: 'SELF', userId: req.user.id }) });
}));

router.post('/me/punch-out', ah(async (req, res) => {
  res.json({ record: await staff.punch(req.business, await myEmployee(req), 'out', { source: 'SELF', userId: req.user.id }) });
}));

const leaveSchema = z.object({
  type: z.enum(LEAVE_TYPES).default('CASUAL'),
  fromDate: z.string().regex(dateRe), toDate: z.string().regex(dateRe),
  halfDay: z.boolean().optional(), reason: z.string().max(500).optional(),
});
const leaveDays = (b) => {
  if (b.toDate < b.fromDate) throw badRequest('Leave must end on or after the start date');
  return b.halfDay && b.fromDate === b.toDate ? 0.5 : staff.datesBetween(b.fromDate, b.toDate).length;
};

router.post('/me/leave', validate(leaveSchema), ah(async (req, res) => {
  const emp = await myEmployee(req);
  const leave = await prisma.leaveRequest.create({ data: { businessId: req.businessId, employeeId: emp.id, type: req.body.type, fromDate: req.body.fromDate, toDate: req.body.toDate, days: leaveDays(req.body), reason: req.body.reason || null } });
  await notify(req.businessId, { type: 'LEAVE', title: `Leave request from ${emp.name}`, body: `${req.body.fromDate} to ${req.body.toDate}`, link: '/staff?tab=leave' });
  res.status(201).json({ leave });
}));

// ───── Employees ─────

router.get('/employees', requirePerm('staff.view', 'staff.manage'), ah(async (req, res) => {
  const where = { businessId: req.businessId };
  if (req.query.active !== 'all') where.active = true;
  if (req.query.q) where.OR = ['name', 'code', 'phone', 'designation'].map((k) => ({ [k]: { contains: req.query.q, mode: 'insensitive' } }));
  const [employees, members] = await Promise.all([
    prisma.employee.findMany({ where, orderBy: { name: 'asc' } }),
    // Logins in this business, so an employee can be linked to one for self punch-in.
    prisma.membership.findMany({ where: { businessId: req.businessId, active: true }, select: { user: { select: { id: true, name: true, email: true } } } }),
  ]);
  const year = todayIn(req.business.timezone).slice(0, 4);
  const balances = await Promise.all(employees.map((e) => staff.leaveBalance(req.businessId, e, year)));
  res.json({ employees: employees.map((e, i) => ({ ...e, leaveBalance: balances[i] })), users: members.map((m) => m.user) });
}));

const empSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().max(20).nullable().optional(), email: z.string().max(120).nullable().optional(),
  designation: z.string().max(60).nullable().optional(), department: z.string().max(60).nullable().optional(),
  joinDate: z.string().regex(dateRe).nullable().optional(),
  salary: z.coerce.number().min(0).nullable().optional(),
  shiftStart: z.string().regex(timeRe).optional(), shiftEnd: z.string().regex(timeRe).optional(),
  weekOff: z.enum([...staff.WEEKDAYS, 'NONE']).optional(),
  leaveQuota: z.coerce.number().int().min(0).max(365).optional(),
  userId: z.string().nullable().optional(), active: z.boolean().optional(), notes: z.string().max(1000).nullable().optional(),
});

async function checkUser(req, userId, exceptId) {
  if (!userId) return;
  const m = await prisma.membership.findUnique({ where: { userId_businessId: { userId, businessId: req.businessId } } });
  if (!m) throw badRequest('That login is not part of this business');
  const taken = await prisma.employee.findFirst({ where: { businessId: req.businessId, userId, id: { not: exceptId || '' } } });
  if (taken) throw badRequest(`That login is already linked to ${taken.name}`);
}
const empData = (b) => ({ ...b, ...(b.joinDate !== undefined ? { joinDate: b.joinDate ? new Date(b.joinDate) : null } : {}) });

router.post('/employees', requirePerm('staff.manage'), validate(empSchema), ah(async (req, res) => {
  await checkUser(req, req.body.userId);
  const employee = await prisma.employee.create({ data: { ...empData(req.body), businessId: req.businessId, code: await staff.nextCode(req.businessId) } });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'employee.create', entity: 'Employee', entityId: employee.id });
  res.status(201).json({ employee });
}));

router.put('/employees/:id', requirePerm('staff.manage'), validate(empSchema.partial()), ah(async (req, res) => {
  const emp = await staff.getEmployee(req.businessId, req.params.id);
  await checkUser(req, req.body.userId, emp.id);
  const employee = await prisma.employee.update({ where: { id: emp.id }, data: empData(req.body) });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'employee.update', entity: 'Employee', entityId: emp.id });
  res.json({ employee });
}));

router.get('/employees/:id', requirePerm('staff.view', 'staff.manage'), ah(async (req, res) => {
  const emp = await staff.getEmployee(req.businessId, req.params.id);
  const [attendance, leaves, balance] = await Promise.all([
    prisma.attendance.findMany({ where: { employeeId: emp.id }, orderBy: { date: 'desc' }, take: 62 }),
    prisma.leaveRequest.findMany({ where: { employeeId: emp.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    staff.leaveBalance(req.businessId, emp, todayIn(req.business.timezone).slice(0, 4)),
  ]);
  res.json({ employee: emp, attendance, leaves, balance });
}));

// ───── Attendance ─────

router.get('/attendance', requirePerm('staff.view', 'staff.manage'), ah(async (req, res) => {
  const date = dateRe.test(req.query.date || '') ? req.query.date : todayIn(req.business.timezone);
  res.json(await staff.dayBoard(req.business, date));
}));

router.post('/attendance/:employeeId/punch-:kind', requirePerm('staff.manage'), ah(async (req, res) => {
  if (!['in', 'out'].includes(req.params.kind)) throw notFound();
  const emp = await staff.getEmployee(req.businessId, req.params.employeeId);
  res.json({ record: await staff.punch(req.business, emp, req.params.kind, { source: 'MANAGER', userId: req.user.id }) });
}));

router.put('/attendance', requirePerm('staff.manage'), validate(z.object({
  employeeId: z.string(), date: z.string().regex(dateRe), status: z.enum(STATUSES),
  punchIn: z.string().regex(timeRe).nullable().optional(), punchOut: z.string().regex(timeRe).nullable().optional(), note: z.string().max(300).nullable().optional(),
})), ah(async (req, res) => {
  const emp = await staff.getEmployee(req.businessId, req.body.employeeId);
  if (req.body.date > todayIn(req.business.timezone) && !['LEAVE', 'HOLIDAY', 'WEEK_OFF'].includes(req.body.status)) throw badRequest('Attendance cannot be marked for a future date');
  const record = await staff.markDay(req.business, emp, req.body, req.user.id);
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'attendance.mark', entity: 'Employee', entityId: emp.id, data: { date: req.body.date, status: req.body.status } });
  res.json({ record });
}));

router.delete('/attendance/:employeeId/:date', requirePerm('staff.manage'), ah(async (req, res) => {
  const emp = await staff.getEmployee(req.businessId, req.params.employeeId);
  await prisma.attendance.deleteMany({ where: { employeeId: emp.id, date: req.params.date } });
  res.json({ ok: true });
}));

router.get('/summary', requirePerm('staff.view', 'staff.manage'), ah(async (req, res) => {
  res.json(await staff.monthSummary(req.business, req.query.month || todayIn(req.business.timezone).slice(0, 7)));
}));

router.get('/summary.xlsx', requirePerm('staff.view', 'staff.manage'), ah(async (req, res) => {
  const summary = await staff.monthSummary(req.business, req.query.month || todayIn(req.business.timezone).slice(0, 7));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${summary.month}.xlsx"`);
  res.send(await staff.summaryWorkbook(req.business, summary));
}));

// ───── Leave ─────

router.get('/leaves', requirePerm('staff.view', 'staff.manage'), ah(async (req, res) => {
  const where = { businessId: req.businessId };
  if (req.query.status) where.status = req.query.status;
  const leaves = await prisma.leaveRequest.findMany({ where, orderBy: [{ status: 'desc' }, { fromDate: 'desc' }], take: 200, include: { employee: { select: { id: true, name: true, code: true } } } });
  res.json({ leaves });
}));

router.post('/leaves', requirePerm('staff.manage'), validate(leaveSchema.extend({ employeeId: z.string(), approve: z.boolean().optional() })), ah(async (req, res) => {
  const emp = await staff.getEmployee(req.businessId, req.body.employeeId);
  let leave = await prisma.leaveRequest.create({ data: { businessId: req.businessId, employeeId: emp.id, type: req.body.type, fromDate: req.body.fromDate, toDate: req.body.toDate, days: leaveDays(req.body), reason: req.body.reason || null } });
  if (req.body.approve) leave = await staff.decideLeave(req.business, leave, 'APPROVED', req.user.id);
  res.status(201).json({ leave });
}));

router.put('/leaves/:id', requirePerm('staff.manage'), validate(z.object({ status: z.enum(['APPROVED', 'REJECTED']) })), ah(async (req, res) => {
  const leave = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { employee: true } });
  if (!leave) throw notFound();
  if (leave.employee.userId === req.user.id && req.membership.role.name !== 'Owner') throw forbidden('You cannot approve your own leave');
  const updated = await staff.decideLeave(req.business, leave, req.body.status, req.user.id);
  await audit({ businessId: req.businessId, userId: req.user.id, action: `leave.${req.body.status.toLowerCase()}`, entity: 'LeaveRequest', entityId: leave.id });
  res.json({ leave: updated });
}));

module.exports = router;
