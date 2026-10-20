/**
 * cart.js — Helpers for presenting the cart (CartContext, persisted per user).
 *
 * A cart can hold items from several outlets, and both the cart page and the
 * checkout page need to present it per outlet — so the grouping lives here
 * rather than being written twice.
 */

/**
 * Group cart lines by outlet, preserving the order the outlets were added in.
 *
 * @param {Array<{ menuItem: object, outletId: string, outletName: string, quantity: number }>} items
 * @returns {Array<{ outletId: string, outletName: string, items: Array }>}
 */
export const groupByOutlet = (items) => {
  const groups = new Map();

  for (const line of items) {
    if (!groups.has(line.outletId)) {
      groups.set(line.outletId, {
        outletId: line.outletId,
        outletName: line.outletName,
        items: [],
      });
    }
    groups.get(line.outletId).items.push(line);
  }

  return [...groups.values()];
};

/** Sum of unit price × quantity across a group of cart lines. */
export const subtotalOf = (lines) =>
  lines.reduce((sum, line) => sum + Number(line.menuItem.price) * line.quantity, 0);
