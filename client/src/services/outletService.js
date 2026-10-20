import api from './api';

/**
 * outletService.js — HTTP calls for outlets and menus.
 */

export const getOutlets = () =>
  api.get('/outlets');

export const getOutletById = (id) =>
  api.get(`/outlets/${id}`);

export const getOutletMenu = (id) =>
  api.get(`/outlets/${id}/menu`);
