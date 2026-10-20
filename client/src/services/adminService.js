import api from './api';

/**
 * adminService.js — HTTP calls for the admin dashboard.
 */

// Outlets
export const getOutlets = () => api.get('/admin/outlets');
export const createOutlet = (data) => api.post('/admin/outlets', data);
export const updateOutlet = (id, data) => api.put(`/admin/outlets/${id}`, data);
export const deleteOutlet = (id) => api.delete(`/admin/outlets/${id}`);

// Menu Items
export const getOutletMenu = (outletId) => api.get(`/admin/outlets/${outletId}/menu`);
export const createMenuItem = (outletId, data) => api.post(`/admin/outlets/${outletId}/menu`, data);
export const updateMenuItem = (id, data) => api.put(`/admin/menu-items/${id}`, data);
export const deleteMenuItem = (id) => api.delete(`/admin/menu-items/${id}`);

// Employees
export const getEmployees = () => api.get('/admin/employees');
export const createEmployee = (data) => api.post('/admin/employees', data);
export const updateEmployee = (id, data) => api.put(`/admin/employees/${id}`, data);
export const deleteEmployee = (id) => api.delete(`/admin/employees/${id}`);

// Orders
export const getAllOrders = () => api.get('/admin/orders');
export const getOrderById = (id) => api.get(`/admin/orders/${id}`);
