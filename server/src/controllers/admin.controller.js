/**
 * admin.controller.js — Handlers for the admin dashboard.
 *
 * All routes in this controller require role = 'admin'.
 *
 * Routes:
 *   Outlets:   GET/POST /api/admin/outlets, PUT/DELETE /api/admin/outlets/:id
 *   Menu:      GET/POST /api/admin/outlets/:outletId/menu, PUT/DELETE /api/admin/menu-items/:id
 *   Employees: GET/POST /api/admin/employees, PUT/DELETE /api/admin/employees/:id
 *   Orders:    GET /api/admin/orders, GET /api/admin/orders/:id
 */

const Joi = require('joi');
const outletModel   = require('../models/outlet.model');
const menuItemModel = require('../models/menuItem.model');
const userModel     = require('../models/user.model');
const orderModel    = require('../models/order.model');
const authService   = require('../services/auth.service');
const sessionService = require('../services/session.service');
const { withoutPickupCodes } = require('../utils/orderView');

// ── Outlets ─────────────────────────────────────────────────────────────────

const getAllOutlets = async (req, res, next) => {
  try {
    const outlets = await outletModel.findAll();
    return res.status(200).json({ outlets });
  } catch (err) { next(err); }
};

const createOutletSchema = Joi.object({
  name:        Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().max(500).optional().allow(''),
  cuisineType: Joi.string().trim().max(50).required(),
  imageUrl:    Joi.string().uri().optional().allow(''),
  counterInfo: Joi.string().trim().max(100).optional().allow(''),
});

const createOutlet = async (req, res, next) => {
  try {
    const { error, value } = createOutletSchema.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ message: 'Validation failed.', details: error.details.map(d => d.message) });
    const outlet = await outletModel.createOutlet(value);
    return res.status(201).json({ outlet });
  } catch (err) { next(err); }
};

const updateOutletSchema = Joi.object({
  name:        Joi.string().trim().min(2).max(100),
  description: Joi.string().trim().max(500).allow(''),
  cuisineType: Joi.string().trim().max(50),
  imageUrl:    Joi.string().uri().allow(''),
  counterInfo: Joi.string().trim().max(100).allow(''),
  isActive:    Joi.boolean(),
}).min(1).messages({ 'object.min': 'Provide at least one field to update.' });

const updateOutlet = async (req, res, next) => {
  try {
    const { error, value } = updateOutletSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: 'Validation failed.', details: error.details.map(d => d.message) });

    const outlet = await outletModel.updateOutlet(req.params.id, value);
    if (!outlet) return res.status(404).json({ message: 'Outlet not found.' });
    return res.status(200).json({ outlet });
  } catch (err) { next(err); }
};

const deleteOutlet = async (req, res, next) => {
  try {
    await outletModel.deleteOutlet(req.params.id);
    return res.status(200).json({ message: 'Outlet deleted.' });
  } catch (err) { next(err); }
};

// ── Menu Items ───────────────────────────────────────────────────────────────

const getOutletMenu = async (req, res, next) => {
  try {
    const items = await menuItemModel.findByOutletId(req.params.outletId);
    return res.status(200).json({ items });
  } catch (err) { next(err); }
};

const menuItemSchema = Joi.object({
  name:        Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().max(500).optional().allow(''),
  price:       Joi.number().positive().precision(2).required(),
  imageUrl:    Joi.string().uri().optional().allow(''),
});

const createMenuItem = async (req, res, next) => {
  try {
    const { error, value } = menuItemSchema.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ message: 'Validation failed.', details: error.details.map(d => d.message) });
    const item = await menuItemModel.createMenuItem({ ...value, outletId: req.params.outletId });
    return res.status(201).json({ item });
  } catch (err) { next(err); }
};

const updateMenuItemSchema = Joi.object({
  name:        Joi.string().trim().min(2).max(100),
  description: Joi.string().trim().max(500).allow(''),
  price:       Joi.number().positive().precision(2),
  imageUrl:    Joi.string().uri().allow(''),
  isAvailable: Joi.boolean(),
}).min(1).messages({ 'object.min': 'Provide at least one field to update.' });

const updateMenuItem = async (req, res, next) => {
  try {
    const { error, value } = updateMenuItemSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: 'Validation failed.', details: error.details.map(d => d.message) });

    const item = await menuItemModel.updateMenuItem(req.params.id, value);
    if (!item) return res.status(404).json({ message: 'Menu item not found.' });
    return res.status(200).json({ item });
  } catch (err) { next(err); }
};

const deleteMenuItem = async (req, res, next) => {
  try {
    await menuItemModel.deleteMenuItem(req.params.id);
    return res.status(200).json({ message: 'Menu item deleted.' });
  } catch (err) { next(err); }
};

// ── Employees ────────────────────────────────────────────────────────────────

const getAllEmployees = async (req, res, next) => {
  try {
    const employees = await userModel.findAllEmployees();
    return res.status(200).json({ employees });
  } catch (err) { next(err); }
};

const createEmployeeSchema = Joi.object({
  name:     Joi.string().trim().min(2).max(100).required(),
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).max(72).required(),
  outletId: Joi.string().uuid().required(),
});

const createEmployee = async (req, res, next) => {
  try {
    const { error, value } = createEmployeeSchema.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ message: 'Validation failed.', details: error.details.map(d => d.message) });

    const existing = await userModel.findByEmail(value.email);
    if (existing) return res.status(409).json({ message: 'Email already in use.' });

    const passwordHash = await authService.hashPassword(value.password);
    const employee = await userModel.createUser({ ...value, passwordHash, role: 'employee' });
    return res.status(201).json({ employee });
  } catch (err) { next(err); }
};

const updateEmployeeSchema = Joi.object({
  name:     Joi.string().trim().min(2).max(100),
  email:    Joi.string().email().lowercase(),
  role:     Joi.string().valid('employee', 'admin'),
  // null clears the outlet assignment; omitting the field leaves it untouched
  outletId: Joi.string().uuid().allow(null),
  password: Joi.string().min(8).max(72),
}).min(1).messages({ 'object.min': 'Provide at least one field to update.' });

const updateEmployee = async (req, res, next) => {
  try {
    const { error, value } = updateEmployeeSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: 'Validation failed.', details: error.details.map(d => d.message) });

    // `password` is hashed here; every other column is written as-is
    const { password, ...patch } = value;
    if (password) {
      patch.passwordHash = await authService.hashPassword(password);
    }

    // Role, outlet and password changes alter what an existing JWT is allowed
    // to do. Revoke every login for this user *before* writing the change, so a
    // failure cannot leave old privileges alive. A failed write may force a
    // re-login, which is the safe direction.
    const securityChanged =
      value.role !== undefined ||
      value.outletId !== undefined ||
      value.password !== undefined;

    if (securityChanged) {
      await sessionService.revokeUserSessions(req.params.id);
    }

    const employee = await userModel.updateUser(req.params.id, patch);
    if (!employee) return res.status(404).json({ message: 'Employee not found.' });
    return res.status(200).json({ employee });
  } catch (err) { next(err); }
};

const deleteEmployee = async (req, res, next) => {
  try {
    // Revoke and disconnect before deleting. The FK also cascades session rows,
    // but this makes the socket disconnect immediate and covers the moment
    // before the user row disappears.
    await sessionService.revokeUserSessions(req.params.id);
    await userModel.deleteUser(req.params.id);
    return res.status(200).json({ message: 'Employee deleted.' });
  } catch (err) { next(err); }
};

// ── Orders ───────────────────────────────────────────────────────────────────

const getAllOrders = async (req, res, next) => {
  try {
    const orders = await orderModel.findAllOrders();
    return res.status(200).json({ orders });
  } catch (err) { next(err); }
};

const getOrderById = async (req, res, next) => {
  try {
    const order = await orderModel.findOrderById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    // Admins are staff: they may inspect the order, but not the customer's
    // pickup code (see utils/orderView.js).
    return res.status(200).json({ order: withoutPickupCodes(order) });
  } catch (err) { next(err); }
};

module.exports = {
  getAllOutlets, createOutlet, updateOutlet, deleteOutlet,
  getOutletMenu, createMenuItem, updateMenuItem, deleteMenuItem,
  getAllEmployees, createEmployee, updateEmployee, deleteEmployee,
  getAllOrders, getOrderById,
};
