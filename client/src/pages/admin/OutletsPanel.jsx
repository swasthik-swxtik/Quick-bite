/**
 * OutletsPanel.jsx — create, edit, hide/show and delete outlets.
 *
 * The outlets list itself is owned by AdminDashboardPage (the Menu and Employees
 * panels also need it), so mutations here call `onReload()` to refetch it.
 *
 * Server rules mirrored by the form validation (admin.controller.js):
 *   name        2–100 chars, required
 *   cuisineType required, max 50
 *   description max 500 · counterInfo max 100 · imageUrl a valid URL
 */

import { useState } from 'react';
import * as adminService from '../../services/adminService';
import { Modal, ConfirmDialog } from './AdminModals';
import { useFlash } from './useFlash';
import styles from './admin.module.css';

const EMPTY_FORM = { name: '', cuisineType: '', description: '', counterInfo: '', imageUrl: '' };

const toForm = (outlet) => ({
  name: outlet.name ?? '',
  cuisineType: outlet.cuisineType ?? '',
  description: outlet.description ?? '',
  counterInfo: outlet.counterInfo ?? '',
  imageUrl: outlet.imageUrl ?? '',
});

const OutletsPanel = ({ outlets, onReload, onOpenMenu }) => {
  const { flash, show, dismiss } = useFlash();

  const [modal, setModal] = useState(null); // { mode: 'create' | 'edit', outlet? }
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [togglingId, setTogglingId] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError('');
    setModal({ mode: 'create' });
  };

  const openEdit = (outlet) => {
    setForm(toForm(outlet));
    setFieldErrors({});
    setFormError('');
    setModal({ mode: 'edit', outlet });
  };

  /** Client-side mirror of createOutletSchema / updateOutletSchema. */
  const validate = () => {
    const errors = {};
    const name = form.name.trim();
    const cuisine = form.cuisineType.trim();

    if (name.length < 2 || name.length > 100) {
      errors.name = 'Name must be between 2 and 100 characters.';
    }
    if (!cuisine) errors.cuisineType = 'Cuisine type is required.';
    else if (cuisine.length > 50) errors.cuisineType = 'Cuisine type must be 50 characters or fewer.';
    if (form.description.trim().length > 500) {
      errors.description = 'Description must be 500 characters or fewer.';
    }
    if (form.counterInfo.trim().length > 100) {
      errors.counterInfo = 'Counter info must be 100 characters or fewer.';
    }
    const url = form.imageUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      errors.imageUrl = 'Enter a full URL starting with http:// or https://.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    if (!validate()) return;

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      cuisineType: form.cuisineType.trim(),
      description: form.description.trim(),
      counterInfo: form.counterInfo.trim(),
      imageUrl: form.imageUrl.trim(),
    };

    try {
      if (modal.mode === 'create') {
        const data = await adminService.createOutlet(payload);
        setModal(null);
        await onReload();
        show('success', `Outlet “${data.outlet.name}” created.`);
      } else {
        const data = await adminService.updateOutlet(modal.outlet.id, payload);
        setModal(null);
        await onReload();
        show('success', `Outlet “${data.outlet.name}” updated.`);
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (outlet) => {
    setTogglingId(outlet.id);
    try {
      await adminService.updateOutlet(outlet.id, { isActive: !outlet.isActive });
      await onReload();
      show(
        'success',
        `“${outlet.name}” is now ${outlet.isActive ? 'hidden from customers' : 'visible to customers'}.`
      );
    } catch (err) {
      show('error', err.message);
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await adminService.deleteOutlet(confirmTarget.id);
      const name = confirmTarget.name;
      setConfirmTarget(null);
      await onReload();
      show('success', `Outlet “${name}” deleted.`);
    } catch (err) {
      // Most often the 409 the API returns when orders still reference the outlet
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const activeCount = outlets.filter((outlet) => outlet.isActive).length;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Outlets</h2>
          <p className={styles.panelText}>
            {outlets.length} {outlets.length === 1 ? 'outlet' : 'outlets'} · {activeCount} visible to
            customers
          </p>
        </div>
        <div className={styles.panelActions}>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            + New outlet
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

      {outlets.length === 0 ? (
        <div className={styles.stateBox}>
          <span className={styles.stateIcon} aria-hidden="true">
            🏪
          </span>
          <h3>No outlets yet</h3>
          <p className={styles.stateText}>
            An outlet is a food-court stall customers order from. Create one to start adding menu
            items and assigning staff.
          </p>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + Create the first outlet
          </button>
        </div>
      ) : (
        <ul className={styles.rows}>
          {outlets.map((outlet) => (
            <li
              key={outlet.id}
              className={`${styles.row} ${outlet.isActive ? '' : styles.rowInactive}`}
            >
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>
                  {outlet.name}
                  <span className={styles.tag}>{outlet.cuisineType}</span>
                </div>
                {outlet.description && <p className={styles.rowSub}>{outlet.description}</p>}
                <div className={styles.rowTags}>
                  {outlet.counterInfo && <span className={styles.tag}>📍 {outlet.counterInfo}</span>}
                </div>
              </div>

              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={`${styles.switch} ${outlet.isActive ? styles.switchOn : ''}`}
                  onClick={() => toggleActive(outlet)}
                  disabled={togglingId === outlet.id}
                  aria-pressed={outlet.isActive}
                  title={
                    outlet.isActive
                      ? 'Active — visible to customers. Click to hide it.'
                      : 'Inactive — hidden from customers. Click to show it.'
                  }
                >
                  <span className={styles.switchKnob} aria-hidden="true" />
                  {togglingId === outlet.id
                    ? 'Saving…'
                    : outlet.isActive
                      ? 'Shown to customers'
                      : 'Hidden from customers'}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onOpenMenu(outlet.id)}
                >
                  Menu
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(outlet)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    setDeleteError('');
                    setConfirmTarget(outlet);
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
          title={modal.mode === 'create' ? 'New outlet' : `Edit “${modal.outlet.name}”`}
          description={
            modal.mode === 'create'
              ? 'New outlets are visible to customers straight away.'
              : 'Changes are visible to customers immediately.'
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
              <button type="submit" form="outlet-form" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : modal.mode === 'create' ? 'Create outlet' : 'Save changes'}
              </button>
            </>
          }
        >
          <form id="outlet-form" className={styles.form} onSubmit={submit} noValidate>
            {formError && (
              <div className="alert alert-error" role="alert">
                {formError}
              </div>
            )}

            <div className={styles.formGrid}>
              <div className="form-group">
                <label className="form-label" htmlFor="outlet-name">
                  Name
                </label>
                <input
                  id="outlet-name"
                  className="form-input"
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  maxLength={100}
                  required
                />
                {fieldErrors.name && <span className="form-error">{fieldErrors.name}</span>}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="outlet-cuisine">
                  Cuisine type
                </label>
                <input
                  id="outlet-cuisine"
                  className="form-input"
                  value={form.cuisineType}
                  onChange={(event) => setField('cuisineType', event.target.value)}
                  placeholder="Italian"
                  maxLength={50}
                  required
                />
                {fieldErrors.cuisineType && (
                  <span className="form-error">{fieldErrors.cuisineType}</span>
                )}
              </div>

              <div className={`form-group ${styles.formWide}`}>
                <label className="form-label" htmlFor="outlet-description">
                  Description
                </label>
                <input
                  id="outlet-description"
                  className="form-input"
                  value={form.description}
                  onChange={(event) => setField('description', event.target.value)}
                  placeholder="Wood-fired pizza and Italian classics"
                  maxLength={500}
                />
                {fieldErrors.description && <span className="form-error">{fieldErrors.description}</span>}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="outlet-counter">
                  Counter info
                </label>
                <input
                  id="outlet-counter"
                  className="form-input"
                  value={form.counterInfo}
                  onChange={(event) => setField('counterInfo', event.target.value)}
                  placeholder="Counter A, Level 1"
                  maxLength={100}
                />
                {fieldErrors.counterInfo && <span className="form-error">{fieldErrors.counterInfo}</span>}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="outlet-image">
                  Image URL
                </label>
                <input
                  id="outlet-image"
                  className="form-input"
                  value={form.imageUrl}
                  onChange={(event) => setField('imageUrl', event.target.value)}
                  placeholder="https://…"
                />
                {fieldErrors.imageUrl && <span className="form-error">{fieldErrors.imageUrl}</span>}
              </div>
            </div>
          </form>
        </Modal>
      )}

      {confirmTarget && (
        <ConfirmDialog
          title="Delete outlet?"
          message={`“${confirmTarget.name}” will be permanently removed.`}
          details={[
            'Every menu item belonging to this outlet is deleted with it.',
            'Staff assigned to it stay in the system but become unassigned.',
          ]}
          warning="Outlets that already have orders cannot be deleted — the server will refuse and explain why."
          confirmLabel="Delete outlet"
          busy={deleting}
          error={deleteError}
          onConfirm={remove}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </section>
  );
};

export default OutletsPanel;
