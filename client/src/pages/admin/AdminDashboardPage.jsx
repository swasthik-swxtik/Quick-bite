/**
 * AdminDashboardPage.jsx — the admin area (Stage 5).
 *
 * Three management surfaces, one per tab, all backed by the existing
 * /api/admin endpoints and the existing adminService wrappers:
 *
 *   Outlets   — full CRUD + hide/show (isActive) + a shortcut into that menu
 *   Menu      — full CRUD per outlet + available/unavailable (isAvailable)
 *   Employees — full CRUD, outlet assignment, password reset
 *
 * Access control is already in place at both layers and is NOT reimplemented
 * here: the route is wrapped in <ProtectedRoute allowedRoles={['admin']} /> and
 * every endpoint sits behind authenticate + authorize('admin') on the server.
 * The role check below is only a last-resort fallback in case the component is
 * ever rendered outside that guard.
 *
 * The outlets list is owned here because the Menu and Employees tabs both need
 * it; mutations in OutletsPanel call `reloadOutlets` so every tab stays in sync.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import * as adminService from '../../services/adminService';
import OutletsPanel from './OutletsPanel';
import MenuPanel from './MenuPanel';
import EmployeesPanel from './EmployeesPanel';
import styles from './admin.module.css';

const TABS = [
  { id: 'outlets', label: 'Outlets' },
  { id: 'menu', label: 'Menu items' },
  { id: 'employees', label: 'Employees' },
];

const AdminDashboardPage = () => {
  const { user } = useAuth();

  const [tab, setTab] = useState('outlets');
  const [outlets, setOutlets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [menuOutletId, setMenuOutletId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    adminService
      .getOutlets()
      .then((data) => {
        if (cancelled) return;
        setOutlets(data.outlets || []);
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Refetch the outlet list; panels call this after a mutation. */
  const reloadOutlets = useCallback(async () => {
    const data = await adminService.getOutlets();
    setOutlets(data.outlets || []);
    setError('');
  }, []);

  const retry = async () => {
    setIsLoading(true);
    try {
      await reloadOutlets();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const openMenuFor = (outletId) => {
    setMenuOutletId(outletId);
    setTab('menu');
  };

  // Defence in depth — ProtectedRoute already redirects non-admins.
  if (!user || user.role !== 'admin') {
    return (
      <main className="page-content">
        <div className="container">
          <div className="alert alert-error" role="alert">
            This area is only available to administrators.
          </div>
        </div>
      </main>
    );
  }

  const initialMenuOutletId = outlets.some((outlet) => outlet.id === menuOutletId)
    ? menuOutletId
    : null;

  return (
    <main className="page-content">
      <div className="container">
        <div className={styles.shell}>
          <header className={styles.header}>
            <div>
              <p className={styles.kicker}>Admin</p>
              <h1 className={styles.title}>Admin dashboard</h1>
              <p className={styles.subtitle}>
                Manage the food court&apos;s outlets, their menus and the staff accounts assigned to
                them. Signed in as {user.email}.
              </p>
            </div>

            <div className={styles.headerActions}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={retry}
                disabled={isLoading}
              >
                {isLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          </header>

          <nav className={styles.tabs} aria-label="Admin sections">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`${styles.tab} ${tab === entry.id ? styles.tabActive : ''}`}
                onClick={() => setTab(entry.id)}
                aria-current={tab === entry.id ? 'page' : undefined}
              >
                {entry.label}
                {entry.id === 'outlets' && !isLoading && (
                  <span className={styles.tabCount}>{outlets.length}</span>
                )}
              </button>
            ))}
          </nav>

          {isLoading ? (
            <div className={styles.stateBox}>
              <div className="spinner" />
              <p>Loading the food court…</p>
            </div>
          ) : error && outlets.length === 0 ? (
            <div className={styles.stateBox}>
              <span className={styles.stateIcon} aria-hidden="true">
                ⚠️
              </span>
              <h3>Couldn&apos;t load the dashboard</h3>
              <p className={styles.stateText}>{error}</p>
              <button type="button" className="btn btn-primary" onClick={retry}>
                Try again
              </button>
            </div>
          ) : (
            <>
              {tab === 'outlets' && (
                <OutletsPanel outlets={outlets} onReload={reloadOutlets} onOpenMenu={openMenuFor} />
              )}

              {tab === 'menu' && (
                <MenuPanel
                  key={initialMenuOutletId ?? 'default'}
                  outlets={outlets}
                  initialOutletId={initialMenuOutletId}
                />
              )}

              {tab === 'employees' && <EmployeesPanel outlets={outlets} />}
            </>
          )}
        </div>
      </div>
    </main>
  );
};

export default AdminDashboardPage;
