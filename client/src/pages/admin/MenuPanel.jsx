/**
 * MenuPanel.jsx — manage one outlet's menu.
 *
 * The admin API exposes the menu per outlet (GET/POST
 * /api/admin/outlets/:outletId/menu), so this panel needs an outlet selected
 * first. Items are loaded when the selection changes; mutations update local
 * state from the server's response so the list stays exactly what the database
 * now holds.
 *
 * Server rules mirrored by the form validation:
 *   name  2–100 chars, required
 *   price positive number, 2 decimal places, required
 *   description max 500 · imageUrl a valid URL
 */

import { useEffect, useState } from 'react';
import * as adminService from '../../services/adminService';
import { formatPrice } from '../../utils/format';
import { Modal, ConfirmDialog } from './AdminModals';
import { useFlash } from './useFlash';
import styles from './admin.module.css';

const EMPTY_FORM = { name: '', price: '', description: '', imageUrl: '' };

const byName = (a, b) => a.name.localeCompare(b.name);

const MenuPanel = ({ outlets, initialOutletId }) => {
  const { flash, show, dismiss } = useFlash();

  const [selectedOutletId, setSelectedOutletId] = useState(
    initialOutletId || outlets[0]?.id || null
  );
  const [items, setItems] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null); // outlet id the items belong to
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [modal, setModal] = useState(null); // { mode: 'create' | 'edit', item? }
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [togglingId, setTogglingId] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const selectedOutlet = outlets.find((outlet) => outlet.id === selectedOutletId) || null;
  const isLoading = Boolean(selectedOutletId) && loadedFor !== selectedOutletId;

  // ── Load the selected outlet's menu ───────────────────────────────────────
  useEffect(() => {
    if (!selectedOutletId) return undefined;

    let cancelled = false;
    adminService
      .getOutletMenu(selectedOutletId)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items || []);
        setError('');
        setLoadedFor(selectedOutletId);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoadedFor(selectedOutletId);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOutletId]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const data = await adminService.getOutletMenu(selectedOutletId);
      setItems(data.items || []);
      setError('');
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
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError('');
    setModal({ mode: 'create' });
  };

  const openEdit = (item) => {
    setForm({
      name: item.name ?? '',
      // The API returns NUMERIC as a string ("349.00")
      price: item.price === null || item.price === undefined ? '' : String(item.price),
      description: item.description ?? '',
      imageUrl: item.imageUrl ?? '',
    });
    setFieldErrors({});
    setFormError('');
    setModal({ mode: 'edit', item });
  };

  /** Client-side mirror of menuItemSchema / updateMenuItemSchema. */
  const validate = () => {
    const errors = {};
    const name = form.name.trim();
    const rawPrice = String(form.price).trim();
    const price = Number(rawPrice);

    if (name.length < 2 || name.length > 100) {
      errors.name = 'Name must be between 2 and 100 characters.';
    }
    if (!rawPrice) errors.price = 'Price is required.';
    else if (!Number.isFinite(price) || price <= 0) errors.price = 'Price must be a number above 0.';
    else if (!/^\d+(\.\d{1,2})?$/.test(rawPrice)) {
      errors.price = 'Price can have at most 2 decimal places.';
    }
    if (form.description.trim().length > 500) {
      errors.description = 'Description must be 500 characters or fewer.';
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
      price: Number(String(form.price).trim()),
      description: form.description.trim(),
      imageUrl: form.imageUrl.trim(),
    };

    try {
      if (modal.mode === 'create') {
        const data = await adminService.createMenuItem(selectedOutletId, payload);
        setItems((prev) => [...prev, data.item].sort(byName));
        setModal(null);
        show('success', `“${data.item.name}” added to ${selectedOutlet?.name ?? 'the menu'}.`);
      } else {
        const data = await adminService.updateMenuItem(modal.item.id, payload);
        setItems((prev) => prev.map((item) => (item.id === data.item.id ? data.item : item)).sort(byName));
        setModal(null);
        show('success', `“${data.item.name}” updated.`);
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailable = async (item) => {
    setTogglingId(item.id);
    try {
      const data = await adminService.updateMenuItem(item.id, { isAvailable: !item.isAvailable });
      setItems((prev) => prev.map((row) => (row.id === data.item.id ? data.item : row)));
      show(
        'success',
        `“${item.name}” is now ${item.isAvailable ? 'unavailable to order' : 'available to order'}.`
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
      await adminService.deleteMenuItem(confirmTarget.id);
      const name = confirmTarget.name;
      setItems((prev) => prev.filter((item) => item.id !== confirmTarget.id));
      setConfirmTarget(null);
      show('success', `“${name}” deleted.`);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  // ── No outlets at all ─────────────────────────────────────────────────────
  if (outlets.length === 0) {
    return (
      <section className={styles.panel}>
        <div className={styles.stateBox}>
          <span className={styles.stateIcon} aria-hidden="true">
            🍽️
          </span>
          <h3>No outlets to build a menu for</h3>
          <p className={styles.stateText}>
            Create an outlet on the Outlets tab first — every menu item belongs to one outlet.
          </p>
        </div>
      </section>
    );
  }

  const available = items.filter((item) => item.isAvailable).length;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Menu items</h2>
          <p className={styles.panelText}>
            {isLoading
              ? 'Loading the menu…'
              : selectedOutlet
                ? `${items.length} ${items.length === 1 ? 'item' : 'items'} · ${available} available to order`
                : 'Choose an outlet to manage its menu'}
          </p>
        </div>

        <div className={styles.panelActions}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={refresh}
            disabled={refreshing || isLoading || !selectedOutletId}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openCreate}
            disabled={!selectedOutletId}
          >
            + New item
          </button>
        </div>
      </div>

      <div className={styles.selectorRow}>
        <label className={styles.selectorLabel} htmlFor="menu-outlet-select">
          Outlet
        </label>
        <select
          id="menu-outlet-select"
          className={`form-input ${styles.select}`}
          value={selectedOutletId ?? ''}
          onChange={(event) => setSelectedOutletId(event.target.value)}
        >
          {outlets.map((outlet) => (
            <option key={outlet.id} value={outlet.id}>
              {outlet.name}
              {outlet.isActive ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
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

      {isLoading ? (
        <div className={styles.stateBox}>
          <div className="spinner" />
          <p>Loading the menu…</p>
        </div>
      ) : items.length === 0 && !error ? (
        <div className={styles.stateBox}>
          <span className={styles.stateIcon} aria-hidden="true">
            📋
          </span>
          <h3>No menu items yet</h3>
          <p className={styles.stateText}>
            Add the first dish for {selectedOutlet?.name}. Customers see it on the outlet&apos;s
            menu page right away.
          </p>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + Add a menu item
          </button>
        </div>
      ) : (
        <ul className={styles.rows}>
          {items.map((item) => (
            <li
              key={item.id}
              className={`${styles.row} ${item.isAvailable ? '' : styles.rowInactive}`}
            >
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>
                  {item.name}
                  <span className={styles.tag}>{formatPrice(item.price)}</span>
                </div>
                {item.description && <p className={styles.rowSub}>{item.description}</p>}
              </div>

              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={`${styles.switch} ${item.isAvailable ? styles.switchOn : ''}`}
                  onClick={() => toggleAvailable(item)}
                  disabled={togglingId === item.id}
                  aria-pressed={item.isAvailable}
                  title={item.isAvailable ? 'Mark as unavailable' : 'Mark as available'}
                >
                  <span className={styles.switchKnob} aria-hidden="true" />
                  {togglingId === item.id ? 'Saving…' : item.isAvailable ? 'Available' : 'Unavailable'}
                </button>

                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(item)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    setDeleteError('');
                    setConfirmTarget(item);
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
          title={modal.mode === 'create' ? 'New menu item' : `Edit “${modal.item.name}”`}
          description={
            selectedOutlet ? `This item belongs to ${selectedOutlet.name}.` : undefined
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
              <button type="submit" form="menu-item-form" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : modal.mode === 'create' ? 'Add item' : 'Save changes'}
              </button>
            </>
          }
        >
          <form id="menu-item-form" className={styles.form} onSubmit={submit} noValidate>
            {formError && (
              <div className="alert alert-error" role="alert">
                {formError}
              </div>
            )}

            <div className={styles.formGrid}>
              <div className="form-group">
                <label className="form-label" htmlFor="item-name">
                  Name
                </label>
                <input
                  id="item-name"
                  className="form-input"
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  maxLength={100}
                  required
                />
                {fieldErrors.name && <span className="form-error">{fieldErrors.name}</span>}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="item-price">
                  Price (₹)
                </label>
                <input
                  id="item-price"
                  className="form-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.price}
                  onChange={(event) => setField('price', event.target.value)}
                  placeholder="349.00"
                  required
                />
                {fieldErrors.price && <span className="form-error">{fieldErrors.price}</span>}
              </div>

              <div className={`form-group ${styles.formWide}`}>
                <label className="form-label" htmlFor="item-description">
                  Description
                </label>
                <input
                  id="item-description"
                  className="form-input"
                  value={form.description}
                  onChange={(event) => setField('description', event.target.value)}
                  placeholder="San Marzano tomatoes, fior di latte, basil"
                  maxLength={500}
                />
                {fieldErrors.description && (
                  <span className="form-error">{fieldErrors.description}</span>
                )}
              </div>

              <div className={`form-group ${styles.formWide}`}>
                <label className="form-label" htmlFor="item-image">
                  Image URL
                </label>
                <input
                  id="item-image"
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
          title="Delete menu item?"
          message={`“${confirmTarget.name}” will be removed from ${selectedOutlet?.name ?? 'this outlet'}.`}
          warning="Items that appear in past orders cannot be deleted — mark them unavailable instead to take them off the menu."
          confirmLabel="Delete item"
          busy={deleting}
          error={deleteError}
          onConfirm={remove}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </section>
  );
};

export default MenuPanel;
