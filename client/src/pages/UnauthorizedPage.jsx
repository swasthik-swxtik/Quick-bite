import { Link } from 'react-router-dom';
const UnauthorizedPage = () => (
  <div className="page-content" style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div style={{textAlign:'center'}}>
      <h1 style={{fontSize:'4rem',color:'var(--clr-error)'}}>403</h1>
      <h2>Access Denied</h2>
      <p style={{marginBottom:'var(--space-6)'}}>You do not have permission to view this page.</p>
      <Link to="/" className="btn btn-primary">Back to Home</Link>
    </div>
  </div>
);
export default UnauthorizedPage;
