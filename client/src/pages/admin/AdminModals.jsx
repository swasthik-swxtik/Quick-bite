/**
 * AdminModals.jsx — compatibility re-export.
 *
 * The dialog primitives (Modal, ConfirmDialog) now live in
 * components/common/Modal.jsx so the customer and employee areas can confirm an
 * action too. The admin panels keep importing them from this path unchanged.
 */

export { Modal, ConfirmDialog } from '../../components/common/Modal';
