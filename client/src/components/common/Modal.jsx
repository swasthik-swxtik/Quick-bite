/**
 * Modal.jsx — generic dialog primitives shared by the admin, customer and
 * employee areas.
 *
 *  Modal         — dialog shell (Escape, backdrop click, focus, scroll lock)
 *  ConfirmDialog — destructive-action confirmation built on Modal
 *
 * The close button is rendered last in the DOM (and positioned absolutely) so the
 * modal's initial focus lands on the first form field — or, in a confirm dialog,
 * on "Cancel" rather than on "×".
 *
 * Moved here from pages/admin/AdminModals.jsx, which re-exports both components
 * so the admin panels keep their existing imports.
 */

import { useEffect, useRef } from 'react';
import styles from './Modal.module.css';

/**
 * @param {Object}   props
 * @param {string}   props.title
 * @param {string}   [props.description]
 * @param {Function} props.onClose        - called on Escape / backdrop / ×
 * @param {boolean}  [props.busy]         - block closing while a request is in flight
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} [props.footer]
 */
export const Modal = ({ title, description, onClose, busy = false, children, footer }) => {
  const modalRef = useRef(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    // Focus once, on mount only — never steal focus while the user is typing.
    if (!focusedRef.current) {
      focusedRef.current = true;
      const first = modalRef.current?.querySelector('input, select, textarea');
      const fallback = modalRef.current?.querySelector('button');
      (first || fallback)?.focus();
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, busy]);

  return (
    <div
      className={styles.overlay}
      // mousedown (not click) so dragging from inside the dialog doesn't close it
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qb-dialog-title"
      >
        <header className={styles.modalHead}>
          <h2 id="qb-dialog-title" className={styles.modalTitle}>
            {title}
          </h2>
          {description && <p className={styles.modalText}>{description}</p>}
        </header>

        <div className={styles.modalBody}>{children}</div>

        {footer && <footer className={styles.modalFoot}>{footer}</footer>}

        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          disabled={busy}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
    </div>
  );
};

/**
 * ConfirmDialog — asks before a destructive action and shows the outcome of a
 * failed attempt (e.g. the 409 the API returns when a record is still referenced).
 *
 * @param {Object}   props
 * @param {string}   props.title
 * @param {string}   props.message
 * @param {string[]} [props.details]      - bullet points describing the impact
 * @param {string}   [props.warning]      - emphasised consequence
 * @param {string}   [props.confirmLabel]
 * @param {boolean}  [props.busy]
 * @param {string}   [props.error]
 * @param {Function} props.onConfirm
 * @param {Function} props.onCancel
 */
export const ConfirmDialog = ({
  title,
  message,
  details = [],
  warning,
  confirmLabel = 'Delete',
  busy = false,
  error = '',
  onConfirm,
  onCancel,
}) => (
  <Modal
    title={title}
    onClose={onCancel}
    busy={busy}
    footer={
      <>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </>
    }
  >
    <p>{message}</p>

    {details.length > 0 && (
      <ul className={styles.confirmList}>
        {details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
    )}

    {warning && <p className={styles.warnText}>{warning}</p>}

    {error && (
      <div className="alert alert-error" role="alert">
        {error}
      </div>
    )}
  </Modal>
);
