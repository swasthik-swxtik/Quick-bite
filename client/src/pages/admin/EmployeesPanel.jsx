/**
 * EmployeesPanel.jsx — create, edit, reassign and delete staff accounts.
 *
 * Every employee belongs to exactly one outlet (that is what scopes their
 * dashboard to their own kitchen queue), so the outlet select is the core of
 * this panel. The list is refetched after each mutation because `outletName` is
 * joined in by the server (findAllEmployees) and is not part of the mutation
 * response.
 *
 * `role` is deliberately not editable here: the employees endpoint only ever
 * lists role = 'employee', so promoting somebody to admin would make the row
 * disappear from this list. It is left to the API.
 *
 * Server rules mirrored by the form validation:
 *   name     2–100 chars, required
 *   email    valid address, required, stored lower-case
 *   password 8–72 chars, required on create, optional on edit
 *   outletId required on create, nullable on edit (clears the assignment)
 */

import { useEffect, useState } from 'react';
import * as adminService from '../../services/adminService';
import { Modal, ConfirmDialog } from './AdminModals';
import { useFlash } from './useFlash';
import styles from './admin.module.css';

const EMPTY_FORM = { name: '', email: '', password: '', outletId: '' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const EmployeesPanel = ({ outlets }) => {
  const { flash, show, dismiss } = useFlash();

  const [employees, setEmployees] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [modal, setModal] = useState(null); // { mode: 'create' | 'edit', employee? }
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // ── Load employees ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    adminService
      .getEmployees()
      .then((data) => {
        if (cancelled) return;
        setEmployees(data.employees || []);
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const reload = async () => {
    const data = await adminService.getEmployees();
    setEmployees(data.employees || []);
    setError('');
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  // ── Form helpers ──────────────────────────────────────────────────────────
  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, outletId: outlets[0]?.id ?? '' });
    setFieldErrors({});
    setFormError('');
    setModal({ mode: 'create' });
  };

  const openEdit = (employee) => {
    setForm({
      name: employee.name ?? '',
      email: employee.email ?? '',
      password: '',
      outletId: employee.outletId ?? '',
    });
    setFieldErrors({});
    setFormError('');
    setModal({ mode: 'edit', employee });
  };

  /** Client-side mirror of createEmployeeSchema / updateEmployeeSchema. */
  const validate = () => {
    const errors = {};
    const name = form.name.trim();
    const email = form.email.trim();

    if (name.length < 2 || name.length > 100) {
      errors.name = 'Name must be between 2 and 100 characters.';
    }
    if (!email) errors.email = 'Email is required.';
    else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';

    const password = form.password;
    if (modal.mode === 'create') {
      if (!password) errors.password = 'A password is required for a new account.';
      else if (password.length < 8 || password.length > 72) {
        errors.password = 'Password must be between 8 and 72 characters.';
      }
    } else if (password && (password.length < 8 || password.length > 72)) {
      errors.password = 'Password must be between 8 and 72 characters.';
    }

    if (modal.mode === 'create' && !form.outletId) {
      errors.outletId = 'Assign the employee to an outlet.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    if (!validate()) return;

    setSaving(true);
    try {
      if (modal.mode === 'create') {
        const data = await adminService.createEmployee({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          outletId: form.outletId,
        });
        await reload();
        setModal(null);
        show('success', `Employee “${data.employee.name}” created.`);
      } else {
        const payload = {
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          // '' means "unassigned" — the API clears the assignment on null
          outletId: form.outletId || null,
        };
        if (form.password) payload.password = form.password;

        const data = await adminService.updateEmployee(modal.employee.id, payload);
        await reload();
        setModal(null);
        show('success', `Employee “${data.employee.name}” updated.`);
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await adminService.deleteEmployee(confirmTarget.id);
      const name = confirmTarget.name;
      setConfirmTarget(null);
      await reload();
      show('success', `Employee “${name}” deleted.`);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const modalEmployee = modal?.employee ?? null;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Employees</h2>
          <p className={styles.panelText}>
            {!loaded
              ? 'Loading staff accounts…'
              : `${employees.length} ${employees.length === 1 ? 'account' : 'accounts'} · each one only sees the orders of the outlet they are assigned to`}
          </p>
        </div>
        <div className={styles.panelActions}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openCreate}
            disabled={outlets.length === 0}
            title={outlets.length === 0 ? 'Create an outlet first' : undefined}
          >
            + New employee
          </button>
        </div>
      </div>

      {flash && (
        <div
          key={flash.id}
          className={`alert ${flash.kind === 'error' ? 'alert-error' : 'alert-success'} ${styles.toast}`}
          role="status"
        >
          <span>{flash.message}</span>
          <button type="button" className={styles.toastClose} onClick={dismiss} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {!loaded ? (
        <div className={styles.stateBox}>
          <div className="spinner" />
          <p>Loading employees…</p>
        </div>
      ) : employees.length === 0 && !error ? (
        <div className={styles.stateBox}>
          <span className={styles.stateIcon} aria-hidden="true">
            👩‍🍳
          </span>
          <h3>No employee accounts yet</h3>
          <p className={styles.stateText}>
            Employees sign in with the email and password you set here, and their dashboard only
            shows orders for their own outlet.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
            disabled={outlets.length === 0}
          >
            {outlets.length === 0 ? 'Create an outlet first' : '+ Create the first employee'}
          </button>
        </div>
      ) : (
        <ul className={styles.rows}>
          {employees.map((employee) => (
            <li key={employee.id} className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>
                  {employee.name}
                  <span className={styles.tag}>{employee.role}</span>
                </div>
                <p className={styles.rowSub}>{employee.email}</p>
                <div className={styles.rowTags}>
                  {employee.outletId ? (
                    <span className={`${styles.tag} ${styles.tagOn}`}>
                      🏪 {employee.outletName}
                    </span>
                  ) : (
                    <span className={`${styles.tag} ${styles.tagOff}`}>⚠ Unassigned</span>
                  )}
                </div>
              </div>

              <div className={styles.rowActions}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openEdit(employee)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    setDeleteError('');
                    setConfirmTarget(employee);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {modal && (
        <Modal
          title={modal.mode === 'create' ? 'New employee' : `Edit “${modalEmployee.name}”`}
          description={
            modal.mode === 'create'
              ? 'The employee can sign in immediately with this email and password.'
              : 'Leave the password blank to keep the current one.'
          }
          onClose={() => setModal(null)}
          busy={saving}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setModal(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="employee-form"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? 'Saving…' : modal.mode === 'create' ? 'Create employee' : 'Save changes'}
              </button>
            </>
          }
        >
          <form id="employee-form" className={styles.form} onSubmit={submit} noValidate>
            {formError && (
              <div className="alert alert-error" role="alert">
                {formError}
              </div>
            )}

            <div className={styles.formGrid}>
              <div className="form-group">
                <label className="form-label" htmlFor="employee-name">
                  Full name
                </label>
                <input
                  id="employee-name"
                  className="form-input"
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  maxLength={100}
                  required
                />
                {fieldErrors.name && <span className="form-error">{fieldErrors.name}</span>}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="employee-email">
                  Email
                </label>
                <input
                  id="employee-email"
                  className="form-input"
                  type="email"
                  value={form.email}
                  onChange={(event) => setField('email', event.target.value)}
                  placeholder="pizza@quickbite.com"
                  autoComplete="off"
                  required
                />
                {fieldErrors.email && <span className="form-error">{fieldErrors.email}</span>}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="employee-outlet">
                  Assigned outlet
                </label>
                <select
                  id="employee-outlet"
                  className="form-input"
                  value={form.outletId}
                  onChange={(event) => setField('outletId', event.target.value)}
                >
                  {modal.mode === 'edit' && <option value="">— Unassigned —</option>}
                  {modal.mode === 'create' && <option value="">Select an outlet…</option>}
                  {outlets.map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
                      {outlet.isActive ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
                {fieldErrors.outletId && <span className="form-error">{fieldErrors.outletId}</span>}
                {modal.mode === 'edit' && (
                  <span className={styles.hint}>
                    An unassigned employee can sign in but has no kitchen queue.
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="employee-password">
                  {modal.mode === 'create' ? 'Password' : 'New password'}
                </label>
                <input
                  id="employee-password"
                  className="form-input"
                  type="password"
                  value={form.password}
                  onChange={(event) => setField('password', event.target.value)}
                  placeholder={modal.mode === 'create' ? 'At least 8 characters' : 'Leave blank to keep'}
                  autoComplete="new-password"
                  required={modal.mode === 'create'}
                />
                {fieldErrors.password && <span className="form-error">{fieldErrors.password}</span>}
              </div>
            </div>
          </form>
        </Modal>
      )}

      {confirmTarget && (
        <ConfirmDialog
          title="Delete employee?"
          message={`The account for ${confirmTarget.name} (${confirmTarget.email}) will be permanently removed.`}
          details={[
            'They will no longer be able to sign in.',
            'Their past activity on orders is kept in the database.',
          ]}
          confirmLabel="Delete employee"
          busy={deleting}
          error={deleteError}
          onConfirm={remove}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </section>
  );
};

export default EmployeesPanel;
