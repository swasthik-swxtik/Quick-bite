/**
 * outlet.controller.js — Handlers for customer-facing outlet routes.
 *
 * Routes:
 *   GET /api/outlets          — List all active outlets
 *   GET /api/outlets/:id      — Get a single outlet's details
 *   GET /api/outlets/:id/menu — Get a single outlet's menu (available items only)
 */

const outletModel   = require('../models/outlet.model');
const menuItemModel = require('../models/menuItem.model');

/**
 * GET /api/outlets
 */
const getAllOutlets = async (req, res, next) => {
  try {
    const outlets = await outletModel.findAllActive();
    return res.status(200).json({ outlets });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/outlets/:id
 */
const getOutletById = async (req, res, next) => {
  try {
    const outlet = await outletModel.findById(req.params.id);
    if (!outlet) {
      return res.status(404).json({ message: 'Outlet not found.' });
    }
    return res.status(200).json({ outlet });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/outlets/:id/menu
 */
const getOutletMenu = async (req, res, next) => {
  try {
    const outlet = await outletModel.findById(req.params.id);
    if (!outlet) {
      return res.status(404).json({ message: 'Outlet not found.' });
    }
    const items = await menuItemModel.findByOutletId(req.params.id);
    return res.status(200).json({ outlet, items });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllOutlets, getOutletById, getOutletMenu };
