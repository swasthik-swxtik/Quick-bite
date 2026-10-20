/**
 * LoginPage.jsx — Customer login.
 *
 * Only a resolved *customer* is redirected away from this page. An employee or
 * admin signed in elsewhere in the same browser (another tab shares the cookie
 * jar) must not block the customer form: this tab's customer cookie may still
 * be absent, so the form is the only way to sign in here.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './AuthPage.module.css';

const LoginPage = () => {
  const { login, user } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect only this page's audience. A staff session in another tab is not
  // a customer login, so it leaves the form usable here.
  if (user && user.role === 'customer') {
    return <Navigate to="/" replace />;
  }

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(form.email, form.password);
      if (data.user.role === 'admin') navigate('/admin');
      else if (data.user.role === 'employee') navigate('/employee/dashboard');
      else navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.authWrapper}>
      <div className={styles.authCard}>
        <div className={styles.authLogo}>
          <span className="gradient-text" style={{ fontFamily: 'var(--font-heading)', fontSize: '1.8rem', fontWeight: 800 }}>
            QuickBite
          </span>
        </div>
        <h2 className={styles.authTitle}>Welcome back</h2>
        <p className={styles.authSubtitle}>Sign in to your customer account</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              className="form-input"
              type="email"
              name="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="form-input"
              type="password"
              name="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              required
            />
          </div>

          <button
            id="login-submit"
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className={styles.authLink}>
          Don't have an account? <Link to="/register">Create one</Link>
        </p>
        <p className={styles.authLink} style={{ marginTop: 'var(--space-2)' }}>
          Are you a staff member? <Link to="/employee/login">Employee login</Link>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
