/**
 * HomePage.jsx — Customer landing page: lists every active outlet.
 *
 * Data comes from GET /api/outlets (public). Each card links to
 * /outlet/:id, which shows that outlet's menu.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as outletService from '../../services/outletService';
import SmartImage from '../../components/common/SmartImage';
import styles from './HomePage.module.css';

const HomePage = () => {
  const [outlets, setOutlets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadOutlets = async () => {
      try {
        const data = await outletService.getOutlets();
        if (cancelled) return;
        setOutlets(data.outlets || []);
        setError('');
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadOutlets();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /** Re-run the fetch from the retry button (an event, not an effect). */
  const retry = () => {
    setIsLoading(true);
    setError('');
    setReloadKey((key) => key + 1);
  };

  return (
    <div className="page-content">
      {/* ── Hero ── */}
      <section className={styles.hero}>
        <div className="container">
          <span className={styles.eyebrow}>One checkout · Every kitchen</span>
          <h1 className={styles.heroTitle}>
            Order from the whole food court,{' '}
            <span className="gradient-text">pay once.</span>
          </h1>
          <p className={styles.heroText}>
            Mix dishes from any outlet in a single cart. Each kitchen prepares its own
            portion and gives you a pickup code when it's ready.
          </p>
        </div>
      </section>

      {/* ── Outlet listing ── */}
      <section className={`container ${styles.outletsSection}`}>
        <div className={styles.sectionHead}>
          <h2>Browse outlets</h2>
          {!isLoading && !error && (
            <p className={styles.sectionMeta}>
              {outlets.length} {outlets.length === 1 ? 'kitchen' : 'kitchens'} serving now
            </p>
          )}
        </div>

        {isLoading && (
          <div className={styles.stateBox}>
            <div className="spinner" />
            <p>Loading outlets…</p>
          </div>
        )}

        {!isLoading && error && (
          <div className={styles.stateBox}>
            <div className="alert alert-error" role="alert">
              {error}
            </div>
            <button type="button" className="btn btn-secondary" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {!isLoading && !error && outlets.length === 0 && (
          <div className={styles.stateBox}>
            <p>No outlets are open right now. Please check back soon.</p>
          </div>
        )}

        {!isLoading && !error && outlets.length > 0 && (
          <div className={`grid-3 ${styles.grid}`}>
            {outlets.map((outlet) => (
              <article key={outlet.id} className={`card ${styles.card}`}>
                <Link to={`/outlet/${outlet.id}`} className={styles.cardLink}>
                  <div className={styles.imageWrap}>
                    <SmartImage
                      src={outlet.imageUrl}
                      alt=""
                      name={outlet.name}
                      imgClassName={styles.image}
                      fallbackClassName={styles.imageFallback}
                    />
                    {outlet.cuisineType && (
                      <span className={styles.cuisineBadge}>{outlet.cuisineType}</span>
                    )}
                  </div>

                  <div className="card-body">
                    <h3 className={styles.cardTitle}>{outlet.name}</h3>
                    {outlet.description && (
                      <p className={styles.cardText}>{outlet.description}</p>
                    )}
                    {outlet.counterInfo && (
                      <p className={styles.counter}>
                        <span aria-hidden="true">📍</span> {outlet.counterInfo}
                      </p>
                    )}
                    <span className={styles.cardCta}>View menu →</span>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default HomePage;
