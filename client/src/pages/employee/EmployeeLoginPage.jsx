/**
 * EmployeeLoginPage.jsx — Employee/Admin login.
 *
 * Only employees and admins are redirected away from this page. A customer
 * signed in elsewhere in the same browser (another tab shares the cookie jar)
 * must not block the staff form: this tab's staff cookie may still be absent,
 * so the form is the only way to sign in here.
 */
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from '../customer/AuthPage.module.css';

const EmployeeLoginPage = () => {
  const { login, user } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect only this page's audience. A customer session in another tab is
  // not a staff login, so it leaves the form usable here.
  if (user && user.role === 'employee') {
    return <Navigate to="/employee/dashboard" replace />;
  }
  if (user && user.role === 'admin') {
    return <Navigate to="/admin" replace />;
  }

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(form.email, form.password);
      if (data.user.role === 'customer') {
        setError('This login is for staff only. Please use the customer login.');
        return;
      }
      if (data.user.role === 'admin') navigate('/admin');
      else navigate('/employee/dashboard');
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
          <p style={{ color: 'var(--clr-muted)', fontSize: '0.8rem', marginTop: '4px' }}>Staff Portal</p>
        </div>
        <h2 className={styles.authTitle}>Staff Sign In</h2>
        <p className={styles.authSubtitle}>For outlet employees and administrators</p>

        {error && <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className="form-group">
            <label className="form-label" htmlFor="emp-email">Email address</label>
            <input id="emp-email" className="form-input" type="email" name="email" placeholder="staff@quickbite.com" value={form.email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="emp-password">Password</label>
            <input id="emp-password" className="form-input" type="password" name="password" placeholder="••••••••" value={form.password} onChange={handleChange} required />
          </div>
          <button id="emp-login-submit" type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default EmployeeLoginPage;
